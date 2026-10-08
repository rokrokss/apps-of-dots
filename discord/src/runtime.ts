import { fileURLToPath } from "node:url";
import { TunnelRuntime, readOptional } from "@apps-of-dots/runtime";
import { secretPaths, type DiscordConfig } from "./config.js";

export function stdioEntry(): string {
  return fileURLToPath(new URL("./stdio.js", import.meta.url));
}

export async function runtime(home: string, config: DiscordConfig): Promise<TunnelRuntime> {
  const paths = secretPaths(home, config);
  const secrets = await Promise.all([readOptional(paths.bot), readOptional(paths.tunnel)]);
  return new TunnelRuntime({
    binary: config.tunnelClient,
    home,
    app: "discord",
    tunnelId: config.tunnelId,
    keyFile: secretPaths(home, config).tunnel,
    command: [process.execPath, stdioEntry(), home],
    secrets: secrets
      .filter((secret): secret is string => secret !== undefined)
      .map((secret) => secret.trim()),
  });
}
