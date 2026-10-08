import { readFile } from "node:fs/promises";
import * as prompts from "@clack/prompts";
import { validateSecret, setupSummary } from "@apps-of-dots/runtime";
import { loadConfig, readSecrets } from "./config.js";
import { configureDiscord } from "./service.js";
export { verifyBot } from "./service.js";

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

export async function setup(home: string, options: SetupOptions) {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.json);
  if (interactive) prompts.intro("apps-of-dots · Discord");
  const previous = await loadConfig(home);
  const saved = previous ? await readSecrets(home, previous).catch(() => undefined) : undefined;
  let tunnelId = options.tunnelId || previous?.tunnelId;
  if (!tunnelId && interactive)
    tunnelId = answer<string>(
      await prompts.text({ message: "OpenAI tunnel ID", placeholder: "tunnel_…" }),
    );
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
    "Discord bot token",
    "--bot-token-file",
  );
  const result = await configureDiscord(home, { ...options, tunnelId, tunnelKey, botToken });
  if (interactive) prompts.outro(setupSummary(result));
  return result;
}
