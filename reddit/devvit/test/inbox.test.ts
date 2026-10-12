import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inboxMessage,
  onCreated,
  onDeleted,
  onUpdated,
  sweep,
  type InboxItem,
} from "../src/inbox.js";
import { inboxDeps } from "./fakes.js";

const DAY = 24 * 60 * 60 * 1000;

const comment = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  kind: "comment",
  thing: "t1_c",
  post: "t3_p",
  parent: "t3_p",
  author: "someone",
  url: "https://www.reddit.com/r/home/comments/p/x/c/",
  created: new Date("2026-10-12T00:00:00Z"),
  text: "Nice",
  visible: true,
  ...overrides,
});

const body = (t: ReturnType<typeof inboxDeps>) =>
  [...t.webhook.messages.values()].map((m) => JSON.parse(m.content));

test("a new item is sent once; a repeated trigger edits the same message", async () => {
  const t = inboxDeps();
  t.items.set("t1_c", comment());
  await onCreated(t.deps, "t1_c");
  await onCreated(t.deps, "t1_c");
  assert.deepEqual(body(t), [
    {
      v: 1,
      event: "comment",
      thing: "t1_c",
      post: "t3_p",
      parent: "t3_p",
      author: "someone",
      byApp: false,
      url: "https://www.reddit.com/r/home/comments/p/x/c/",
      created: "2026-10-12T00:00:00.000Z",
      truncated: false,
      text: "Nice",
    },
  ]);
});

test("removed, filtered or missing items never leave Reddit", async () => {
  const t = inboxDeps();
  t.items.set("t1_c", comment({ visible: false }));
  await onCreated(t.deps, "t1_c");
  await onCreated(t.deps, "t1_missing");
  assert.equal(t.webhook.messages.size, 0);
});

test("edits update the copy, and removal deletes it", async () => {
  const t = inboxDeps();
  t.items.set("t1_c", comment());
  await onCreated(t.deps, "t1_c");
  t.items.set("t1_c", comment({ text: "Edited" }));
  await onUpdated(t.deps, "t1_c");
  assert.equal(body(t)[0].text, "Edited");
  assert.equal(body(t)[0].edited, "2026-10-12T00:00:00.000Z");

  t.items.set("t1_c", comment({ visible: false }));
  await onUpdated(t.deps, "t1_c");
  assert.equal(t.webhook.messages.size, 0);
});

test("a deletion removes the copy and forgets it", async () => {
  const t = inboxDeps();
  t.items.set("t1_c", comment());
  await onCreated(t.deps, "t1_c");
  await onDeleted(t.deps, "t1_c");
  assert.equal(t.webhook.messages.size, 0);
  await onUpdated(t.deps, "t1_c");
  assert.equal(t.webhook.messages.size, 0, "an update after deletion sends nothing");
});

test("the sweep deletes copies after 30 days and retries failed deletions", async () => {
  const t = inboxDeps();
  t.items.set("t1_old", comment({ thing: "t1_old" }));
  await onCreated(t.deps, "t1_old");
  t.clock.now += 29 * DAY;
  t.items.set("t1_new", comment({ thing: "t1_new" }));
  await onCreated(t.deps, "t1_new");

  t.clock.now += 2 * DAY;
  await sweep(t.deps);
  assert.deepEqual(
    body(t).map((m) => m.thing),
    ["t1_new"],
  );

  t.webhook.failRemove = true;
  await onDeleted(t.deps, "t1_new");
  assert.equal(t.webhook.messages.size, 1);
  t.webhook.failRemove = false;
  await sweep(t.deps);
  assert.equal(t.webhook.messages.size, 0, "a failed deletion is due at the next sweep");
});

test("posts carry the title and link, and the app's own items are marked", () => {
  const post: InboxItem = {
    kind: "post",
    thing: "t3_p",
    author: "RokRokssss",
    title: "Hello",
    link: "https://example.com/",
    url: "https://www.reddit.com/r/home/comments/p/hello/",
    created: new Date(0),
    text: "x".repeat(3_000),
    visible: true,
  };
  const message = inboxMessage(post, "rokrokssss");
  const envelope = JSON.parse(message.content);
  assert.equal(envelope.byApp, true);
  assert.equal(envelope.title, "Hello");
  assert.equal(envelope.link, "https://example.com/");
  assert.equal(envelope.post, undefined);
  assert.equal(message.embeds[0]!.description.length, 3_000);
});
