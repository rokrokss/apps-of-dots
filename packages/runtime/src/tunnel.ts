import { execFile } from "node:child_process";
import { join } from "node:path";
import { privateDirectory, redact } from "./storage.js";

export interface TunnelOptions {
  binary: string;
  home: string;
  app: string;
  tunnelId: string;
  keyFile: string;
  command: string[];
  secrets?: string[];
}

export interface RuntimeStatus {
  state: string;
  processRunning: boolean;
  healthy: boolean;
  ready: boolean;
  tunnelId: string;
  healthUrl?: string;
  uiUrl?: string;
  logPath?: string;
}

// tunnel-client parses a command string with shell-style quoting, without a shell.
export function quoteCommand(argv: readonly string[]): string {
  return argv
    .map((part) => {
      if (/[\r\n\0]/.test(part))
        throw new Error("Command arguments cannot contain control characters.");
      return `'${part.replaceAll("'", `'"'"'`)}'`;
    })
    .join(" ");
}

export function tunnelEnvironment(home: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Do not inherit unrelated tunnel profiles, credentials, bindings, or raw logging.
  for (const key of Object.keys(env)) {
    if (
      /^(CONTROL_PLANE_|MCP_|TUNNEL_CLIENT_|HARPOON_|CLOUDFLARED_|HEALTH_|LOG_|PID_|ADMIN_UI_|DISCORD_|DOTENV_CONFIG_)/.test(
        key,
      )
    )
      delete env[key];
  }
  delete env.ALLOW_REMOTE_UI;
  delete env.OPEN_WEB_UI;
  env.TUNNEL_CLIENT_STATE_DIR = join(home, "tunnel-state");
  return env;
}

export function runCommand(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout = 45_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { env, timeout, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || stdout || error.message).trim()));
        else resolve(stdout.trim());
      },
    );
  });
}

export class TunnelRuntime {
  readonly alias: string;
  readonly env: NodeJS.ProcessEnv;
  constructor(readonly options: TunnelOptions) {
    if (!/^[a-z][a-z0-9-]*$/.test(options.app)) throw new Error("Invalid app identifier.");
    this.alias = `apps-of-dots-${options.app}`;
    this.env = tunnelEnvironment(options.home);
  }

  private async invoke(args: string[]): Promise<Record<string, unknown>> {
    try {
      const output = await runCommand(this.options.binary, [...args, "--json"], this.env);
      const result: unknown = JSON.parse(output);
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw new Error("Invalid tunnel-client response.");
      return result as Record<string, unknown>;
    } catch (error) {
      throw new Error(redact((error as Error).message, this.options.secrets ?? []));
    }
  }

  async status(): Promise<RuntimeStatus> {
    let result: Record<string, unknown>;
    try {
      result = await this.invoke(["runtimes", "status", this.alias]);
    } catch (error) {
      if (!(error as Error).message.includes(`alias ${this.alias} is not known`)) throw error;
      return {
        state: "stopped",
        processRunning: false,
        healthy: false,
        ready: false,
        tunnelId: this.options.tunnelId,
      };
    }
    const local = result.local as { log?: { path?: unknown } } | undefined;
    const logPath = result.log_path ?? local?.log?.path;
    return {
      state: typeof result.runtime_state === "string" ? result.runtime_state : "unknown",
      processRunning: result.process_running === true,
      healthy: result.healthy === true,
      ready: result.ready === true,
      tunnelId: this.options.tunnelId,
      healthUrl: typeof result.health_url === "string" ? result.health_url : undefined,
      uiUrl: typeof result.ui_url === "string" ? result.ui_url : undefined,
      logPath: typeof logPath === "string" ? logPath : undefined,
    };
  }

  async start(): Promise<RuntimeStatus> {
    await privateDirectory(this.options.home);
    await privateDirectory(join(this.options.home, "tunnel-state"));
    const profiles = join(this.options.home, this.options.app, "tunnel-profiles");
    await privateDirectory(profiles);
    await this.invoke([
      "runtimes",
      "connect",
      "--alias",
      this.alias,
      "--tunnel-id",
      this.options.tunnelId,
      "--runtime-api-key",
      `file:${this.options.keyFile}`,
      "--mcp-command",
      quoteCommand(this.options.command),
      "--profile-dir",
      profiles,
    ]);
    // A successful spawn is not evidence of a ready connection.
    return this.status();
  }

  async stop(): Promise<RuntimeStatus> {
    const status = await this.status();
    if (status.processRunning) await this.invoke(["runtimes", "stop", this.alias]);
    return this.status();
  }

  async doctor(): Promise<Record<string, unknown>> {
    return this.invoke([
      "doctor",
      "--control-plane.tunnel-id",
      this.options.tunnelId,
      "--control-plane.api-key",
      `file:${this.options.keyFile}`,
      "--mcp.command",
      quoteCommand(this.options.command),
      "--health.listen-addr",
      "127.0.0.1:0",
    ]);
  }
}
