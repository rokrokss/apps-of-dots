import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import {
  privateDirectory,
  privateWrite,
  readOptional,
  validateSecret,
} from "@apps-of-dots/runtime";

export interface DiscordConfig {
  version: 1;
  tunnelId: string;
  tunnelClient: string;
  allowedGuilds: string[];
  secretId: string;
}

export function configPath(home: string): string {
  return join(home, "discord", "config.json");
}
export function secretPaths(home: string, config: DiscordConfig) {
  const directory = join(home, "discord", "secrets", config.secretId);
  return { directory, bot: join(directory, "bot-token"), tunnel: join(directory, "tunnel-key") };
}

export function parseGuilds(input: string): string[] {
  if (input.trim().toLowerCase() === "all") return [];
  const values = [...new Set(input.split(",").map((value) => value.trim()))];
  if (!values.length || values.some((value) => !/^\d{17,20}$/.test(value))) {
    throw new Error("Guilds must be comma-separated Discord server IDs, or 'all'.");
  }
  return values;
}

export function parseConfig(raw: string): DiscordConfig {
  let value: DiscordConfig;
  try {
    value = JSON.parse(raw) as DiscordConfig;
  } catch {
    throw new Error("Invalid Discord config JSON. Run apps-of-dots discord setup.");
  }
  if (
    !value ||
    value.version !== 1 ||
    typeof value.tunnelId !== "string" ||
    !/^tunnel_[a-zA-Z0-9_-]+$/.test(value.tunnelId ?? "") ||
    typeof value.tunnelClient !== "string" ||
    !value.tunnelClient.startsWith("/") ||
    !Array.isArray(value.allowedGuilds) ||
    value.allowedGuilds.some((id) => typeof id !== "string" || !/^\d{17,20}$/.test(id)) ||
    typeof value.secretId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(value.secretId ?? "")
  ) {
    throw new Error(
      "Unsupported or invalid Discord configuration. Run apps-of-dots discord setup.",
    );
  }
  return value;
}

export async function loadConfig(home: string): Promise<DiscordConfig | undefined> {
  const raw = await readOptional(configPath(home));
  return raw === undefined ? undefined : parseConfig(raw);
}

export async function requireConfig(home: string): Promise<DiscordConfig> {
  const config = await loadConfig(home);
  if (!config) throw new Error("Discord is not configured. Run apps-of-dots discord setup.");
  return config;
}

export async function readSecrets(home: string, config: DiscordConfig) {
  const paths = secretPaths(home, config);
  const [bot, tunnel] = await Promise.all([readOptional(paths.bot), readOptional(paths.tunnel)]);
  if (!bot || !tunnel)
    throw new Error("Discord credentials are missing. Run apps-of-dots discord setup.");
  return { bot: validateSecret(bot, "Bot token"), tunnel: validateSecret(tunnel, "Tunnel key") };
}

export async function saveConfig(
  home: string,
  settings: Omit<DiscordConfig, "version" | "secretId">,
  secrets: { bot: string; tunnel: string },
): Promise<DiscordConfig> {
  const previous = await loadConfig(home);
  const config = parseConfig(JSON.stringify({ ...settings, version: 1, secretId: randomUUID() }));
  const paths = secretPaths(home, config);
  await privateDirectory(home);
  await privateDirectory(join(home, "discord"));
  await privateDirectory(join(home, "discord", "secrets"));
  await privateDirectory(paths.directory);
  try {
    await privateWrite(paths.bot, validateSecret(secrets.bot, "Bot token") + "\n");
    await privateWrite(paths.tunnel, validateSecret(secrets.tunnel, "Tunnel key") + "\n");
    // The config is the commit point: a crash cannot expose half-written credentials.
    await privateWrite(configPath(home), JSON.stringify(config, null, 2) + "\n");
  } catch (error) {
    await rm(paths.directory, { recursive: true, force: true });
    throw error;
  }
  if (previous) await rm(secretPaths(home, previous).directory, { recursive: true, force: true });
  return config;
}
