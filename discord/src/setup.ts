import { readFile } from "node:fs/promises";
import * as prompts from "@clack/prompts";
import {
  executable,
  runCommand,
  tunnelEnvironment,
  validateSecret,
  setupSummary,
} from "@apps-of-dots/runtime";
import { loadConfig, parseGuilds, readSecrets, saveConfig } from "./config.js";
import { runtime } from "./runtime.js";

export interface SetupOptions {
  tunnelId?: string;
  botTokenFile?: string;
  tunnelKeyFile?: string;
  tunnelClient?: string;
  guilds?: string;
  skipValidation?: boolean;
  json?: boolean;
}

function answer<T>(value: T | symbol): T {
  if (prompts.isCancel(value)) throw new Error("Setup cancelled. No configuration was changed.");
  return value as T;
}

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

export async function setup(home: string, options: SetupOptions) {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.json);
  if (interactive) prompts.intro("apps-of-dots · Discord");
  const previous = await loadConfig(home);
  const binary = await executable(
    options.tunnelClient || previous?.tunnelClient || "tunnel-client",
  );
  if (previous) {
    const existing = await runtime(home, { ...previous, tunnelClient: binary });
    if ((await existing.status()).processRunning) {
      throw new Error("Stop Discord before changing its configuration: apps-of-dots discord stop");
    }
  }
  const saved = previous ? await readSecrets(home, previous).catch(() => undefined) : undefined;
  const help = await runCommand(
    binary,
    ["runtimes", "connect", "--help"],
    tunnelEnvironment(home),
    10_000,
  );
  if (!help.includes("--runtime-api-key") || !help.includes("--tunnel-id")) {
    throw new Error(
      "This tunnel-client does not support managed runtimes. Upgrade from the official OpenAI distribution.",
    );
  }
  let tunnelId = options.tunnelId || previous?.tunnelId;
  if (!tunnelId && interactive)
    tunnelId = answer<string>(
      await prompts.text({ message: "OpenAI tunnel ID", placeholder: "tunnel_…" }),
    );
  if (!tunnelId || !/^tunnel_[a-zA-Z0-9_-]+$/.test(tunnelId)) {
    throw new Error(
      "Provide --tunnel-id tunnel_… from https://platform.openai.com/settings/organization/tunnels",
    );
  }
  async function credential(
    file: string | undefined,
    existing: string | undefined,
    label: string,
    flag: string,
  ) {
    if (file) return validateSecret(await readFile(file, "utf8"), label);
    if (existing) return existing;
    if (!interactive)
      throw new Error(`Provide ${flag} FILE, or run setup in an interactive terminal.`);
    return validateSecret(answer<string>(await prompts.password({ message: label })), label);
  }
  const tunnel = await credential(
    options.tunnelKeyFile,
    saved?.tunnel,
    "OpenAI tunnel runtime key",
    "--tunnel-key-file",
  );
  const bot = await credential(
    options.botTokenFile,
    saved?.bot,
    "Discord bot token",
    "--bot-token-file",
  );
  const allowedGuilds =
    options.guilds !== undefined ? parseGuilds(options.guilds) : (previous?.allowedGuilds ?? []);
  const identity = options.skipValidation ? undefined : await verifyBot(bot);
  const config = await saveConfig(
    home,
    { tunnelId, tunnelClient: binary, allowedGuilds },
    { bot, tunnel },
  );
  const result = {
    configured: true,
    toolCount: 99,
    bot: identity ?? "not checked",
    tunnelId: config.tunnelId,
    guilds: allowedGuilds.length ? allowedGuilds : "all guilds accessible to the bot",
    next: "apps-of-dots discord start",
  };
  if (interactive) prompts.outro(setupSummary(result));
  return result;
}
