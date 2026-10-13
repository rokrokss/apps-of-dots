import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_CREATED,
  DRAFT_FINISHED,
  describeEvents,
  EventError,
  EventHub,
  eventStatus,
  sign,
  signingKey,
  type Post,
  type StateFile,
} from "../src/events.js";
import { scanActivity, scanDrafts } from "../src/drafts.js";
import { AGENT, BRIDGE, channels, connect, FakeDiscord } from "./fakes.js";

const URL_A = "https://connectors.api.openai.com/mcp/events/a";
const URL_B = "https://connectors.api.openai.com/mcp/events/b";
const SECRET = "whsec_" + Buffer.alloc(32, 1).toString("base64");
const SECRET_2 = "whsec_" + Buffer.alloc(32, 2).toString("base64");
const START = Date.UTC(2026, 9, 12);
const DAY = 24 * 60 * 60 * 1000;

class MemoryFile implements StateFile {
  value: string | undefined;
  async read() {
    return this.value;
  }
  async write(value: string) {
    this.value = value;
  }
  get state() {
    return JSON.parse(this.value ?? "{}");
  }
}

type Answer = { status: number; body?: string; retryAfterMs?: number };

/** A callback that echoes challenges and answers deliveries with `answer`. */
function callback() {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const target: { calls: typeof calls; answer: Answer; post: Post } = {
    calls,
    answer: { status: 200 },
    post: async (url, headers, body) => {
      calls.push({ url, headers, body });
      const parsed = JSON.parse(body);
      const answer: Answer =
        parsed.type === "verification"
          ? { status: 200, body: JSON.stringify({ challenge: parsed.challenge }) }
          : target.answer;
      return {
        status: answer.status,
        body: answer.body ?? "",
        retryAfterMs: answer.retryAfterMs ?? 0,
      };
    },
  };
  return target;
}

async function open(file = new MemoryFile(), post: Post = callback().post) {
  let now = START;
  const hub = await EventHub.open({ file, post, now: () => now, log: () => {} });
  return { hub, file, advance: (ms: number) => (now += ms), now: () => now };
}

const subscribeParams = (secret = SECRET, url = URL_A) => ({
  name: "reddit.draft.finished",
  arguments: {},
  delivery: { mode: "webhook", url, secret },
  cursor: null,
});

function signedBy(call: { headers: Record<string, string>; body: string }, secrets: string[]) {
  const { headers } = call;
  return (
    headers["webhook-signature"] ===
    sign(secrets, headers["webhook-id"]!, Number(headers["webhook-timestamp"]), call.body)
  );
}

function refused(code: number, reason?: string) {
  return (error: unknown) =>
    error instanceof EventError &&
    error.code === code &&
    (reason === undefined || error.data?.reason === reason);
}

test("signatures match the Standard Webhooks test vector", () => {
  assert.equal(
    sign(
      ["whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"],
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      1614265330,
      '{"test": 2432232314}',
    ),
    "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  );
  for (const bad of ["MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "whsec_!!!!", "whsec_AAAA"])
    assert.throws(() => signingKey(bad));
});

test("subscribing verifies the callback with a signed challenge, once per secret", async () => {
  const target = callback();
  const { hub, file } = await open(new MemoryFile(), target.post);
  const result = await hub.subscribe(subscribeParams());
  assert.match(result.id, /^sub_[0-9a-f]{32}$/);
  assert.deepEqual(result, { id: result.id, refreshBefore: null, cursor: null, truncated: false });
  const [challenge] = target.calls;
  assert.equal(JSON.parse(challenge!.body).type, "verification");
  assert.equal(challenge!.url, URL_A);
  assert.equal(challenge!.headers["X-MCP-Subscription-Id"], result.id);
  assert.ok(signedBy(challenge!, [SECRET]));
  assert.equal(file.state.subscriptions[result.id].secret, SECRET);

  // A refresh with the same secret skips the challenge; a new secret proves the callback again.
  assert.equal((await hub.subscribe(subscribeParams())).id, result.id);
  assert.equal(target.calls.length, 1);
  await hub.subscribe(subscribeParams(SECRET_2));
  assert.equal(target.calls.length, 2);
  assert.ok(signedBy(target.calls[1]!, [SECRET_2]));

  // Until the overlap ends, deliveries are signed with both secrets.
  await hub.emit(DRAFT_FINISHED, "draft:a:posted", { ref: "a", state: "posted" });
  await hub.deliverDue();
  const delivery = target.calls[2]!;
  assert.equal(delivery.headers["webhook-signature"]!.split(" ").length, 2);
  assert.ok(signedBy(delivery, [SECRET_2, SECRET]));
});

test("subscriptions are refused with the codes and reasons MCP Events defines", async () => {
  const silent = callback();
  silent.post = async (url, headers, body) => {
    silent.calls.push({ url, headers, body });
    return { status: 200, body: "{}", retryAfterMs: 0 };
  };
  const { hub, file } = await open(new MemoryFile(), silent.post);
  await assert.rejects(hub.subscribe(subscribeParams()), refused(-32015, "challenge_failed"));
  assert.equal(silent.calls.length, 1);
  const wrong = await open(new MemoryFile(), async (_url, _headers, body) => {
    const { challenge } = JSON.parse(body) as { challenge: string };
    return {
      status: 200,
      body: JSON.stringify({ challenge: "x".repeat(challenge.length) }),
      retryAfterMs: 0,
    };
  });
  await assert.rejects(wrong.hub.subscribe(subscribeParams()), refused(-32015, "challenge_failed"));
  for (const url of [
    "http://connectors.api.openai.com/x",
    "https://evil.example/x",
    "https://connectors.api.openai.com:8443/x",
    "https://user:pass@connectors.api.openai.com/x",
    "not a url",
  ])
    await assert.rejects(
      hub.subscribe(subscribeParams(SECRET, url)),
      refused(-32015, "invalid_url"),
    );
  for (const params of [
    { ...subscribeParams(), name: "reddit.other" },
    { ...subscribeParams(), arguments: { subreddit: "x" } },
    { ...subscribeParams(), delivery: { mode: "poll", url: URL_A, secret: SECRET } },
    { ...subscribeParams(), cursor: "c1" },
    subscribeParams("whsec_short"),
    { name: "reddit.draft.finished" },
  ])
    await assert.rejects(hub.subscribe(params), refused(-32602), JSON.stringify(params));
  assert.equal(silent.calls.length, 1);
  assert.equal(file.value, undefined);
});

test("events are delivered signed, retried with backoff, and end the subscription on 410", async () => {
  const target = callback();
  const { hub, file, advance } = await open(new MemoryFile(), target.post);
  const { id } = await hub.subscribe(subscribeParams());
  target.calls.length = 0;

  target.answer = { status: 500 };
  await hub.emit(DRAFT_FINISHED, "draft:a:posted", {
    ref: "a",
    state: "posted",
    url: "https://redd.it/a",
  });
  await hub.deliverDue();
  const [first] = target.calls;
  assert.deepEqual(JSON.parse(first!.body), {
    eventId: "draft:a:posted",
    name: "reddit.draft.finished",
    timestamp: new Date(START).toISOString(),
    data: { ref: "a", state: "posted", url: "https://redd.it/a" },
    cursor: null,
  });
  assert.equal(first!.headers["webhook-id"], "draft:a:posted");
  assert.equal(first!.headers["X-MCP-Subscription-Id"], id);
  assert.ok(signedBy(first!, [SECRET]));

  // 5 s, then 10 s; a longer Retry-After wins.
  assert.equal(file.state.outbox[0].nextAt, START + 5_000);
  await hub.deliverDue();
  assert.equal(target.calls.length, 1);
  advance(5_000);
  await hub.deliverDue();
  assert.equal(file.state.outbox[0].nextAt, START + 15_000);
  advance(10_000);
  target.answer = { status: 429, retryAfterMs: 120_000 };
  await hub.deliverDue();
  assert.equal(file.state.outbox[0].nextAt, START + 135_000);
  advance(120_000);
  target.answer = { status: 200 };
  await hub.deliverDue();
  assert.equal(target.calls.length, 4);
  assert.deepEqual(file.state.outbox, []);

  // 413 drops the event; 410 ends the subscription. The inbox keeps both events.
  target.answer = { status: 413 };
  await hub.emit(DRAFT_FINISHED, "draft:b:posted", { ref: "b", state: "posted" });
  await hub.deliverDue();
  assert.deepEqual(file.state.outbox, []);
  target.answer = { status: 410 };
  await hub.emit(DRAFT_FINISHED, "draft:c:failed", { ref: "c", state: "failed" });
  await hub.deliverDue();
  assert.deepEqual(file.state.subscriptions, {});
  await hub.emit(DRAFT_FINISHED, "draft:d:posted", { ref: "d", state: "posted" });
  assert.deepEqual(file.state.outbox, []);
  assert.equal(hub.pending(10).length, 4);
});

test("delivery gives up a day after the event", async () => {
  const target = callback();
  const { hub, file, advance } = await open(new MemoryFile(), target.post);
  await hub.subscribe(subscribeParams());
  target.answer = { status: 503 };
  await hub.emit(DRAFT_FINISHED, "draft:a:posted", { ref: "a", state: "posted" });
  await hub.deliverDue();
  advance(DAY + 1);
  await hub.deliverDue();
  assert.deepEqual(file.state.outbox, []);
  assert.equal(hub.pending(10).length, 1);
});

test("the inbox keeps events until acknowledged, then for a week, and survives a restart", async () => {
  const { hub, file, advance } = await open();
  assert.equal(await hub.emit(DRAFT_FINISHED, "draft:a:posted", { ref: "a" }), true);
  assert.equal(await hub.emit(DRAFT_FINISHED, "draft:a:posted", { ref: "a" }), false);
  await hub.emit(DRAFT_FINISHED, "draft:b:rejected", { ref: "b" });
  assert.deepEqual(
    hub.pending(10).map((e) => e.eventId),
    ["draft:a:posted", "draft:b:rejected"],
  );
  assert.deepEqual(hub.pending(1), [
    {
      eventId: "draft:a:posted",
      name: "reddit.draft.finished",
      timestamp: new Date(START).toISOString(),
      data: { ref: "a" },
    },
  ]);
  assert.deepEqual(await hub.acknowledge(["draft:a:posted", "missing"]), {
    acknowledged: 1,
    pending: 1,
  });
  assert.deepEqual(await hub.acknowledge(["draft:a:posted"]), { acknowledged: 0, pending: 1 });

  advance(8 * DAY);
  await hub.emit(DRAFT_FINISHED, "draft:c:posted", { ref: "c" });
  assert.deepEqual(
    file.state.inbox.map((e: { eventId: string }) => e.eventId),
    ["draft:b:rejected", "draft:c:posted"],
  );
  advance(23 * DAY);
  await hub.acknowledge([]);
  assert.deepEqual(
    hub.pending(10).map((e) => e.eventId),
    ["draft:c:posted"],
  );

  const reopened = await EventHub.open({ file, log: () => {} });
  assert.deepEqual(reopened.pending(10), hub.pending(10));
  await assert.rejects(
    EventHub.open({ file: Object.assign(new MemoryFile(), { value: "{" }) }),
    /Delete it to start over/,
  );
});

test("the watcher records finished drafts first, then emits each new one once", async () => {
  const discord = new FakeDiscord();
  const outbox = channels.outboxChannelId;
  const request = (ref: string, title: string) =>
    discord.add(outbox, {
      author: { id: AGENT },
      content: JSON.stringify({ v: 1, op: "post", ref, title, truncated: false, text: "" }),
    });
  const status = (requestId: string, envelope: Record<string, unknown>) =>
    discord.add(outbox, {
      author: { id: BRIDGE },
      content: JSON.stringify({ v: 1, ...envelope }),
      message_reference: { message_id: requestId },
    });
  status(request("old", "Old"), { ref: "old", status: "posted", thing: "t3_old" });

  const { hub, file } = await open();
  await scanDrafts(hub, discord, channels);
  assert.deepEqual(hub.pending(10), []);
  assert.deepEqual(file.state.watched, ["draft:old:posted"]);

  const queuedId = status(request("new", "New"), { ref: "new", status: "queued" });
  const rejectedRequest = request("bad", "Bad");
  await scanDrafts(hub, discord, channels);
  assert.deepEqual(hub.pending(10), []);

  // The bridge edits its status reply in place.
  const queued = discord.stored.get(outbox)!.find((m) => m.id === queuedId)!;
  queued.content = JSON.stringify({
    v: 1,
    ref: "new",
    status: "posted",
    thing: "t3_new",
    url: "https://www.reddit.com/r/x/comments/new/",
    edited: false,
  });
  status(rejectedRequest, { ref: "bad", status: "rejected", reason: "moderator", detail: "no" });
  await scanDrafts(hub, discord, channels);
  await scanDrafts(hub, discord, channels);
  assert.deepEqual(
    hub.pending(10).map((e) => [e.eventId, e.data]),
    [
      [
        "draft:new:posted",
        {
          ref: "new",
          state: "posted",
          op: "post",
          title: "New",
          thing: "t3_new",
          url: "https://www.reddit.com/r/x/comments/new/",
          edited: false,
        },
      ],
      [
        "draft:bad:rejected",
        {
          ref: "bad",
          state: "rejected",
          op: "post",
          title: "Bad",
          reason: "moderator",
          detail: "no",
        },
      ],
    ],
  );

  // A restart, even after the events were acknowledged and pruned, emits nothing again.
  await hub.acknowledge(["draft:new:posted", "draft:bad:rejected"]);
  const restarted = await EventHub.open({ file, log: () => {} });
  await scanDrafts(restarted, discord, channels);
  assert.deepEqual(restarted.pending(10), []);
});

test("unsubscribing by event name and callback URL stops deliveries", async () => {
  const target = callback();
  const { hub, file } = await open(new MemoryFile(), target.post);
  await hub.subscribe(subscribeParams());
  await hub.unsubscribe({ name: "reddit.draft.finished", delivery: { url: URL_A } });
  assert.deepEqual(file.state.subscriptions, {});
  await hub.emit(DRAFT_FINISHED, "draft:a:posted", { ref: "a", state: "posted" });
  await hub.deliverDue();
  assert.equal(target.calls.length, 1);
  await assert.rejects(
    hub.unsubscribe({ name: "reddit.other", delivery: { url: URL_A } }),
    refused(-32602),
  );
});

test("each event has its own subscription per callback URL", async () => {
  const target = callback();
  const { hub, file } = await open(new MemoryFile(), target.post);
  const drafts = await hub.subscribe(subscribeParams());
  const activity = await hub.subscribe({ ...subscribeParams(), name: ACTIVITY_CREATED });
  // The first release hashed the same way, so its subscriptions keep their IDs.
  assert.equal(drafts.id, "sub_3c017b7a61a7599a67b68febb9aaf356");
  assert.equal(activity.id, "sub_f8825ae486d3817668c7a64948939de5");
  target.calls.length = 0;

  await hub.emit(DRAFT_FINISHED, "draft:a:posted", { ref: "a" });
  await hub.emit(ACTIVITY_CREATED, "activity:t1_x", { thing: "t1_x" });
  await hub.deliverDue();
  assert.deepEqual(
    target.calls.map((c) => [c.headers["X-MCP-Subscription-Id"], c.headers["webhook-id"]]),
    [
      [drafts.id, "draft:a:posted"],
      [activity.id, "activity:t1_x"],
    ],
  );
  assert.deepEqual(
    hub.pending(10, ACTIVITY_CREATED).map((e) => e.eventId),
    ["activity:t1_x"],
  );
  assert.equal(hub.pending(10).length, 2);

  await hub.unsubscribe({ name: ACTIVITY_CREATED, delivery: { url: URL_A } });
  assert.deepEqual(Object.keys(file.state.subscriptions), [drafts.id]);

  // A subscription saved before there were two events is for finished drafts.
  const saved = file.state;
  delete saved.subscriptions[drafts.id].name;
  const older = Object.assign(new MemoryFile(), { value: JSON.stringify(saved) });
  const reopened = await EventHub.open({ file: older, post: target.post, log: () => {} });
  target.calls.length = 0;
  await reopened.emit(ACTIVITY_CREATED, "activity:t1_y", { thing: "t1_y" });
  await reopened.emit(DRAFT_FINISHED, "draft:b:posted", { ref: "b" });
  await reopened.deliverDue();
  assert.deepEqual(
    target.calls.map((c) => c.headers["webhook-id"]),
    ["draft:b:posted"],
  );
});

const INBOX = channels.inboxChannelId;
const WEBHOOK = "700000000000000001";

function inboxItem(discord: FakeDiscord, envelope: Record<string, unknown>, text = "hello") {
  return discord.add(INBOX, {
    author: { id: WEBHOOK },
    webhook_id: WEBHOOK,
    content: JSON.stringify({ v: 1, byApp: false, truncated: false, ...envelope }),
    embeds: [{ description: text }],
  });
}

const comment = (thing: string, extra: Record<string, unknown> = {}) => ({
  event: "comment",
  thing,
  post: "t3_old",
  parent: "t3_old",
  author: "someone",
  url: `https://www.reddit.com/r/x/comments/old/${thing}/`,
  created: "2026-10-13T00:00:00Z",
  ...extra,
});

test("the activity watcher starts at the end of the inbox, then emits new items by reference", async () => {
  const discord = new FakeDiscord();
  const old = inboxItem(discord, { event: "post", thing: "t3_old", title: "Old", author: "u" });
  const { hub, file } = await open();
  await scanActivity(hub, discord, channels);
  assert.deepEqual(hub.pending(10), []);
  assert.equal(file.state.inboxCursor, old);

  const added = inboxItem(discord, comment("t1_new"), "Nice post");
  inboxItem(discord, comment("t1_mine", { author: "rokrokssss", byApp: true }));
  const last = discord.add(INBOX, {
    author: { id: AGENT },
    content: JSON.stringify({ v: 1, event: "comment", thing: "t1_fake" }),
  });
  await scanActivity(hub, discord, channels);
  await scanActivity(hub, discord, channels);
  assert.deepEqual(
    hub.pending(10).map((e) => [e.eventId, e.name, e.data]),
    [
      [
        "activity:t1_new",
        ACTIVITY_CREATED,
        {
          thing: "t1_new",
          kind: "comment",
          post: "t3_old",
          parent: "t3_old",
          url: "https://www.reddit.com/r/x/comments/old/t1_new/",
          created: "2026-10-13T00:00:00Z",
          messageId: added,
        },
      ],
    ],
  );
  assert.equal(file.state.inboxCursor, last);

  // After a restart it reads on from the saved cursor, across pages, in order.
  for (let i = 0; i < 150; i++) inboxItem(discord, comment(`t1_bulk${i}`));
  const restarted = await EventHub.open({ file, log: () => {} });
  await scanActivity(restarted, discord, channels);
  const ids = file.state.inbox.map((e: { eventId: string }) => e.eventId);
  assert.equal(ids.length, 151);
  assert.deepEqual(ids.slice(0, 3), ["activity:t1_new", "activity:t1_bulk0", "activity:t1_bulk1"]);
  assert.equal(ids.at(-1), "activity:t1_bulk149");

  // An empty inbox starts at the beginning.
  const empty = new FakeDiscord();
  const fresh = await open();
  await scanActivity(fresh.hub, empty, channels);
  assert.equal(fresh.file.state.inboxCursor, "0");
  inboxItem(empty, comment("t1_first"));
  await scanActivity(fresh.hub, empty, channels);
  assert.deepEqual(
    fresh.hub.pending(10).map((e) => e.eventId),
    ["activity:t1_first"],
  );
});

test("pending activity carries the item's current text, or null once Reddit deleted it", async () => {
  const discord = new FakeDiscord();
  const { hub } = await open();
  const call = await connect(discord, hub);
  await scanActivity(hub, discord, channels);
  inboxItem(discord, comment("t1_kept"), "still here");
  const gone = inboxItem(discord, comment("t1_gone"), "deleted soon");
  await scanActivity(hub, discord, channels);
  await hub.emit(DRAFT_FINISHED, "draft:x:posted", { ref: "x", state: "posted" });
  // The bridge deletes the copy when the comment is deleted on Reddit.
  discord.stored.set(
    INBOX,
    discord.stored.get(INBOX)!.filter((m) => m.id !== gone),
  );

  const activity = await call("reddit_get_pending_events", { name: ACTIVITY_CREATED });
  assert.deepEqual(
    activity.events.map((e: { eventId: string; item: { text: string } | null }) => [
      e.eventId,
      e.item && e.item.text,
    ]),
    [
      ["activity:t1_kept", "still here"],
      ["activity:t1_gone", null],
    ],
  );
  assert.equal(activity.events[0].item.author, "someone");
  const drafts = await call("reddit_get_pending_events", { name: DRAFT_FINISHED });
  assert.deepEqual(
    drafts.events.map((e: { item?: unknown }) => e.item),
    [undefined],
  );
  assert.equal((await call("reddit_get_pending_events")).events.length, 3);
});

test("status shows subscriptions, pending events and the last delivery, not URLs or secrets", async () => {
  const target = callback();
  const { hub, file, advance } = await open(new MemoryFile(), target.post);
  const empty = {
    events: [
      { name: DRAFT_FINISHED, subscriptions: 0, pending: 0 },
      { name: ACTIVITY_CREATED, subscriptions: 0, pending: 0 },
    ],
    queued: 0,
  };
  assert.deepEqual(await eventStatus(file), empty);
  assert.match(describeEvents(empty), /^reddit\.draft\.finished not subscribed, 0 pending \| /);

  await hub.subscribe(subscribeParams());
  await hub.subscribe({ ...subscribeParams(), name: ACTIVITY_CREATED });
  target.answer = { status: 500 };
  await hub.emit(DRAFT_FINISHED, "draft:a:posted", { ref: "a" });
  await hub.deliverDue();
  let status = await eventStatus(file);
  assert.deepEqual(
    status.events.map((e) => [e.subscriptions, e.pending]),
    [
      [1, 1],
      [1, 0],
    ],
  );
  assert.deepEqual(status.lastDelivery, {
    at: new Date(START).toISOString(),
    event: DRAFT_FINISHED,
    status: 500,
  });
  assert.equal(status.queued, 1);
  for (const secret of [SECRET, URL_A]) assert.ok(!JSON.stringify(status).includes(secret));
  assert.match(describeEvents(status), /reddit\.draft\.finished: HTTP 500, 1 queued$/);

  // A 410 or an unsubscribe ends an event's last subscription; subscribing again clears it.
  advance(5_000);
  target.answer = { status: 410 };
  await hub.deliverDue();
  status = await eventStatus(file);
  assert.equal(status.events[0].subscriptions, 0);
  assert.equal(status.events[0].endedAt, new Date(START + 5_000).toISOString());
  assert.match(describeEvents(status), /subscription ended .* \(ask your dot to subscribe again\)/);
  // Another dot's subscription to the same event keeps it going.
  await hub.subscribe({ ...subscribeParams(SECRET, URL_B), name: ACTIVITY_CREATED });
  await hub.unsubscribe({ name: ACTIVITY_CREATED, delivery: { url: URL_A } });
  assert.equal((await eventStatus(file)).events[1].endedAt, undefined);
  await hub.unsubscribe({ name: ACTIVITY_CREATED, delivery: { url: URL_B } });
  assert.ok((await eventStatus(file)).events[1].endedAt);
  await hub.subscribe(subscribeParams());
  assert.equal((await eventStatus(file)).events[0].endedAt, undefined);
});
