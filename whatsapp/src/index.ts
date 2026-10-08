import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import {
  installSource,
  prepareSetup,
  registerManaged,
  saveConfig,
  type ManagedIntegration,
  type SetupOptions,
} from "@apps-of-dots/managed-mcp";
import { SOURCE, TOOL_COUNT, login, webLogin, preflight, run, verifyAccount } from "./server.js";

interface WhatsAppSetup extends SetupOptions {
  bridgePort?: string;
}
export const whatsapp: ManagedIntegration = {
  id: "whatsapp",
  name: "WhatsApp",
  source: SOURCE,
  toolCount: TOOL_COUNT,
  entry: fileURLToPath(new URL("./stdio.js", import.meta.url)),
  setupOptions(command) {
    command.option("--bridge-port <port>", "Private loopback bridge port (default: 8766)");
  },
  async setup(home, options: WhatsAppSetup) {
    const setup = await prepareSetup(home, "whatsapp", options);
    const bridgePort = options.bridgePort ?? setup.previous?.settings.bridgePort ?? "8766";
    if (!/^\d+$/.test(bridgePort) || Number(bridgePort) < 1024 || Number(bridgePort) > 65535)
      throw new Error("Bridge port must be between 1024 and 65535.");
    options.progress?.("install");
    if (!options.skipInstall) await installSource(home, SOURCE);
    options.progress?.("save");
    const c = await saveConfig(
      home,
      "whatsapp",
      { tunnelId: setup.tunnelId, tunnelClient: setup.tunnelClient, settings: { bridgePort } },
      {
        tunnel: setup.tunnel,
        bridgeToken: setup.saved.bridgeToken ?? randomBytes(32).toString("hex"),
      },
    );
    return {
      configured: true,
      installed: !options.skipInstall,
      tunnelId: c.tunnelId,
      bridgePort: Number(bridgePort),
      toolCount: TOOL_COUNT,
      next: options.skipInstall
        ? "apps-of-dots whatsapp install, then apps-of-dots whatsapp login"
        : "apps-of-dots whatsapp login",
    };
  },
  login,
  webLogin,
  preflight,
  run,
  liveCheckHelp: "Check account connection and tunnel configuration (start first)",
  liveCheckInstructions:
    "WhatsApp live checks use the running bridge.\nRun apps-of-dots whatsapp start, then apps-of-dots whatsapp doctor --live.",
  liveCheck: verifyAccount,
};
export function registerWhatsApp(program: Command, home: () => string): void {
  registerManaged(program, home, whatsapp);
}
