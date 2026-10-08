import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { redact, runCommand, tunnelEnvironment, type RuntimeStatus } from "@apps-of-dots/runtime";
import { loadConfig, requireConfig, readSecrets } from "./config.js";
import { setup, verifyBot, type SetupOptions } from "./setup.js";
import { inspectTools, runUpstream, TOOL_COUNT, UPSTREAM_VERSION } from "./upstream.js";
import { runtime } from "./runtime.js";

function print(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (value && typeof value === "object") {
    for (const [key, detail] of Object.entries(value)) {
      if (detail !== undefined)
        console.log(
          `${key.padEnd(16)} ${typeof detail === "object" ? JSON.stringify(detail) : String(detail)}`,
        );
    }
  }
}

function printStatus(status: RuntimeStatus, json: boolean): void {
  print(
    {
      ...status,
      discord: "Connects on the first tool call; tunnel readiness is not a Discord login check.",
    },
    json,
  );
}

async function doctor(home: string, live: boolean) {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  async function check(name: string, action: () => Promise<string>) {
    try {
      checks.push({ name, ok: true, detail: await action() });
    } catch (error) {
      checks.push({ name, ok: false, detail: (error as Error).message });
    }
  }
  await check("all upstream tools", async () => {
    const tools = await inspectTools();
    if (tools.length !== TOOL_COUNT)
      throw new Error(`Expected ${TOOL_COUNT} tools; discovered ${tools.length}.`);
    return `${tools.length} tools from @pasympa/discord-mcp@${UPSTREAM_VERSION}`;
  });
  await check("configuration", async () => {
    const config = await requireConfig(home);
    await readSecrets(home, config);
    return "Configuration and credential files are present.";
  });
  const config = await loadConfig(home).catch(() => undefined);
  let status: RuntimeStatus | undefined;
  if (config) {
    await check("tunnel-client", async () =>
      runCommand(config.tunnelClient, ["--version"], tunnelEnvironment(home), 5_000),
    );
    await check("tunnel status", async () => {
      status = await (await runtime(home, config)).status();
      return `${status.state}; process=${status.processRunning}, healthy=${status.healthy}, ready=${status.ready}`;
    });
    if (live) {
      await check("Discord bot", async () => {
        const identity = await verifyBot((await readSecrets(home, config)).bot);
        return `Authenticated bot ${identity.username} (${identity.id}). Guild permissions and role hierarchy still apply.`;
      });
      await check("native tunnel configuration", async () => {
        await (await runtime(home, config)).doctor();
        return "Native tunnel-client doctor passed.";
      });
    }
  }
  return { ok: checks.every((check) => check.ok), checks, status, liveChecks: live };
}

async function readLog(path: string, offset?: number): Promise<{ offset: number; text: string }> {
  const size = (await stat(path)).size;
  const start = offset !== undefined && offset <= size ? offset : Math.max(0, size - 128 * 1024);
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(size - start, 128 * 1024));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (offset === undefined && start > 0) text = text.slice(text.indexOf("\n") + 1);
    return { offset: start + bytesRead, text };
  } finally {
    await file.close();
  }
}

export function registerDiscord(program: Command, home: () => string): void {
  const discord = program
    .command("discord")
    .description("All 99 Discord MCP tools through a private OpenAI tunnel");
  discord
    .command("setup")
    .description("Configure a bot and an existing tunnel; keys are hidden or read from files")
    .option("--tunnel-id <id>", "Existing OpenAI tunnel ID")
    .option("--bot-token-file <path>", "Read the Discord bot token from a file")
    .option("--tunnel-key-file <path>", "Read the tunnel runtime key from a file")
    .option("--tunnel-client <path>", "Path to the official tunnel-client executable")
    .option("--guilds <ids>", "Optional comma-separated guild IDs, or all (default: all)")
    .option("--skip-validation", "Save without contacting Discord; useful for offline provisioning")
    .option("--json", "Print machine-readable output without prompting")
    .action(async (options: SetupOptions) => {
      print(await setup(home(), options), Boolean(options.json));
    });

  discord
    .command("start")
    .description("Start or reuse the official managed tunnel process")
    .option("--json", "Print machine-readable status")
    .action(async (options: { json?: boolean }) => {
      const directory = home();
      const config = await requireConfig(directory);
      await readSecrets(directory, config);
      const status = await (await runtime(directory, config)).start();
      printStatus(status, Boolean(options.json));
      if (!status.processRunning || !status.healthy) process.exitCode = 1;
      else if (!status.ready && !options.json)
        console.log(
          "Still starting. Run apps-of-dots discord status again before connecting the plugin.",
        );
    });

  for (const action of ["stop", "restart"] as const) {
    discord
      .command(action)
      .description(
        action === "stop"
          ? "Stop the managed process and keep configuration"
          : "Reload configuration and restart the managed process",
      )
      .option("--json", "Print machine-readable status")
      .action(async (options: { json?: boolean }) => {
        const directory = home();
        const config = await requireConfig(directory);
        if (action === "restart") await readSecrets(directory, config);
        const runner = await runtime(directory, config);
        const stopped = await runner.stop();
        const status = action === "restart" ? await runner.start() : stopped;
        printStatus(status, Boolean(options.json));
        if (action === "restart" && (!status.processRunning || !status.healthy))
          process.exitCode = 1;
      });
  }

  discord
    .command("status")
    .description("Show process, health, and readiness separately")
    .option("--json", "Print machine-readable status")
    .action(async (options: { json?: boolean }) => {
      const directory = home();
      const config = await loadConfig(directory);
      if (!config) {
        print(
          { state: "not configured", next: "apps-of-dots discord setup" },
          Boolean(options.json),
        );
        return;
      }
      printStatus(await (await runtime(directory, config)).status(), Boolean(options.json));
    });

  discord
    .command("doctor")
    .description("Check local setup and the full upstream MCP tool catalog")
    .option("--live", "Also verify Discord authentication and run native tunnel diagnostics")
    .option("--json", "Print machine-readable checks")
    .action(async (options: { json?: boolean; live?: boolean }) => {
      const result = await doctor(home(), Boolean(options.live));
      if (options.json) print(result, true);
      else
        for (const check of result.checks)
          console.log(`${check.ok ? "OK" : "FAIL"}  ${check.name}: ${check.detail}`);
      if (!result.ok) process.exitCode = 1;
    });

  discord
    .command("tools")
    .description("Inspect every upstream tool without signing in to Discord")
    .option("--json", "Print full tool schemas")
    .action(async (options: { json?: boolean }) => {
      const tools = await inspectTools();
      if (options.json) print(tools, true);
      else {
        console.log(`${tools.length} tools · @pasympa/discord-mcp@${UPSTREAM_VERSION}\n`);
        for (const tool of tools)
          console.log(`${tool.name}\n  ${tool.description?.replaceAll("\n", " ") ?? ""}`);
      }
    });

  discord
    .command("mcp")
    .description("Run the same complete MCP over stdio for a local client")
    .action(async () => {
      const directory = home();
      const config = await requireConfig(directory);
      process.exitCode = await runUpstream(
        (await readSecrets(directory, config)).bot,
        config.allowedGuilds,
        join(directory, "discord"),
      );
    });

  discord
    .command("logs")
    .description("Show recent managed tunnel logs with credentials redacted")
    .option("-f, --follow", "Follow new log output until Ctrl-C")
    .action(async (options: { follow?: boolean }) => {
      const directory = home();
      const config = await requireConfig(directory);
      const status = await (await runtime(directory, config)).status();
      if (!status.logPath)
        throw new Error("No runtime logs yet. Run apps-of-dots discord start first.");
      const secrets = Object.values(await readSecrets(directory, config));
      let offset: number | undefined;
      let pendingLine = "";
      let discardingLine = false;
      const flush = async () => {
        const next = await readLog(status.logPath!, offset);
        if (offset !== undefined && next.offset < offset) {
          pendingLine = "";
          discardingLine = false;
        }
        offset = next.offset;
        // Never print an incomplete line: a secret may span filesystem reads.
        let incoming = next.text;
        if (discardingLine) {
          const end = incoming.indexOf("\n");
          if (end < 0) return;
          incoming = incoming.slice(end + 1);
          discardingLine = false;
        }
        pendingLine += incoming;
        const end = pendingLine.lastIndexOf("\n");
        if (end >= 0) {
          process.stdout.write(redact(pendingLine.slice(0, end + 1), secrets));
          pendingLine = pendingLine.slice(end + 1);
        }
        if (pendingLine.length > 128 * 1024) {
          pendingLine = "";
          discardingLine = true;
        }
      };
      await flush();
      if (options.follow) {
        await new Promise<void>((resolve, reject) => {
          let pending = false;
          const timer = setInterval(() => {
            if (pending) return;
            pending = true;
            flush()
              .catch((error) => {
                cleanup();
                reject(error);
              })
              .finally(() => {
                pending = false;
              });
          }, 500);
          const cleanup = () => {
            clearInterval(timer);
            process.off("SIGINT", done);
            process.off("SIGTERM", done);
          };
          const done = () => {
            cleanup();
            resolve();
          };
          process.once("SIGINT", done);
          process.once("SIGTERM", done);
        });
      }
    });
}
