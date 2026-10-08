import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import {
  installSource,
  prepareSetup,
  registerManaged,
  requireStopped,
  saveConfig,
  type ManagedIntegration,
  type SetupOptions,
} from "@apps-of-dots/managed-mcp";
import { SOURCE, TOOL_COUNT, login, preflight, run, verifyAccount } from "./server.js";

interface TelegramSetup extends SetupOptions {
  apiId?: string;
  apiHashFile?: string;
}
export const telegram: ManagedIntegration = {
  id: "telegram",
  name: "Telegram",
  source: SOURCE,
  toolCount: TOOL_COUNT,
  entry: fileURLToPath(new URL("./stdio.js", import.meta.url)),
  setupOptions(command) {
    command
      .option("--api-id <id>", "Telegram API ID from my.telegram.org")
      .option("--api-hash-file <path>", "Read the Telegram API hash from a private file");
  },
  async setup(home, options: TelegramSetup) {
    const setup = await prepareSetup(home, "telegram", options);
    const apiId = await setup.value(
      options.apiId,
      setup.previous?.settings.apiId,
      "Telegram API ID",
      "--api-id",
    );
    const apiHash = await setup.credential(
      options.apiHashFile,
      setup.saved.apiHash,
      "Telegram API hash",
      "--api-hash-file",
    );
    if (!/^[1-9][0-9]*$/.test(apiId) || !/^[a-fA-F0-9]{32}$/.test(apiHash))
      throw new Error("Telegram needs a positive API ID and a 32-character hexadecimal API hash.");
    if (!options.skipInstall) await installSource(home, SOURCE);
    const c = await saveConfig(
      home,
      "telegram",
      { tunnelId: setup.tunnelId, tunnelClient: setup.tunnelClient, settings: { apiId } },
      { tunnel: setup.tunnel, apiHash },
    );
    return {
      configured: true,
      installed: !options.skipInstall,
      tunnelId: c.tunnelId,
      toolCount: TOOL_COUNT,
      next: options.skipInstall
        ? "apps-of-dots telegram install, then apps-of-dots telegram login"
        : "apps-of-dots telegram login",
    };
  },
  login,
  preflight,
  run,
  liveCheckHelp: "Check account authentication and tunnel configuration (stop first)",
  liveCheckInstructions:
    "Telegram live checks require exclusive access to the session.\nRun apps-of-dots telegram stop, then apps-of-dots telegram doctor --live.\nRun apps-of-dots telegram start afterward to reconnect the tunnel.",
  async liveCheck(home) {
    await requireStopped(home, telegram);
    return verifyAccount(home);
  },
};
export function registerTelegram(program: Command, home: () => string): void {
  registerManaged(program, home, telegram);
}
