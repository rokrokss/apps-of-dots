import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { Help, type Command } from "commander";
import {
  commandHelp,
  jsonHelp,
  compareCommands,
  printResult as print,
  printStartupHint,
  printTools,
  redact,
  runCommand,
  tunnelEnvironment,
  type RuntimeStatus,
} from "@apps-of-dots/runtime";
import { loadConfig, requireConfig, readSecrets } from "./config.js";
import { setup, verifyBot, type SetupOptions } from "./setup.js";
import { inspectTools, runServer, TOOL_COUNT, SERVER_VERSION } from "./server.js";
import { runtime } from "./runtime.js";
import { controlDiscord } from "./service.js";

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
  await check("all local tools", async () => {
    const tools = await inspectTools();
    if (tools.length !== TOOL_COUNT)
      throw new Error(`Expected ${TOOL_COUNT} tools; discovered ${tools.length}.`);
    return `${tools.length} tools from local Discord server ${SERVER_VERSION}`;
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
    .description("Discord MCP through a private OpenAI tunnel");
  discord
    .command("setup")
    .description(commandHelp.setup)
    .option("--tunnel-id <id>", "Existing OpenAI tunnel ID")
    .option("--tunnel-key-file <path>", "Read the tunnel runtime key from a file")
    .option("--tunnel-client <path>", "Official tunnel-client executable")
    .option("--bot-token-file <path>", "Read the Discord bot token from a file")
    .option("--guilds <ids>", "Optional comma-separated guild IDs, or all (default: all)")
    .option("--skip-validation", "Save without contacting Discord; useful for offline provisioning")
    .option("--json", jsonHelp.setup)
    .action(async (options: SetupOptions) => {
      const result = await setup(home(), options);
      if (options.json || !process.stdin.isTTY || !process.stdout.isTTY)
        print(result, Boolean(options.json));
    });

  discord
    .command("start")
    .description(commandHelp.start)
    .option("--json", jsonHelp.status)
    .action(async (options: { json?: boolean }) => {
      const directory = home();
      const status = await controlDiscord(directory, "start");
      printStatus(status, Boolean(options.json));
      if (!status.processRunning || !status.healthy) process.exitCode = 1;
      printStartupHint("discord", status, options.json);
    });

  for (const action of ["stop", "restart"] as const) {
    discord
      .command(action)
      .description(commandHelp[action])
      .option("--json", jsonHelp.status)
      .action(async (options: { json?: boolean }) => {
        const directory = home();
        const status = await controlDiscord(directory, action);
        printStatus(status, Boolean(options.json));
        if (action === "restart") printStartupHint("discord", status, options.json);
        if (action === "restart" && (!status.processRunning || !status.healthy))
          process.exitCode = 1;
      });
  }

  discord
    .command("status")
    .description(commandHelp.status)
    .option("--json", jsonHelp.status)
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
    .description(commandHelp.doctor)
    .option("--live", "Check bot authentication and tunnel configuration (running or stopped)")
    .addHelpText(
      "after",
      "\nLive checks work with the tunnel running or stopped; the bot token is checked directly.",
    )
    .option("--json", jsonHelp.checks)
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
    .description(commandHelp.tools)
    .option("--json", jsonHelp.tools)
    .action(async (options: { json?: boolean }) => {
      const tools = await inspectTools();
      printTools("Discord", tools, options.json);
    });

  discord
    .command("mcp")
    .description(commandHelp.mcp)
    .action(async () => {
      const directory = home();
      const config = await requireConfig(directory);
      process.exitCode = await runServer(
        (await readSecrets(directory, config)).bot,
        config.allowedGuilds,
        join(directory, "discord"),
      );
    });

  discord
    .command("logs")
    .description(commandHelp.logs)
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
  discord.configureHelp({
    visibleCommands: (cmd) => new Help().visibleCommands(cmd).sort(compareCommands),
  });
  discord.addHelpText(
    "after",
    "\nFirst use: setup → start → status\nDiscord uses a bot token; no separate login is required.",
  );
}
