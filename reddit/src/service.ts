import {
  executable,
  runCommand,
  tunnelEnvironment,
  validateSecret,
  type RuntimeStatus,
} from "@apps-of-dots/runtime";
import { withAppLock } from "@apps-of-dots/managed-mcp";
import {
  loadConfig,
  parseSnowflake,
  readSecrets,
  requireConfig,
  saveConfig,
  type RedditConfig,
} from "./config.js";
import { eventStatus, stateFile } from "./events.js";
import { runtime } from "./runtime.js";
import { TOOL_COUNT } from "./server.js";

/** MCP Events subscriptions, pending events and the last delivery, for status pages. */
export function redditEventStatus(home: string) {
  return eventStatus(stateFile(home));
}

export type SetupStage = "runtime" | "credentials" | "bot" | "save";

export interface RedditSetupInput {
  tunnelId?: string;
  tunnelKey?: string;
  botToken?: string;
  tunnelClient?: string;
  outboxChannel?: string;
  inboxChannel?: string;
  bridgeBot?: string;
  skipValidation?: boolean;
}

async function discord(token: string, path: string) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  return response;
}

// The agent bot must authenticate and read both channels; checked at setup, not first use.
export async function verifyAccess(
  token: string,
  channels: Pick<RedditConfig, "outboxChannelId" | "inboxChannelId">,
): Promise<{ id: string; username: string }> {
  const me = await discord(token, "/users/@me");
  if (!me.ok)
    throw new Error(
      `Discord rejected the bot check (HTTP ${me.status}). Check the bot token and try again.`,
    );
  const bot = (await me.json()) as { id: string; username: string; bot?: boolean };
  if (!bot.bot) throw new Error("This integration requires a Discord bot token.");
  for (const [label, id] of [
    ["outbox", channels.outboxChannelId],
    ["inbox", channels.inboxChannelId],
  ] as const) {
    const read = await discord(token, `/channels/${id}/messages?limit=1`);
    if (!read.ok)
      throw new Error(
        `The bot cannot read the ${label} channel (HTTP ${read.status}). Give it View Channel and Read Message History there.`,
      );
  }
  return { id: bot.id, username: bot.username };
}

export async function configureReddit(
  home: string,
  input: RedditSetupInput,
  options: { verify?: typeof verifyAccess; progress?: (stage: SetupStage) => void } = {},
) {
  return withAppLock(home, "reddit", async () => {
    options.progress?.("runtime");
    const previous = await loadConfig(home);
    const binary = await executable(
      input.tunnelClient || previous?.tunnelClient || "tunnel-client",
    );
    if (
      previous &&
      (await (await runtime(home, { ...previous, tunnelClient: binary })).status()).processRunning
    )
      throw new Error("Stop Reddit before changing its configuration: apps-of-dots reddit stop");
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
    const channels = {
      outboxChannelId: parseSnowflake(
        input.outboxChannel || previous?.outboxChannelId,
        "Outbox channel",
      ),
      inboxChannelId: parseSnowflake(
        input.inboxChannel || previous?.inboxChannelId,
        "Inbox channel",
      ),
      bridgeBotId: parseSnowflake(input.bridgeBot || previous?.bridgeBotId, "Bridge bot user ID"),
    };
    options.progress?.("bot");
    const identity = input.skipValidation
      ? undefined
      : await (options.verify ?? verifyAccess)(bot, channels);
    options.progress?.("save");
    // An unchecked token keeps the recorded ID only if it is the same token.
    const agentBotId = identity?.id ?? (input.botToken ? undefined : previous?.agentBotId);
    const config = await saveConfig(
      home,
      { tunnelId, tunnelClient: binary, ...channels, ...(agentBotId ? { agentBotId } : {}) },
      { bot, tunnel },
    );
    return {
      configured: true,
      toolCount: TOOL_COUNT,
      bot: identity ?? "not checked",
      tunnelId: config.tunnelId,
      agentAuthorId: agentBotId ?? "the bot's user ID",
      next: "apps-of-dots reddit start",
    };
  });
}

export async function controlReddit(
  home: string,
  action: "start" | "stop" | "restart",
): Promise<RuntimeStatus> {
  return withAppLock(home, "reddit", async () => {
    const config = await requireConfig(home);
    if (action !== "stop") await readSecrets(home, config);
    const runner = await runtime(home, config);
    if (action === "restart") await runner.stop();
    return action === "stop" ? runner.stop() : runner.start();
  });
}
