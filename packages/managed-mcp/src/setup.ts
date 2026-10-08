import { readFile } from "node:fs/promises";
import * as prompts from "@clack/prompts";
import { executable, runCommand, tunnelEnvironment, validateSecret } from "@apps-of-dots/runtime";
import { loadConfig, readSecrets } from "./config.js";

export interface SetupOptions {
  tunnelId?: string;
  tunnelKeyFile?: string;
  tunnelClient?: string;
  skipInstall?: boolean;
  json?: boolean;
}
function answer(value: string | symbol): string {
  if (prompts.isCancel(value)) throw new Error("Setup cancelled. No configuration was changed.");
  return value as string;
}
export async function prepareSetup(home: string, app: string, options: SetupOptions) {
  const previous = await loadConfig(home, app);
  const saved = previous
    ? await readSecrets(home, app, previous).catch(() => ({}) as Record<string, string>)
    : {};
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.json);
  const tunnelClient = await executable(
    options.tunnelClient || previous?.tunnelClient || "tunnel-client",
  );
  const help = await runCommand(
    tunnelClient,
    ["runtimes", "connect", "--help"],
    tunnelEnvironment(home),
    10_000,
  );
  if (!help.includes("--runtime-api-key") || !help.includes("--tunnel-id"))
    throw new Error("Upgrade the official tunnel-client: managed runtimes are required.");
  const value = async (
    provided: string | undefined,
    existing: string | undefined,
    label: string,
    flag: string,
  ) => {
    if (provided !== undefined) return provided.trim();
    if (existing !== undefined) return existing;
    if (!interactive) throw new Error(`Provide ${flag}, or run setup in an interactive terminal.`);
    return answer(await prompts.text({ message: label })).trim();
  };
  const credential = async (
    file: string | undefined,
    existing: string | undefined,
    label: string,
    flag: string,
  ) => {
    if (file) return validateSecret(await readFile(file, "utf8"), label);
    if (existing) return existing;
    if (!interactive)
      throw new Error(`Provide ${flag} FILE, or run setup in an interactive terminal.`);
    return validateSecret(answer(await prompts.password({ message: label })), label);
  };
  const tunnelId = await value(
    options.tunnelId,
    previous?.tunnelId,
    "OpenAI tunnel ID",
    "--tunnel-id tunnel_…",
  );
  if (!/^tunnel_[a-zA-Z0-9_-]+$/.test(tunnelId))
    throw new Error(
      "Invalid tunnel ID. Obtain one from https://platform.openai.com/settings/organization/tunnels",
    );
  const tunnel = await credential(
    options.tunnelKeyFile,
    saved.tunnel,
    "OpenAI tunnel runtime key",
    "--tunnel-key-file",
  );
  return { previous, saved, interactive, value, credential, tunnelId, tunnelClient, tunnel };
}
