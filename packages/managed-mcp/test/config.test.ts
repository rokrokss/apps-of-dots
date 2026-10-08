import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../../../test/helpers.js";
import {
  saveConfig,
  loadConfig,
  readSecrets,
  secretDirectory,
  childEnvironment,
} from "../src/config.js";
import { withAppLock } from "../src/process.js";

test("credentials commit privately and invalid replacements preserve the old generation", async (t) => {
  const { home, binary } = await fixture(t);
  const settings = { tunnelId: "tunnel_test", tunnelClient: binary, settings: { apiId: "123" } };
  const c = await saveConfig(home, "telegram", settings, { tunnel: "key", apiHash: "hash" });
  const path = join(home, "telegram", "config.json");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(
    (await stat(join(secretDirectory(home, "telegram", c), "credentials.json"))).mode & 0o777,
    0o600,
  );
  assert.ok(!(await readFile(path, "utf8")).includes("hash"));
  await assert.rejects(saveConfig(home, "telegram", settings, { tunnel: "bad\nkey" }));
  assert.deepEqual(await loadConfig(home, "telegram"), c);
  assert.equal((await readSecrets(home, "telegram", c)).apiHash, "hash");
  await writeFile(path, JSON.stringify({ ...c, secretId: "../../outside" }));
  await assert.rejects(loadConfig(home, "telegram"), /Invalid telegram/);
});

test("one owner excludes setup, login and duplicate MCPs and recovers a dead PID", async (t) => {
  const { home } = await fixture(t);
  await withAppLock(home, "whatsapp", async () => {
    await assert.rejects(
      withAppLock(home, "whatsapp", async () => {}),
      /is in use/,
    );
  });
  await writeFile(join(home, "whatsapp", ".owner.lock"), "2147483647");
  assert.equal(await withAppLock(home, "whatsapp", async () => "recovered"), "recovered");
});

test("account shells cannot change tool exposure, transport, webhooks or leak keys", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      TELEGRAM_SESSION_STRING: "other-session",
      WHATSAPP_BRIDGE_TOKEN: "other-key",
      WEBHOOK_URL: "https://example.com",
      CONTROL_PLANE_API_KEY: "other-key",
      MCP_TRANSPORT: "http",
      PYTHONPATH: "/untrusted",
      DOTENV_CONFIG_PATH: "/untrusted",
      OPENAI_API_KEY: "other-key",
    });
    const env = childEnvironment();
    assert.equal(env.PATH, process.env.PATH);
    for (const key of [
      "TELEGRAM_SESSION_STRING",
      "WHATSAPP_BRIDGE_TOKEN",
      "WEBHOOK_URL",
      "CONTROL_PLANE_API_KEY",
      "MCP_TRANSPORT",
      "PYTHONPATH",
      "OPENAI_API_KEY",
    ])
      assert.equal(env[key], undefined);
    assert.equal(env.PYTHON_DOTENV_DISABLED, "1");
  } finally {
    process.env = saved;
  }
});
