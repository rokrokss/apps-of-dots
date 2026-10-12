import { readFile } from "node:fs/promises";
import * as prompts from "@clack/prompts";
import { validateSecret, setupSummary } from "@apps-of-dots/runtime";
import { loadConfig, readSecrets } from "./config.js";
import { configureReddit } from "./service.js";

export interface SetupOptions {
  tunnelId?: string;
  botTokenFile?: string;
  tunnelKeyFile?: string;
  tunnelClient?: string;
  outboxChannel?: string;
  inboxChannel?: string;
  bridgeBot?: string;
  skipValidation?: boolean;
  json?: boolean;
}

function answer<T>(value: T | symbol): T {
  if (prompts.isCancel(value)) throw new Error("Setup cancelled. No configuration was changed.");
  return value as T;
}

export async function setup(home: string, options: SetupOptions) {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.json);
  if (interactive) prompts.intro("apps-of-dots · Reddit");
  const previous = await loadConfig(home);
  const saved = previous ? await readSecrets(home, previous).catch(() => undefined) : undefined;
  async function value(given: string | undefined, existing: string | undefined, message: string) {
    if (given || existing || !interactive) return given || existing;
    return answer<string>(await prompts.text({ message }));
  }
  const tunnelId = await value(options.tunnelId, previous?.tunnelId, "OpenAI tunnel ID (tunnel_…)");
  const outboxChannel = await value(
    options.outboxChannel,
    previous?.outboxChannelId,
    "Outbox channel ID",
  );
  const inboxChannel = await value(
    options.inboxChannel,
    previous?.inboxChannelId,
    "Inbox channel ID",
  );
  const bridgeBot = await value(options.bridgeBot, previous?.bridgeBotId, "Bridge bot user ID");
  async function credential(
    file: string | undefined,
    existing: string | undefined,
    label: string,
    flag: string,
  ) {
    if (file) return validateSecret(await readFile(file, "utf8"), label);
    if (existing) return undefined;
    if (!interactive)
      throw new Error(`Provide ${flag} FILE, or run setup in an interactive terminal.`);
    return validateSecret(answer<string>(await prompts.password({ message: label })), label);
  }
  const tunnelKey = await credential(
    options.tunnelKeyFile,
    saved?.tunnel,
    "OpenAI tunnel runtime key",
    "--tunnel-key-file",
  );
  const botToken = await credential(
    options.botTokenFile,
    saved?.bot,
    "Agent Discord bot token",
    "--bot-token-file",
  );
  const result = await configureReddit(home, {
    ...options,
    tunnelId,
    outboxChannel,
    inboxChannel,
    bridgeBot,
    tunnelKey,
    botToken,
  });
  if (interactive)
    prompts.outro(
      `${setupSummary(result)}\nSet the bridge's Agent bot user ID in Reddit to ${result.agentAuthorId}.`,
    );
  return result;
}
