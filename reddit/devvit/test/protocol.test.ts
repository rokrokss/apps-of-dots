import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoModeAllows,
  frame,
  normalizeTitle,
  parseRequest,
  statusContent,
} from "../src/protocol.js";

const parse = (envelope: unknown, embeds: { description?: string }[] = []) =>
  parseRequest({
    content: typeof envelope === "string" ? envelope : JSON.stringify(envelope),
    embeds,
  });

test("parses posts and replies, joining text from content and embeds in order", () => {
  assert.deepEqual(
    parse({ v: 1, op: "post", ref: "a.1", title: " Hi ", text: "one " }, [{ description: "two" }]),
    { ok: true, request: { op: "post", ref: "a.1", title: "Hi", text: "one two" } },
  );
  assert.deepEqual(parse({ v: 1, op: "reply", ref: "r", parent: "t1_abc", text: "yes" }), {
    ok: true,
    request: { op: "reply", ref: "r", parent: "t1_abc", text: "yes" },
  });
});

test("rejects bad requests with the reason and, when readable, the ref", () => {
  assert.deepEqual(parse("not json"), {
    ok: false,
    reason: "bad_request",
    detail: "content is not JSON",
  });
  assert.deepEqual(parse({ v: 2, op: "post", ref: "x", title: "t" }), {
    ok: false,
    reason: "unsupported_version",
    ref: "x",
  });
  const cases: [unknown, string][] = [
    [{ v: 1, op: "post", ref: "has space", title: "t" }, "bad_request"],
    [{ v: 1, op: "post", ref: "x", title: "x".repeat(301) }, "bad_request"],
    [{ v: 1, op: "post", ref: "x", title: "t", text: 5 }, "bad_request"],
    [{ v: 1, op: "reply", ref: "x", parent: "t5_sub", text: "a" }, "bad_request"],
    [{ v: 1, op: "reply", ref: "x", parent: "t1_a", text: " " }, "bad_request"],
    [{ v: 1, op: "delete", ref: "x" }, "bad_request"],
    [{ v: 1, op: "post", ref: "x", title: "t", text: "x".repeat(6001) }, "too_long"],
  ];
  for (const [envelope, reason] of cases) {
    const result = parse(envelope);
    assert.equal(result.ok, false, JSON.stringify(envelope));
    assert.equal(!result.ok && result.reason, reason, JSON.stringify(envelope));
  }
});

test("status carries thing, url and edited only once posted", () => {
  assert.deepEqual(JSON.parse(statusContent({ ref: "a", status: "queued" })), {
    v: 1,
    ref: "a",
    status: "queued",
  });
  assert.deepEqual(
    JSON.parse(
      statusContent({ ref: "a", status: "posted", thing: "t3_x", url: "u", edited: true }),
    ),
    { v: 1, ref: "a", status: "posted", thing: "t3_x", url: "u", edited: true },
  );
  const failed = JSON.parse(
    statusContent({ status: "failed", reason: "reddit_error", detail: "e".repeat(900) }),
  );
  assert.equal(failed.ref, undefined);
  assert.equal(failed.detail.length, 300);
});

test("frame keeps short text inline and moves long text into embeds", () => {
  const short = frame({ event: "post" }, "hello");
  assert.deepEqual(JSON.parse(short.content), {
    v: 1,
    event: "post",
    truncated: false,
    text: "hello",
  });
  assert.deepEqual(short.embeds, []);

  const long = frame({ event: "post" }, "a".repeat(5_000));
  assert.equal(JSON.parse(long.content).text, undefined);
  assert.deepEqual(
    long.embeds.map((e) => e.description.length),
    [4_096, 904],
  );

  const huge = frame({ event: "post" }, "b".repeat(9_000));
  assert.equal(JSON.parse(huge.content).truncated, true);
  assert.equal(huge.embeds.map((e) => e.description).join("").length, 6_000);
});

test("frame never splits an emoji across embeds", () => {
  const text = "a".repeat(4_095) + "😀" + "b".repeat(2_000);
  const { embeds } = frame({}, text);
  assert.equal(embeds[0]!.description.length, 4_095);
  assert.ok(embeds[1]!.description.startsWith("😀"));
});

test("auto mode limits per 24 hours and minimum spacing", () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  const minutes = (n: number) => now - n * 60 * 1000;
  assert.equal(autoModeAllows([], now, 2, 30), true);
  assert.equal(autoModeAllows([minutes(10)], now, 2, 30), false);
  assert.equal(autoModeAllows([minutes(40)], now, 2, 30), true);
  assert.equal(autoModeAllows([minutes(100), minutes(40)], now, 2, 30), false);
  assert.equal(autoModeAllows([minutes(25 * 60), minutes(40)], now, 2, 30), true);
});

test("titles compare case- and whitespace-insensitively", () => {
  assert.equal(normalizeTitle("  Hello   World "), normalizeTitle("hello world"));
});
