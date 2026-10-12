import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseRequest } from "../devvit/src/protocol.js";
import { inspectTools, TOOL_COUNT } from "../src/server.js";
import { AGENT, BRIDGE, channels, connect, FakeDiscord } from "./fakes.js";

const outbox = channels.outboxChannelId;
const inbox = channels.inboxChannelId;

test("the seven tools match the frozen contract and list without Discord", async () => {
  const tools = await inspectTools();
  assert.equal(tools.length, TOOL_COUNT);
  const snapshot = JSON.parse(
    await readFile(new URL("../../core/test/contracts/reddit.json", import.meta.url), "utf8"),
  );
  const normalized = tools
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(normalized, snapshot.tools);
});

test("submitting writes a request the bridge accepts, with long text in embeds", async () => {
  const discord = new FakeDiscord();
  const call = await connect(discord);
  const sent = await call("reddit_submit_post", {
    title: "Hello",
    text: "x".repeat(3_000),
    ref: "hello-1",
  });
  assert.equal(sent.ref, "hello-1");
  const [message] = discord.stored.get(outbox)!;
  assert.equal(message!.id, sent.messageId);
  assert.equal(message!.embeds!.length, 1);
  assert.deepEqual(parseRequest({ content: message!.content, embeds: message!.embeds! }), {
    ok: true,
    request: { op: "post", ref: "hello-1", title: "Hello", text: "x".repeat(3_000) },
  });

  const reply = await call("reddit_reply", { parent: "t1_abc", text: "Thanks" });
  assert.match(reply.ref, /^reply-[0-9a-f]{8}$/);
});

test("inputs outside the protocol limits are refused before anything is sent", async () => {
  const discord = new FakeDiscord();
  const call = await connect(discord);
  for (const [tool, args] of [
    ["reddit_submit_post", { title: "x".repeat(301) }],
    ["reddit_submit_post", { title: "ok", text: "x".repeat(6_001) }],
    ["reddit_submit_post", { title: "ok", ref: "has space" }],
    ["reddit_reply", { parent: "t5_sub", text: "hi" }],
    ["reddit_reply", { parent: "t1_abc", text: "  " }],
  ] as const) {
    assert.ok((await call(tool, args)).error, `${tool} ${JSON.stringify(args)}`);
  }
  assert.equal(discord.stored.get(outbox), undefined);
});

test("draft state comes from the bridge's reply, trusting only the bridge bot", async () => {
  const discord = new FakeDiscord();
  const call = await connect(discord);
  await call("reddit_submit_post", { title: "Waiting", ref: "a" });
  const posted = (await call("reddit_submit_post", { title: "Done", ref: "b" })).messageId;
  discord.add(outbox, {
    author: { id: BRIDGE },
    content: JSON.stringify({
      v: 1,
      ref: "b",
      status: "posted",
      thing: "t3_p",
      url: "https://www.reddit.com/p",
      edited: true,
    }),
    message_reference: { message_id: posted },
  });
  // A status from anyone else is ignored.
  discord.add(outbox, {
    author: { id: "900000000000000099" },
    content: JSON.stringify({ v: 1, ref: "a", status: "posted", url: "https://evil" }),
  });

  assert.deepEqual(await call("reddit_get_draft", { ref: "a" }), {
    ref: "a",
    state: "sent",
    op: "post",
    title: "Waiting",
    requestMessageId: discord.stored.get(outbox)![0]!.id,
  });
  const b = await call("reddit_get_draft", { ref: "b" });
  assert.equal(b.state, "posted");
  assert.equal(b.title, "Done");
  assert.equal(b.url, "https://www.reddit.com/p");
  assert.deepEqual(await call("reddit_get_draft", { ref: "zzz" }), {
    ref: "zzz",
    state: "not_found",
  });

  const all = await call("reddit_list_drafts");
  assert.deepEqual(
    all.drafts.map((d: { ref: string }) => d.ref),
    ["b", "a"],
  );
  const posts = await call("reddit_list_drafts", { state: "posted" });
  assert.deepEqual(
    posts.drafts.map((d: { ref: string }) => d.ref),
    ["b"],
  );

  // Re-sending a ref the bridge already answered does not hide the answer.
  await call("reddit_submit_post", { title: "Done", ref: "b" });
  assert.equal((await call("reddit_get_draft", { ref: "b" })).state, "posted");
});

test("activity lists webhook events oldest first and pages with a cursor", async () => {
  const discord = new FakeDiscord();
  const call = await connect(discord);
  const event = (thing: string, text: string) =>
    discord.add(inbox, {
      author: { id: "700000000000000001" },
      webhook_id: "700000000000000001",
      content: JSON.stringify({ v: 1, event: "comment", thing, truncated: false }),
      embeds: [{ description: text }],
    });
  event("t1_one", "first");
  discord.add(inbox, {
    author: { id: AGENT },
    content: '{"v":1,"event":"comment","thing":"t1_fake"}',
  });
  const second = event("t1_two", "second");

  const page = await call("reddit_list_activity", { limit: 10 });
  assert.deepEqual(
    page.items.map((i: { thing: string; text: string }) => [i.thing, i.text]),
    [
      ["t1_one", "first"],
      ["t1_two", "second"],
    ],
  );
  assert.equal(page.cursor, second);

  event("t1_three", "third");
  const next = await call("reddit_list_activity", { after: page.cursor });
  assert.deepEqual(
    next.items.map((i: { thing: string }) => i.thing),
    ["t1_three"],
  );
  const empty = await call("reddit_list_activity", { after: next.cursor });
  assert.deepEqual(empty, { items: [], cursor: next.cursor });
});

test("event tools explain that only the tunnel's server keeps events", async () => {
  const call = await connect(new FakeDiscord());
  assert.match((await call("reddit_get_pending_events")).error, /reddit start/);
  assert.match(
    (await call("reddit_acknowledge_events", { eventIds: ["x"] })).error,
    /reddit start/,
  );
});
