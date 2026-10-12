import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDraft } from "../src/draft.js";

test("plain JSON", () => {
  assert.deepEqual(parseDraft('{"title":" Hello ","text":"Body"}'), {
    ok: true,
    draft: { title: "Hello", text: "Body" },
  });
});

test("fenced JSON without text", () => {
  assert.deepEqual(parseDraft('```json\n{"title":"Hello"}\n```'), {
    ok: true,
    draft: { title: "Hello", text: "" },
  });
});

test("empty content points at the intent", () => {
  const result = parseDraft("");
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /Message Content intent/);
});

test("rejects non-JSON, missing title, long title and non-string text", () => {
  assert.equal(parseDraft("hello").ok, false);
  assert.equal(parseDraft('{"text":"x"}').ok, false);
  assert.equal(parseDraft(JSON.stringify({ title: "x".repeat(301) })).ok, false);
  assert.equal(parseDraft('{"title":"x","text":5}').ok, false);
});
