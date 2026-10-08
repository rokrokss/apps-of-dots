import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { inspectTools, discordEnvironment } from "../src/upstream.js";
import { stdioEntry } from "../dist/runtime.js";
import { saveConfig } from "../src/config.js";
import { fixture } from "../../test/helpers.js";

test(
  "the real stdio wrapper preserves all 99 upstream tool schemas, including writes",
  { timeout: 30_000 },
  async (t) => {
    const { home, binary } = await fixture(t);
    await saveConfig(
      home,
      { tunnelId: "tunnel_test", tunnelClient: binary, allowedGuilds: [] },
      { bot: "unused-test-token", tunnel: "unused-test-key" },
    );
    const original = await inspectTools();
    const wrapped = await inspectTools(process.execPath, [stdioEntry(), home], {
      ...discordEnvironment(""),
      DISCORD_MCP_TOOLSETS: "discovery",
      DISCORD_ALLOWED_GUILDS: "123456789012345678",
    });
    assert.equal(wrapped.length, 99);
    assert.deepEqual(wrapped, original);
    for (const part of [
      "send_message",
      "delete_message",
      "ban_member",
      "create_role",
      "create_webhook",
    ]) {
      assert.ok(
        wrapped.some((tool) => tool.name.includes(part)),
        `Missing ${part}`,
      );
    }
  },
);

test(
  "JSON-RPC calls reach the upstream server and errors return over stdio",
  { timeout: 20_000 },
  async (t) => {
    const { home, binary } = await fixture(t);
    await saveConfig(
      home,
      { tunnelId: "tunnel_test", tunnelClient: binary, allowedGuilds: [] },
      { bot: "unused-test-token", tunnel: "unused-test-key" },
    );
    const client = new Client({ name: "test-client", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [stdioEntry(), home],
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      await assert.rejects(
        client.callTool({ name: "__unknown_test_tool", arguments: {} }),
        /Unknown tool/,
      );
    } finally {
      await client.close();
      await transport.close();
    }
  },
);
