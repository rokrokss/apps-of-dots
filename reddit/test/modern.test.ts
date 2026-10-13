import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { DRAFT_FINISHED, EventHub } from "../src/events.js";
import { isModern } from "../src/modern.js";
import { serve, TOOL_COUNT } from "../src/server.js";
import { channels, FakeDiscord } from "./fakes.js";

const tag = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
};

test("only 2026-07-28 requests and event methods are answered outside the SDK", () => {
  assert.ok(isModern({ jsonrpc: "2.0", id: 1, method: "server/discover" }));
  assert.ok(isModern({ jsonrpc: "2.0", id: "x", method: "tools/list", params: { _meta: tag } }));
  assert.ok(isModern({ jsonrpc: "2.0", id: 2, method: "events/subscribe", params: {} }));
  assert.ok(!isModern({ jsonrpc: "2.0", id: 3, method: "tools/list" }));
  assert.ok(!isModern({ jsonrpc: "2.0", id: 4, method: "initialize", params: {} }));
  assert.ok(!isModern({ jsonrpc: "2.0", method: "notifications/initialized" }));
  assert.ok(!isModern({ jsonrpc: "2.0", id: 5, result: {} }));
  assert.ok(!isModern(undefined));
});

test("stdio serves the legacy handshake and MCP 2026-07-28 with events side by side", async () => {
  let stored: string | undefined;
  const hub = await EventHub.open({
    file: { read: async () => stored, write: async (value) => void (stored = value) },
    post: async () => ({ status: 200, body: "{}", retryAfterMs: 0 }),
    log: () => {},
  });
  const input = new PassThrough();
  const output = new PassThrough();
  const answers = new Map<unknown, (message: Record<string, any>) => void>();
  createInterface({ input: output }).on("line", (line) => {
    const message = JSON.parse(line);
    answers.get(message.id)?.(message);
  });
  const served = serve(new FakeDiscord(), channels, hub, input, output);
  let next = 0;
  const call = (method: string, params?: Record<string, unknown>, modern = true) => {
    const id = ++next;
    const answer = new Promise<Record<string, any>>((resolve) => answers.set(id, resolve));
    const body = modern ? { ...params, _meta: tag } : params;
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: body }) + "\n");
    return answer;
  };

  const init = await call(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "legacy", version: "0" },
    },
    false,
  );
  assert.equal(init.result.serverInfo.name, "apps-of-dots-reddit");
  input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const legacyTools = await call("tools/list", {}, false);
  assert.equal(legacyTools.result.tools.length, TOOL_COUNT);
  assert.equal(legacyTools.result.resultType, undefined);

  const discover = await call("server/discover", {});
  assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"]);
  assert.deepEqual(discover.result.capabilities, { tools: {}, events: {} });
  assert.match(discover.result.instructions, /reddit_get_pending_events/);
  assert.equal(discover.result.resultType, "complete");
  assert.equal(
    discover.result._meta["io.modelcontextprotocol/serverInfo"].name,
    "apps-of-dots-reddit",
  );

  const tools = await call("tools/list", {});
  assert.equal(tools.result.tools.length, TOOL_COUNT);
  assert.equal(tools.result.resultType, "complete");

  await hub.emit(DRAFT_FINISHED, "draft:a:posted", { ref: "a", state: "posted" });
  const pending = await call("tools/call", {
    name: "reddit_get_pending_events",
    arguments: {},
  });
  assert.deepEqual(
    JSON.parse(pending.result.content[0].text).events.map((e: { eventId: string }) => e.eventId),
    ["draft:a:posted"],
  );
  const acked = await call("tools/call", {
    name: "reddit_acknowledge_events",
    arguments: { eventIds: ["draft:a:posted"] },
  });
  assert.deepEqual(JSON.parse(acked.result.content[0].text), { acknowledged: 1, pending: 0 });

  const events = await call("events/list", {});
  assert.deepEqual(
    events.result.events.map((e: { name: string }) => e.name),
    ["reddit.draft.finished", "reddit.activity.created"],
  );
  assert.match(discover.result.instructions, /reddit\.activity\.created/);
  const refused = await call("events/subscribe", {
    name: "reddit.draft.finished",
    delivery: { mode: "webhook", url: "https://evil.example/cb", secret: "whsec_x" },
  });
  assert.equal(refused.error.code, -32602);
  const badUrl = await call("events/subscribe", {
    name: "reddit.draft.finished",
    delivery: {
      mode: "webhook",
      url: "https://evil.example/cb",
      secret: "whsec_" + Buffer.alloc(32).toString("base64"),
    },
  });
  assert.deepEqual(badUrl.error.data, { reason: "invalid_url" });

  const unknownTool = await call("tools/call", { name: "reddit_nope", arguments: {} });
  assert.ok(unknownTool.error?.code === -32602 || unknownTool.result?.isError);
  input.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "v",
      method: "tools/list",
      params: { _meta: { ...tag, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } },
    }) + "\n",
  );
  const unsupported = await new Promise<Record<string, any>>((resolve) =>
    answers.set("v", resolve),
  );
  assert.equal(unsupported.error.code, -32022);
  assert.deepEqual(unsupported.error.data, {
    supported: ["2026-07-28"],
    requested: "2099-01-01",
  });
  assert.equal((await call("initialize", {})).error.code, -32022);
  assert.equal((await call("resources/list", {})).error.code, -32601);

  input.end();
  await served;
});
