import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { saveConfig } from "@apps-of-dots/managed-mcp";
import { inspectTools } from "../../discord/src/server.js";
import { fixture } from "../../core/test/helpers.js";
import { fakeInstallation } from "../../core/packages/managed-mcp/test/helpers.js";
import { SOURCE, sessionPath, telegramEnvironment, preflight } from "../src/server.js";

test(
  "Telegram uses its own private session and preserves the MCP boundary",
  { timeout: 20_000 },
  async (t) => {
    const { home, binary } = await fixture(t);
    await saveConfig(
      home,
      "telegram",
      { tunnelId: "tunnel_tg", tunnelClient: binary, settings: { apiId: "123" } },
      { tunnel: "private-tunnel-key", apiHash: "a".repeat(32) },
    );
    await assert.rejects(preflight(home), /telegram login/);
    await mkdir(dirname(sessionPath(home)), { recursive: true });
    await writeFile(sessionPath(home) + ".session", "fixture-session");
    await fakeInstallation(home, SOURCE);
    const env = await telegramEnvironment(home);
    assert.equal(env.TELEGRAM_EXPOSED_TOOLS, "all");
    assert.equal(env.MCP_TRANSPORT, "stdio");
    assert.equal(env.TELEGRAM_SESSION_NAME, sessionPath(home));
    assert.equal(env.TELEGRAM_ALLOWED_ROOTS, join(home, "telegram", "files"));
    const tools = await inspectTools(
      process.execPath,
      [fileURLToPath(new URL("../dist/stdio.js", import.meta.url)), home],
      {
        ...(process.env as Record<string, string>),
        MCP_TRANSPORT: "http",
        TELEGRAM_EXPOSED_TOOLS: "read-only",
      },
    );
    assert.equal(tools[0]?.name, "fixture_echo");
  },
);
