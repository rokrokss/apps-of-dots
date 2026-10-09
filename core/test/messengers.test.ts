import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers.js";
import { fakeInstallation } from "../packages/managed-mcp/test/helpers.js";
import { SOURCE as telegram } from "../../telegram/src/server.js";
import { SOURCE as whatsapp } from "../../whatsapp/src/server.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
for (const source of [telegram, whatsapp]) {
  test(
    `${source.app} offline provisioning, lifecycle, redaction and login requirements`,
    { timeout: 20_000 },
    async (t) => {
      const { home, binary } = await fixture(t);
      const command = (...args: string[]) =>
        exec(process.execPath, [cli, "--home", home, source.app, ...args]);
      assert.equal(JSON.parse((await command("status", "--json")).stdout).state, "not configured");
      await writeFile(join(home, "key"), "test-tunnel-key");
      await writeFile(join(home, "hash"), "a".repeat(32));
      const flags =
        source.app === "telegram"
          ? ["--api-id", "1234", "--api-hash-file", join(home, "hash")]
          : [];
      const result = await command(
        "setup",
        "--tunnel-id",
        `tunnel_${source.app}`,
        "--tunnel-client",
        binary,
        "--tunnel-key-file",
        join(home, "key"),
        ...flags,
        "--skip-install",
        "--json",
      );
      assert.equal(JSON.parse(result.stdout).toolCount, source.app === "telegram" ? 139 : 17);
      assert.ok(!result.stdout.includes("test-tunnel-key"));
      await assert.rejects(command("start", "--json"), /runtime is not installed/);
      await fakeInstallation(home, source);
      await assert.rejects(command("start", "--json"), /login/);
      if (source.app === "telegram") {
        await mkdir(join(home, "telegram", "session"), { recursive: true });
        await writeFile(join(home, "telegram", "session", "account.session"), "fixture");
      } else {
        await mkdir(join(home, "whatsapp", "data", "store"), { recursive: true });
        await writeFile(join(home, "whatsapp", "data", "store", "whatsapp.db"), "fixture");
        await writeFile(join(home, "whatsapp", "data", "paired.json"), "{}");
      }
      assert.equal(JSON.parse((await command("start", "--json")).stdout).ready, true);
      await assert.rejects(command("setup", "--skip-install", "--json"), /Stop .* first/);
      await assert.rejects(command("install", "--json"), /Stop .* first/);
      const log = join(home, "tunnel-state", `apps-of-dots-${source.app}.log`);
      await writeFile(log, "test-tunnel-key is not printed\n");
      const output = (await command("logs")).stdout;
      assert.match(output, /\[redacted\]/);
      assert.ok(!output.includes("test-tunnel-key"));
      assert.equal(JSON.parse((await command("restart", "--json")).stdout).ready, true);
      assert.equal(JSON.parse((await command("stop", "--json")).stdout).processRunning, false);
      await command("setup", "--skip-install", "--json");
      await assert.rejects(command("login"), /interactive terminal/);
      const calls = (await readFile(join(home, "tunnel-state", "calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const connect = calls.find((call) => call.args[1] === "connect");
      assert.equal(connect.args[connect.args.indexOf("--alias") + 1], `apps-of-dots-${source.app}`);
      assert.ok(connect.args[connect.args.indexOf("--runtime-api-key") + 1].startsWith("file:"));
      assert.ok(!JSON.stringify(calls).includes("test-tunnel-key"));
    },
  );
}
