import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers.js";
import { saveConfig as saveDiscord } from "../../discord/src/config.js";
import { saveConfig } from "../packages/managed-mcp/src/config.js";
import { fakeInstallation } from "../packages/managed-mcp/test/helpers.js";
import { SOURCE as telegram } from "../../telegram/src/server.js";
import { SOURCE as whatsapp } from "../../whatsapp/src/server.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

for (const app of ["discord", "telegram", "whatsapp"] as const) {
  test(
    `${app} pending starts explain recovery while JSON stays machine-readable`,
    { timeout: 20_000 },
    async (t) => {
      const { home, binary } = await fixture(t);
      const settings = { tunnelId: "tunnel_test", tunnelClient: binary };
      if (app === "discord") {
        await saveDiscord(
          home,
          { ...settings, allowedGuilds: [] },
          { bot: "fixture-bot", tunnel: "fixture-key" },
        );
      } else {
        await saveConfig(
          home,
          app,
          {
            ...settings,
            settings: app === "telegram" ? { apiId: "1234" } : { bridgePort: "8766" },
          },
          {
            tunnel: "fixture-key",
            ...(app === "telegram" ? { apiHash: "a".repeat(32) } : { bridgeToken: "b".repeat(64) }),
          },
        );
        await fakeInstallation(home, app === "telegram" ? telegram : whatsapp);
        const state = join(home, app, app === "telegram" ? "session" : "data/store");
        await mkdir(state, { recursive: true });
        await writeFile(
          join(state, app === "telegram" ? "account.session" : "whatsapp.db"),
          "fixture",
        );
        if (app === "whatsapp") await writeFile(join(home, app, "data", "paired.json"), "{}");
      }
      const command = (...args: string[]) =>
        exec(process.execPath, [cli, "--home", home, app, ...args], {
          env: { ...process.env, FIXTURE_READY: "false" },
        });
      for (const action of ["start", "restart"]) {
        const human = await command(action);
        assert.match(human.stdout, new RegExp(`Still starting\\. Run apps-of-dots ${app} status`));
        const machine = await command(action, "--json");
        const result = JSON.parse(machine.stdout);
        assert.equal(result.ready, false);
        assert.equal(result.processRunning, true);
        assert.equal(result.healthy, true);
        assert.equal(machine.stderr, "");
      }
      await command("stop", "--json");
    },
  );
}
