import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("CLI name, catalog and help describe the implemented scope", async () => {
  const { stdout } = await exec(process.execPath, [cli, "--help"]);
  assert.match(stdout, /Usage: apps-of-dots/);
  assert.ok(!stdout.includes("dot-apps"));
  const result = await exec(process.execPath, [cli, "list", "--json"]);
  const catalog = JSON.parse(result.stdout);
  assert.deepEqual(
    catalog.map((app: { kind: string }) => app.kind),
    ["built-in", "external", "external"],
  );
  assert.equal(catalog[0].events, false);
});

test(
  "offline setup, start, status, logs, stop and credential replacement",
  { timeout: 30_000 },
  async (t) => {
    const { home, binary } = await fixture(t);
    const botFile = join(home, "input-bot");
    const keyFile = join(home, "input-key");
    await writeFile(botFile, "fake-bot-token");
    await writeFile(keyFile, "fake-tunnel-key");
    const command = async (...args: string[]) =>
      exec(process.execPath, [cli, "--home", home, "discord", ...args], {
        env: {
          ...process.env,
          DISCORD_TOKEN: "unrelated-token",
          MCP_COMMAND: "unrelated-command",
          CONTROL_PLANE_API_KEY: "unrelated-key",
        },
      });
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
      "--skip-validation",
      "--json",
    );
    assert.equal(JSON.parse(setup.stdout).toolCount, 99);
    assert.ok(!setup.stdout.includes("fake-bot-token"));
    assert.equal(JSON.parse((await command("start", "--json")).stdout).ready, true);
    assert.equal(JSON.parse((await command("status", "--json")).stdout).processRunning, true);
    await assert.rejects(command("setup", "--skip-validation", "--json"), /Stop Discord/);
    const logfile = join(home, "tunnel-state", "runtime.log");
    await writeFile(logfile, "example fake-bot-token and fake-tunnel-key\n");
    const logs = await command("logs");
    assert.match(logs.stdout, /\[redacted\]/);
    assert.ok(!logs.stdout.includes("fake-bot-token"));
    assert.equal(JSON.parse((await command("stop", "--json")).stdout).processRunning, false);
    await command("setup", "--skip-validation", "--json");
    const calls = (await readFile(join(home, "tunnel-state", "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const call of calls) {
      assert.equal(call.inheritedToken, undefined);
      assert.equal(call.inheritedKey, undefined);
      assert.equal(call.inheritedCommand, undefined);
      assert.ok(!JSON.stringify(call).includes("fake-bot-token"));
    }
  },
);

test(
  "missing configuration produces actionable status and a failing doctor",
  { timeout: 20_000 },
  async (t) => {
    const { home } = await fixture(t);
    const status = await exec(process.execPath, [
      cli,
      "--home",
      home,
      "discord",
      "status",
      "--json",
    ]);
    assert.equal(JSON.parse(status.stdout).state, "not configured");
    await assert.rejects(
      exec(process.execPath, [cli, "--home", home, "discord", "doctor", "--json"]),
      (error: Error & { stdout: string }) => {
        const result = JSON.parse(error.stdout);
        return result.ok === false && result.checks[0].ok === true;
      },
    );
  },
);
