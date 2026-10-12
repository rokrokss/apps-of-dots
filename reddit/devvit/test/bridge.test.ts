import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, oldestQueued, poll } from "../src/bridge.js";
import { acquireLock, keys } from "../src/store.js";
import { bridgeDeps } from "./fakes.js";

const MINUTE = 60 * 1000;

async function started(config: Parameters<typeof bridgeDeps>[0] = {}) {
  const t = bridgeDeps(config);
  await poll(t.deps); // first run only sets the cursor
  return t;
}

test("the first run skips messages written before installation", async () => {
  const t = bridgeDeps();
  const old = t.outbox.request({ op: "post", ref: "old", title: "Old" });
  await poll(t.deps);
  assert.deepEqual(t.outbox.statuses(old), []);
  assert.equal(await t.deps.kv.get(keys.cursor), old);

  const fresh = t.outbox.request({ op: "post", ref: "new", title: "New" });
  await poll(t.deps);
  assert.deepEqual(t.outbox.statuses(fresh), [{ v: 1, ref: "new", status: "queued" }]);
});

test("only the agent's messages are read, but the cursor passes everything", async () => {
  const t = await started();
  t.outbox.send(JSON.stringify({ v: 1, op: "post", ref: "x", title: "Spoof" }), "999");
  const last = t.outbox.send("chatter", "999");
  await poll(t.deps);
  assert.equal(t.outbox.replies.size, 0);
  assert.equal(await t.deps.kv.get(keys.cursor), last);
});

test("manual mode queues; a moderator's edits are posted and reported", async () => {
  const t = await started();
  const id = t.outbox.request({ op: "post", ref: "welcome", title: "Welcome", text: "Hi" });
  await poll(t.deps);
  assert.equal(t.poster.posts.length, 0);
  assert.equal((await oldestQueued(t.deps))?.draft.ref, "welcome");

  const toast = await decide(t.deps, "welcome", { approve: true, title: "Welcome!", text: "Hi" });
  assert.match(toast, /^Posted: https:/);
  assert.deepEqual(t.poster.posts, [{ title: "Welcome!", text: "Hi" }]);
  // One status reply per request, edited in place.
  assert.deepEqual(t.outbox.statuses(id), [
    {
      v: 1,
      ref: "welcome",
      status: "posted",
      thing: "t3_p1",
      url: t.outbox.statuses(id)[0]!.url,
      edited: true,
    },
  ]);
  assert.equal(await oldestQueued(t.deps), undefined);
  assert.equal(
    await decide(t.deps, "welcome", { approve: false }),
    "This draft was already handled.",
  );
});

test("a moderator can reject with a note", async () => {
  const t = await started();
  const id = t.outbox.request({ op: "post", ref: "spam", title: "Buy now" });
  await poll(t.deps);
  await decide(t.deps, "spam", { approve: false, note: "off topic" });
  assert.deepEqual(t.outbox.statuses(id), [
    { v: 1, ref: "spam", status: "rejected", reason: "moderator", detail: "off topic" },
  ]);
});

test("a repeated ref is answered with the original status and never runs twice", async () => {
  const t = await started({ approvalMode: "auto" });
  t.outbox.request({ op: "post", ref: "once", title: "Once" });
  await poll(t.deps);
  const again = t.outbox.request({ op: "post", ref: "once", title: "Once" });
  await poll(t.deps);
  assert.equal(t.poster.posts.length, 1);
  assert.equal(t.outbox.statuses(again)[0]!.status, "posted");
});

test("unreadable requests are rejected without a ref", async () => {
  const t = await started();
  const id = t.outbox.send("{not json");
  await poll(t.deps);
  assert.deepEqual(t.outbox.statuses(id), [
    { v: 1, status: "rejected", reason: "bad_request", detail: "content is not JSON" },
  ]);
});

test("auto mode posts within the spacing and daily cap", async () => {
  const t = await started({ approvalMode: "auto", maxPostsPerDay: 2, minMinutesBetweenPosts: 30 });
  t.outbox.request({ op: "post", ref: "a", title: "A" });
  t.outbox.request({ op: "post", ref: "b", title: "B" });
  await poll(t.deps);
  assert.deepEqual(
    t.poster.posts.map((p) => p.title),
    ["A"],
  );

  t.clock.now += 31 * MINUTE;
  t.outbox.request({ op: "post", ref: "c", title: "C" });
  await poll(t.deps);
  assert.deepEqual(
    t.poster.posts.map((p) => p.title),
    ["A", "B"],
  );

  t.clock.now += 31 * MINUTE;
  await poll(t.deps);
  assert.equal(t.poster.posts.length, 2, "two in 24 hours is the cap");
  t.clock.now += 24 * 60 * MINUTE;
  await poll(t.deps);
  assert.deepEqual(
    t.poster.posts.map((p) => p.title),
    ["A", "B", "C"],
  );
});

test("auto mode rejects a title posted in the last 7 days", async () => {
  const t = await started({ approvalMode: "auto", minMinutesBetweenPosts: 0 });
  t.outbox.request({ op: "post", ref: "a", title: "Daily thread" });
  const dup = t.outbox.request({ op: "post", ref: "b", title: "daily  THREAD" });
  await poll(t.deps);
  assert.equal(t.poster.posts.length, 1);
  assert.equal(t.outbox.statuses(dup)[0]!.reason, "duplicate");
});

test("replies must target this subreddit", async () => {
  const t = await started({ approvalMode: "auto", minMinutesBetweenPosts: 0 });
  t.poster.subreddits.set("t1_here", "Home").set("t3_there", "elsewhere");
  const ok = t.outbox.request({ op: "reply", ref: "r1", parent: "t1_here", text: "hi" });
  const away = t.outbox.request({ op: "reply", ref: "r2", parent: "t3_there", text: "hi" });
  const gone = t.outbox.request({ op: "reply", ref: "r3", parent: "t1_gone", text: "hi" });
  await poll(t.deps);
  assert.deepEqual(t.poster.comments, [{ parent: "t1_here", text: "hi" }]);
  assert.equal(t.outbox.statuses(ok)[0]!.status, "posted");
  assert.equal(t.outbox.statuses(away)[0]!.reason, "wrong_subreddit");
  assert.equal(t.outbox.statuses(gone)[0]!.reason, "bad_request");
});

test("a Reddit failure is reported once and not retried", async () => {
  const t = await started({ approvalMode: "auto" });
  t.poster.fail = true;
  const id = t.outbox.request({ op: "post", ref: "a", title: "A" });
  await poll(t.deps);
  t.poster.fail = false;
  t.clock.now += 60 * MINUTE;
  await poll(t.deps);
  assert.equal(t.poster.posts.length, 0);
  assert.deepEqual(
    t.outbox.statuses(id).map((s) => [s.status, s.reason]),
    [["failed", "reddit_error"]],
  );
});

test("a failed read keeps the cursor so the next run reads the same messages", async () => {
  const t = await started();
  const before = await t.deps.kv.get(keys.cursor);
  const id = t.outbox.request({ op: "post", ref: "a", title: "A" });
  t.outbox.failRead = true;
  await assert.rejects(poll(t.deps), /503/);
  assert.equal(await t.deps.kv.get(keys.cursor), before);
  t.outbox.failRead = false;
  await poll(t.deps);
  assert.equal(t.outbox.statuses(id)[0]!.status, "queued");
});

test("drafts left for 7 days expire", async () => {
  const t = await started();
  const id = t.outbox.request({ op: "post", ref: "a", title: "A" });
  await poll(t.deps);
  t.clock.now += 7 * 24 * 60 * MINUTE;
  await poll(t.deps);
  assert.equal(t.outbox.statuses(id)[0]!.status, "expired");
  assert.equal(await oldestQueued(t.deps), undefined);
});

test("a run that finds the lock held does nothing", async () => {
  const t = await started({ approvalMode: "auto" });
  t.outbox.request({ op: "post", ref: "a", title: "A" });
  assert.equal(await acquireLock(t.deps.kv, t.clock.now), true);
  await poll(t.deps);
  assert.equal(t.poster.posts.length, 0);
});
