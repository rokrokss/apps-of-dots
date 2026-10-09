import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { saveConfig } from "@apps-of-dots/managed-mcp";
import { fixture } from "../../core/test/helpers.js";
import { fakeInstallation, unusedPort } from "../../core/packages/managed-mcp/test/helpers.js";
import { SOURCE, stateDirectory, whatsappEnvironment } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = fileURLToPath(new URL("../dist/stdio.js", import.meta.url));
async function provision(t: Parameters<typeof fixture>[0], main = {}) {
  const { home, binary } = await fixture(t);
  await saveConfig(
    home,
    "whatsapp",
    {
      tunnelId: "tunnel_wa",
      tunnelClient: binary,
      settings: { bridgePort: String(await unusedPort()) },
    },
    { tunnel: "fake-tunnel-key", bridgeToken: "b".repeat(64) },
  );
  await fakeInstallation(home, SOURCE, main);
  const state = stateDirectory(home);
  await mkdir(join(state, "store"), { recursive: true });
  await writeFile(join(state, "store", "whatsapp.db"), "fixture-session");
  await writeFile(join(state, "paired.json"), "{}");
  return { home, state };
}
function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitUntil(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail("Child did not reach expected state within 5 seconds.");
}

test(
  "WhatsApp waits for its authenticated bridge, passes JSON-RPC, and closes both children on EOF",
  { timeout: 20_000 },
  async (t) => {
    const { home, state } = await provision(t);
    const env = await whatsappEnvironment(home);
    assert.equal(env.WEBHOOK_ENABLED, "false");
    assert.equal(env.WHATSAPP_MEDIA_ROOTS, join(home, "whatsapp", "files"));
    const client = new Client({ name: "test", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, home],
      env: {
        ...(process.env as Record<string, string>),
        CONTROL_PLANE_API_KEY: "must-not-leak",
        DISCORD_TOKEN: "must-not-leak",
        WHATSAPP_MCP_TRANSPORT: "http",
        WEBHOOK_ENABLED: "true",
      },
      stderr: "pipe",
    });
    let diagnostics = "";
    transport.stderr?.on("data", (chunk) => {
      diagnostics += String(chunk);
    });
    let bridgePid = 0;
    let mcpPid = 0;
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools[0]?.name, "fixture_echo");
      const result = await client.callTool({
        name: "fixture_echo",
        arguments: { value: "round-trip" },
      });
      const text = (result.content as { text: string }[])[0]!.text;
      assert.deepEqual(JSON.parse(text), {
        value: "round-trip",
        transport: "stdio",
        webhook: "false",
      });
      bridgePid = Number(await readFile(join(state, "bridge-pid"), "utf8"));
      mcpPid = Number(await readFile(join(state, "mcp-pid"), "utf8"));
      assert.ok(diagnostics.includes("Bridge diagnostic on stdout"));
    } finally {
      await client.close();
      await transport.close();
    }
    await waitUntil(async () => !isAlive(bridgePid) && !isAlive(mcpPid));
  },
);

for (const mode of ["mcp-exit", "bridge-exit", "SIGTERM"] as const) {
  test(`WhatsApp stops all children after ${mode}`, { timeout: 20_000 }, async (t) => {
    const { home, state } = await provision(
      t,
      mode === "mcp-exit" ? { exitImmediately: true } : {},
    );
    const child = spawn(process.execPath, [entry, home], { stdio: ["pipe", "pipe", "pipe"] });
    t.after(() => {
      child.kill("SIGKILL");
    });
    const exit = new Promise<number | null>((resolve) => child.once("exit", resolve));
    await waitUntil(async () =>
      Boolean(await readFile(join(state, "bridge-pid"), "utf8").catch(() => "")),
    );
    const bridgePid = Number(await readFile(join(state, "bridge-pid"), "utf8"));
    if (mode !== "mcp-exit") {
      await waitUntil(async () =>
        Boolean(await readFile(join(state, "mcp-pid"), "utf8").catch(() => "")),
      );
      if (mode === "SIGTERM") child.kill("SIGTERM");
      else process.kill(bridgePid, "SIGTERM");
    }
    const code = await exit;
    assert.notEqual(code, 0);
    await waitUntil(async () => !isAlive(bridgePid));
    const mcpPid = Number(await readFile(join(state, "mcp-pid"), "utf8").catch(() => "0"));
    if (mcpPid) await waitUntil(async () => !isAlive(mcpPid));
  });
}
