import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { quoteCommand, runCommand, TunnelRuntime } from "../src/tunnel.js";
import { fixture } from "../../../test/helpers.js";

test("managed lifecycle uses key references and isolated state, then verifies readiness", async (t) => {
  const { home, binary } = await fixture(t);
  const runner = new TunnelRuntime({
    binary,
    home,
    app: "discord",
    tunnelId: "tunnel_test",
    keyFile: join(home, "key"),
    command: [process.execPath, join(home, "a ' path.js")],
  });
  assert.equal((await runner.status()).state, "stopped");
  assert.equal((await runner.start()).ready, true);
  assert.equal((await runner.start()).processRunning, true);
  assert.equal((await runner.stop()).processRunning, false);
  assert.equal((await runner.stop()).state, "stopped");
  const calls = (await readFile(join(home, "tunnel-state", "calls.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const connect = calls.find((call) => call.args[1] === "connect");
  assert.equal(
    connect.args[connect.args.indexOf("--runtime-api-key") + 1],
    `file:${join(home, "key")}`,
  );
  assert.equal(
    connect.args[connect.args.indexOf("--mcp-command") + 1],
    quoteCommand(runner.options.command),
  );
});

test("a live process is not advertised as ready; diagnostics redact secrets", async (t) => {
  const { home, binary } = await fixture(t);
  const runner = new TunnelRuntime({
    binary,
    home,
    app: "discord",
    tunnelId: "tunnel_test",
    keyFile: "key",
    command: ["node", "test"],
    secrets: ["fake-secret"],
  });
  runner.env.FIXTURE_READY = "false";
  const status = await runner.start();
  assert.equal(status.processRunning, true);
  assert.equal(status.ready, false);
  runner.env.FIXTURE_CONNECT_ERROR = "connection failed: fake-secret";
  await assert.rejects(
    runner.start(),
    (error: Error) =>
      error.message.includes("[redacted]") && !error.message.includes("fake-secret"),
  );
});

test("quoted command arguments preserve spaces, quotes and shell metacharacters", async () => {
  const values = ["a b", "don't", "$(printf unsafe)", "a;b", "a,b"];
  const command = quoteCommand([
    process.execPath,
    "-e",
    "console.log(JSON.stringify(process.argv.slice(1)))",
    ...values,
  ]);
  assert.deepEqual(JSON.parse(await runCommand("/bin/sh", ["-c", command], process.env)), values);
  assert.throws(() => quoteCommand(["a\nb"]), /control characters/);
});
