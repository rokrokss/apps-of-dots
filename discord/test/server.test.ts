import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { inspectTools, discordEnvironment } from "../src/server.js";
import { stdioEntry } from "../dist/runtime.js";
import { saveConfig } from "../src/config.js";
import { fixture } from "../../test/helpers.js";
import { readFile } from "node:fs/promises";

test(
  "local Discord and its stdio wrapper preserve the frozen 99-tool contract",
  { timeout: 30_000 },
  async (t) => {
    const { home, binary } = await fixture(t);
    await saveConfig(
      home,
      { tunnelId: "tunnel_test", tunnelClient: binary, allowedGuilds: [] },
      { bot: "unused-test-token", tunnel: "unused-test-key" },
    );
    const original = await inspectTools();
    const snapshot = JSON.parse(
      await readFile(new URL("../../test/contracts/discord.json", import.meta.url), "utf8"),
    );
    const normalized = original
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      .sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(normalized, snapshot.tools);
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

test("the local Discord server receives runtime basics, not unrelated shell credentials", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      OPENAI_API_KEY: "other-key",
      NODE_EXTRA_CA_CERTS: "/certs/extra.pem",
      DISCORD_MCP_TOOLSETS: "discovery",
    });
    const env = discordEnvironment("bot-token", ["123456789012345678"]);
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.NODE_EXTRA_CA_CERTS, "/certs/extra.pem");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.DISCORD_TOKEN, "bot-token");
    assert.equal(env.DISCORD_MCP_TOOLSETS, "all");
    assert.equal(env.DISCORD_ALLOWED_GUILDS, "123456789012345678");
  } finally {
    process.env = saved;
  }
});

test(
  "JSON-RPC calls reach the local server and errors return over stdio",
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
