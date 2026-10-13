import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "../../core/test/helpers.js";
import { loadConfig } from "../src/config.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

test(
  "offline setup, start, status, logs and stop keep credentials out of output",
  { timeout: 30_000 },
  async (t) => {
    const { home, binary } = await fixture(t);
    const botFile = join(home, "input-bot");
    const keyFile = join(home, "input-key");
    await writeFile(botFile, "fake-bot-token");
    await writeFile(keyFile, "fake-tunnel-key");
    const command = async (...args: string[]) =>
      exec(process.execPath, [cli, "--home", home, "reddit", ...args]);
    const setup = await command(
      "setup",
      "--tunnel-id",
      "tunnel_test",
      "--tunnel-client",
      binary,
      "--bot-token-file",
      botFile,
      "--tunnel-key-file",
      keyFile,
      "--outbox-channel",
      "800000000000000001",
      "--inbox-channel",
      "800000000000000002",
      "--bridge-bot",
      "900000000000000002",
      "--skip-validation",
      "--json",
    );
    assert.equal(JSON.parse(setup.stdout).toolCount, 7);
    assert.ok(!setup.stdout.includes("fake-bot-token"));
    assert.equal((await loadConfig(home))?.inboxChannelId, "800000000000000002");
    assert.equal(JSON.parse((await command("start", "--json")).stdout).ready, true);
    const status = JSON.parse((await command("status", "--json")).stdout);
    assert.equal(status.processRunning, true);
    assert.deepEqual(status.events, { subscriptions: 0, pending: 0, queued: 0 });
    await assert.rejects(command("setup", "--skip-validation", "--json"), /Stop Reddit/);
    await writeFile(
      join(home, "tunnel-state", "apps-of-dots-reddit.log"),
      "example fake-bot-token\n",
    );
    const logs = await command("logs");
    assert.match(logs.stdout, /\[redacted\]/);
    assert.ok(!logs.stdout.includes("fake-bot-token"));
    assert.equal(JSON.parse((await command("stop", "--json")).stdout).processRunning, false);
    const calls = await readFile(join(home, "tunnel-state", "calls.jsonl"), "utf8");
    assert.ok(!calls.includes("fake-bot-token"));
  },
);

test("setup refuses IDs that are not Discord snowflakes", { timeout: 20_000 }, async (t) => {
  const { home, binary } = await fixture(t);
  await writeFile(join(home, "bot"), "fake-bot-token");
  await writeFile(join(home, "key"), "fake-tunnel-key");
  await assert.rejects(
    exec(process.execPath, [
      cli,
      "--home",
      home,
      "reddit",
      "setup",
      "--tunnel-id",
      "tunnel_test",
      "--tunnel-client",
      binary,
      "--bot-token-file",
      join(home, "bot"),
      "--tunnel-key-file",
      join(home, "key"),
      "--outbox-channel",
      "general",
      "--inbox-channel",
      "800000000000000002",
      "--bridge-bot",
      "900000000000000002",
      "--skip-validation",
      "--json",
    ]),
    /Outbox channel must be a Discord ID/,
  );
  assert.equal(await loadConfig(home), undefined);
});

test("missing configuration produces actionable status", { timeout: 20_000 }, async (t) => {
  const { home } = await fixture(t);
  const status = await exec(process.execPath, [cli, "--home", home, "reddit", "status", "--json"]);
  assert.equal(JSON.parse(status.stdout).state, "not configured");
});
