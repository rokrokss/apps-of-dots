import {
  executable,
  runCommand,
  tunnelEnvironment,
  validateSecret,
  type RuntimeStatus,
} from "@apps-of-dots/runtime";
import { withAppLock } from "@apps-of-dots/managed-mcp";
import { loadConfig, parseGuilds, readSecrets, requireConfig, saveConfig } from "./config.js";
import { runtime } from "./runtime.js";

export interface DiscordSetupInput {
  tunnelId?: string;
  tunnelKey?: string;
  botToken?: string;
  tunnelClient?: string;
  guilds?: string;
  skipValidation?: boolean;
}
export type SetupStage = "runtime" | "credentials" | "bot" | "save";

export async function verifyBot(token: string): Promise<{ id: string; username: string }> {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(
      `Discord rejected the bot check (HTTP ${response.status}). Check the bot token and try again.`,
    );
  const bot = (await response.json()) as { id: string; username: string; bot?: boolean };
  if (!bot.bot) throw new Error("This integration requires a Discord bot token.");
  return { id: bot.id, username: bot.username };
}

// Both the CLI and local web UI use the same validation, storage and process lock.
export async function configureDiscord(
  home: string,
  input: DiscordSetupInput,
  options: { progress?: (stage: SetupStage) => void; verify?: typeof verifyBot } = {},
) {
  return withAppLock(home, "discord", async () => {
    options.progress?.("runtime");
    const previous = await loadConfig(home);
    const binary = await executable(
      input.tunnelClient || previous?.tunnelClient || "tunnel-client",
    );
    if (
      previous &&
      (await (await runtime(home, { ...previous, tunnelClient: binary })).status()).processRunning
    )
      throw new Error("Stop Discord before changing its configuration: apps-of-dots discord stop");
    const help = await runCommand(
      binary,
      ["runtimes", "connect", "--help"],
      tunnelEnvironment(home),
      10_000,
    );
    if (!help.includes("--runtime-api-key") || !help.includes("--tunnel-id"))
      throw new Error("Upgrade the official tunnel-client: managed runtimes are required.");
    options.progress?.("credentials");
    const saved = previous ? await readSecrets(home, previous).catch(() => undefined) : undefined;
    const tunnelId = input.tunnelId || previous?.tunnelId;
    if (!tunnelId || !/^tunnel_[a-zA-Z0-9_-]+$/.test(tunnelId))
      throw new Error("Provide a valid OpenAI tunnel ID beginning with tunnel_.");
    const tunnel = validateSecret(
      input.tunnelKey || saved?.tunnel || "",
      "OpenAI tunnel runtime key",
    );
    const bot = validateSecret(input.botToken || saved?.bot || "", "Discord bot token");
    const allowedGuilds =
      input.guilds !== undefined ? parseGuilds(input.guilds) : (previous?.allowedGuilds ?? []);
    options.progress?.("bot");
    const identity = input.skipValidation ? undefined : await (options.verify ?? verifyBot)(bot);
    options.progress?.("save");
    const config = await saveConfig(
      home,
      { tunnelId, tunnelClient: binary, allowedGuilds },
      { bot, tunnel },
    );
    return {
      configured: true,
      toolCount: 99,
      bot: identity ?? "not checked",
      tunnelId: config.tunnelId,
      guilds: allowedGuilds.length ? allowedGuilds : "all guilds accessible to the bot",
      next: "apps-of-dots discord start",
    };
  });
}

export async function controlDiscord(
  home: string,
  action: "start" | "stop" | "restart",
): Promise<RuntimeStatus> {
  return withAppLock(home, "discord", async () => {
    const config = await requireConfig(home);
    if (action !== "stop") await readSecrets(home, config);
    const runner = await runtime(home, config);
    if (action === "restart") await runner.stop();
    return action === "stop" ? runner.stop() : runner.start();
  });
}
