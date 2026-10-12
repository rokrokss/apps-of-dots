import { test } from "node:test";
import assert from "node:assert/strict";
import * as agent from "../src/protocol.js";
import * as bridge from "../devvit/src/protocol.js";
import { inboxMessage } from "../devvit/src/inbox.js";

// The agent keeps its own copy of the framing code (see src/protocol.ts); these tests fail if
// it drifts from the bridge that runs on Reddit.

const texts = [
  "",
  "short",
  "a".repeat(1_990),
  "b".repeat(5_000),
  "c".repeat(9_000),
  "d".repeat(4_095) + "😀" + "e".repeat(10),
];

test("both sides use the same limits and framing", () => {
  assert.equal(agent.MAX_TEXT, bridge.MAX_TEXT);
  assert.equal(agent.MAX_TITLE, bridge.MAX_TITLE);
  for (const text of texts) {
    assert.deepEqual(
      agent.frame({ event: "post", thing: "t3_x" }, text),
      bridge.frame({ event: "post", thing: "t3_x" }, text),
    );
  }
});

test("every request the agent frames parses unchanged on the bridge", () => {
  for (const text of texts.filter((t) => t.length <= agent.MAX_TEXT && t.trim())) {
    const post = agent.frame({ op: "post", ref: "r1", title: "Title" }, text);
    assert.deepEqual(bridge.parseRequest(post), {
      ok: true,
      request: { op: "post", ref: "r1", title: "Title", text },
    });
    const reply = agent.frame({ op: "reply", ref: "r2", parent: "t1_abc" }, text);
    assert.deepEqual(bridge.parseRequest(reply), {
      ok: true,
      request: { op: "reply", ref: "r2", parent: "t1_abc", text },
    });
  }
});

test("the agent reads the bridge's inbox messages back to the full text", () => {
  for (const text of texts.filter((t) => t.length <= agent.MAX_TEXT)) {
    const message = inboxMessage(
      {
        kind: "comment",
        thing: "t1_c",
        post: "t3_p",
        parent: "t3_p",
        author: "someone",
        url: "https://www.reddit.com/r/x/comments/p/x/c/",
        created: new Date(0),
        text,
        visible: true,
      },
      "app",
    );
    const read = agent.readMessage(message);
    assert.equal(read?.text, text);
    assert.equal(read?.envelope.event, "comment");
  }
  assert.equal(agent.readMessage({ content: "chatter" }), undefined);
  assert.equal(agent.readMessage({ content: '{"v":2}' }), undefined);
});
