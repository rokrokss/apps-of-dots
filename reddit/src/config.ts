import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import {
  privateDirectory,
  privateWrite,
  readOptional,
  validateSecret,
} from "@apps-of-dots/runtime";

export interface RedditConfig {
  version: 1;
  tunnelId: string;
  tunnelClient: string;
  /** Discord channel the agent writes requests to and the bridge answers in. */
  outboxChannelId: string;
  /** Discord channel the bridge's webhook copies Reddit posts and comments to. */
  inboxChannelId: string;
  /** The bridge bot's Discord user ID; only its status replies are trusted. */
  bridgeBotId: string;
  /** The agent bot's user ID, recorded when setup verifies the token. The bridge needs it. */
  agentBotId?: string;
  secretId: string;
}

const SNOWFLAKE = /^\d{17,20}$/;

export function configPath(home: string): string {
  return join(home, "reddit", "config.json");
}
export function secretPaths(home: string, config: RedditConfig) {
  const directory = join(home, "reddit", "secrets", config.secretId);
  return { directory, bot: join(directory, "bot-token"), tunnel: join(directory, "tunnel-key") };
}

export function parseSnowflake(value: string | undefined, label: string): string {
  const id = (value ?? "").trim();
  if (!SNOWFLAKE.test(id)) throw new Error(`${label} must be a Discord ID (17-20 digits).`);
  return id;
}

export function parseConfig(raw: string): RedditConfig {
  let value: RedditConfig;
  try {
    value = JSON.parse(raw) as RedditConfig;
  } catch {
    throw new Error("Invalid Reddit config JSON. Run apps-of-dots reddit setup.");
  }
  if (
    !value ||
    value.version !== 1 ||
    typeof value.tunnelId !== "string" ||
    !/^tunnel_[a-zA-Z0-9_-]+$/.test(value.tunnelId ?? "") ||
    typeof value.tunnelClient !== "string" ||
    !value.tunnelClient.startsWith("/") ||
    [value.outboxChannelId, value.inboxChannelId, value.bridgeBotId].some(
      (id) => typeof id !== "string" || !SNOWFLAKE.test(id),
    ) ||
    (value.agentBotId !== undefined && !SNOWFLAKE.test(String(value.agentBotId))) ||
    typeof value.secretId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(value.secretId ?? "")
  ) {
    throw new Error("Unsupported or invalid Reddit configuration. Run apps-of-dots reddit setup.");
  }
  return value;
}

export async function loadConfig(home: string): Promise<RedditConfig | undefined> {
  const raw = await readOptional(configPath(home));
  return raw === undefined ? undefined : parseConfig(raw);
}

export async function requireConfig(home: string): Promise<RedditConfig> {
  const config = await loadConfig(home);
  if (!config) throw new Error("Reddit is not configured. Run apps-of-dots reddit setup.");
  return config;
}

export async function readSecrets(home: string, config: RedditConfig) {
  const paths = secretPaths(home, config);
  const [bot, tunnel] = await Promise.all([readOptional(paths.bot), readOptional(paths.tunnel)]);
  if (!bot || !tunnel)
    throw new Error("Reddit credentials are missing. Run apps-of-dots reddit setup.");
  return { bot: validateSecret(bot, "Bot token"), tunnel: validateSecret(tunnel, "Tunnel key") };
}

export async function saveConfig(
  home: string,
  settings: Omit<RedditConfig, "version" | "secretId">,
  secrets: { bot: string; tunnel: string },
): Promise<RedditConfig> {
  const previous = await loadConfig(home);
  const config = parseConfig(JSON.stringify({ ...settings, version: 1, secretId: randomUUID() }));
  const paths = secretPaths(home, config);
  await privateDirectory(home);
  await privateDirectory(join(home, "reddit"));
  await privateDirectory(join(home, "reddit", "secrets"));
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
