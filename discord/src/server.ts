import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { childEnvironment } from "@apps-of-dots/managed-mcp";

const require = createRequire(import.meta.url);
export const SERVER_VERSION = "0.1.0";
export const TOOL_COUNT = 99;
export function serverEntry(): string {
  return require.resolve("@apps-of-dots/discord-server");
}

export function discordEnvironment(token: string, guilds: string[] = []): Record<string, string> {
  return {
    ...childEnvironment(),
    // Every local toolset is available, regardless of the caller's shell settings.
    DISCORD_TOKEN: token,
    DISCORD_MCP_TOOLSETS: "all",
    DISCORD_ALLOWED_GUILDS: guilds.join(","),
    DISCORD_MESSAGE_CONTENT: "true",
    DISCORD_GUILD_MEMBERS: "true",
    DOTENV_CONFIG_PATH: "/dev/null",
    DOTENV_CONFIG_OVERRIDE: "false",
  };
}

export async function inspectTools(
  command = process.execPath,
  args = [serverEntry()],
  env = discordEnvironment(""),
) {
  const client = new Client({ name: "apps-of-dots-inspector", version: "0.1.0" });
  const transport = new StdioClientTransport({ command, args, env, stderr: "pipe" });
  try {
    await client.connect(transport, { timeout: 10_000 });
    return (await client.listTools({}, { timeout: 10_000 })).tools;
  } finally {
    await client.close();
    await transport.close();
  }
}

export async function runServer(token: string, guilds: string[], cwd: string): Promise<number> {
  const child = spawn(process.execPath, [serverEntry()], {
    env: discordEnvironment(token, guilds),
    cwd,
    stdio: "inherit",
  });
  const interrupt = () => {
    child.kill("SIGINT");
  };
  const terminate = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 143)));
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
