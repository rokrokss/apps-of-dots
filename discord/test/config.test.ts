import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat } from "node:fs/promises";
import {
  configPath,
  loadConfig,
  parseConfig,
  parseGuilds,
  readSecrets,
  saveConfig,
  secretPaths,
} from "../src/config.js";
import { fixture } from "../../core/test/helpers.js";

test("configuration commits credentials atomically with private permissions", async (t) => {
  const { home, binary } = await fixture(t);
  const settings = { tunnelId: "tunnel_test", tunnelClient: binary, allowedGuilds: [] };
  const config = await saveConfig(home, settings, { bot: "bot-secret", tunnel: "tunnel-secret" });
  assert.deepEqual(await readSecrets(home, config), { bot: "bot-secret", tunnel: "tunnel-secret" });
  assert.equal((await stat(configPath(home))).mode & 0o777, 0o600);
  assert.equal((await stat(secretPaths(home, config).bot)).mode & 0o777, 0o600);
  assert.ok(!(await readFile(configPath(home), "utf8")).includes("bot-secret"));
  await assert.rejects(saveConfig(home, settings, { bot: "new-token", tunnel: "invalid\nkey" }));
  assert.deepEqual(await loadConfig(home), config);
  assert.equal((await readSecrets(home, config)).bot, "bot-secret");
});

test("invalid scope and path traversal cannot be persisted", () => {
  assert.deepEqual(parseGuilds("all"), []);
  assert.deepEqual(parseGuilds("123456789012345678,123456789012345678"), ["123456789012345678"]);
  assert.throws(() => parseGuilds(""));
  assert.throws(() =>
    parseConfig(
      JSON.stringify({
        version: 1,
        tunnelId: "tunnel_test",
        tunnelClient: "/bin/node",
        allowedGuilds: [],
        secretId: "../../sensitive-file",
      }),
    ),
  );
});
