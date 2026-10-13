import { Help, type Command } from "commander";
import {
  commandHelp,
  jsonHelp,
  compareCommands,
  printResult as print,
  printStartupHint,
  printTools,
  runCommand,
  tunnelEnvironment,
  type RuntimeStatus,
} from "@apps-of-dots/runtime";
import { showLogs } from "@apps-of-dots/managed-mcp";
import { loadConfig, requireConfig, readSecrets } from "./config.js";
import { setup, type SetupOptions } from "./setup.js";
import { inspectTools, runServer, TOOL_COUNT, SERVER_VERSION } from "./server.js";
import { runtime } from "./runtime.js";
import { controlReddit, redditEventStatus, verifyAccess } from "./service.js";
import { describeEvents, type EventStatus } from "./events.js";

function printStatus(status: RuntimeStatus, json: boolean, events?: EventStatus | string): void {
  print(
    {
      ...status,
      reddit:
        "Tools reach Reddit through the Devvit bridge's Discord channels; tunnel readiness does not check the bridge.",
      ...(events
        ? { events: json || typeof events === "string" ? events : describeEvents(events) }
        : {}),
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
    return `${tools.length} tools from local Reddit server ${SERVER_VERSION}`;
  });
  await check("configuration", async () => {
    const config = await requireConfig(home);
    await readSecrets(home, config);
    return "Configuration and credential files are present.";
  });
  await check("MCP events", async () => describeEvents(await redditEventStatus(home)));
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
      await check("Discord bot and channels", async () => {
        const identity = await verifyAccess((await readSecrets(home, config)).bot, config);
        return `Bot ${identity.username} (${identity.id}) reads both channels. The bridge's Agent bot user ID must be ${identity.id}.`;
      });
      await check("native tunnel configuration", async () => {
        await (await runtime(home, config)).doctor();
        return "Native tunnel-client doctor passed.";
      });
    }
  }
  return { ok: checks.every((check) => check.ok), checks, status, liveChecks: live };
}

export function registerReddit(program: Command, home: () => string): void {
  const reddit = program
    .command("reddit")
    .description("Reddit through the Devvit bridge and a private OpenAI tunnel");
  reddit
    .command("setup")
    .description(commandHelp.setup)
    .option("--tunnel-id <id>", "Existing OpenAI tunnel ID")
    .option("--tunnel-key-file <path>", "Read the tunnel runtime key from a file")
    .option("--tunnel-client <path>", "Official tunnel-client executable")
    .option("--bot-token-file <path>", "Read the agent Discord bot token from a file")
    .option("--outbox-channel <id>", "Discord channel for requests and statuses")
    .option("--inbox-channel <id>", "Discord channel the bridge copies Reddit activity to")
    .option("--bridge-bot <id>", "The bridge bot's Discord user ID")
    .option("--skip-validation", "Save without contacting Discord; useful for offline provisioning")
    .option("--json", jsonHelp.setup)
    .action(async (options: SetupOptions) => {
      const result = await setup(home(), options);
      if (options.json || !process.stdin.isTTY || !process.stdout.isTTY)
        print(result, Boolean(options.json));
    });

  reddit
    .command("start")
    .description(commandHelp.start)
    .option("--json", jsonHelp.status)
    .action(async (options: { json?: boolean }) => {
      const status = await controlReddit(home(), "start");
      printStatus(status, Boolean(options.json));
      if (!status.processRunning || !status.healthy) process.exitCode = 1;
      printStartupHint("reddit", status, options.json);
    });

  for (const action of ["stop", "restart"] as const) {
    reddit
      .command(action)
      .description(commandHelp[action])
      .option("--json", jsonHelp.status)
      .action(async (options: { json?: boolean }) => {
        const status = await controlReddit(home(), action);
        printStatus(status, Boolean(options.json));
        if (action === "restart") printStartupHint("reddit", status, options.json);
        if (action === "restart" && (!status.processRunning || !status.healthy))
          process.exitCode = 1;
      });
  }

  reddit
    .command("status")
    .description(commandHelp.status)
    .option("--json", jsonHelp.status)
    .action(async (options: { json?: boolean }) => {
      const directory = home();
      const config = await loadConfig(directory);
      if (!config) {
        print(
          { state: "not configured", next: "apps-of-dots reddit setup" },
          Boolean(options.json),
        );
        return;
      }
      printStatus(
        await (await runtime(directory, config)).status(),
        Boolean(options.json),
        // An unreadable events file stops the MCP server; say so without hiding the tunnel state.
        await redditEventStatus(directory).catch((error: Error) => error.message),
      );
    });

  reddit
    .command("doctor")
    .description(commandHelp.doctor)
    .option("--live", "Check the bot token, channel access and tunnel configuration")
    .option("--json", jsonHelp.checks)
    .action(async (options: { json?: boolean; live?: boolean }) => {
      const result = await doctor(home(), Boolean(options.live));
      if (options.json) print(result, true);
      else
        for (const check of result.checks)
          console.log(`${check.ok ? "OK" : "FAIL"}  ${check.name}: ${check.detail}`);
      if (!result.ok) process.exitCode = 1;
    });

  reddit
    .command("tools")
    .description(commandHelp.tools)
    .option("--json", jsonHelp.tools)
    .action(async (options: { json?: boolean }) => {
      printTools("Reddit", await inspectTools(), options.json);
    });

  reddit
    .command("mcp")
    .description(commandHelp.mcp)
    .action(async () => {
      const directory = home();
      const config = await requireConfig(directory);
      process.exitCode = await runServer((await readSecrets(directory, config)).bot, config);
    });

  reddit
    .command("logs")
    .description(commandHelp.logs)
    .option("-f, --follow", "Follow new log output until Ctrl-C")
    .action(async (options: { follow?: boolean }) => {
      const directory = home();
      const config = await requireConfig(directory);
      const status = await (await runtime(directory, config)).status();
      if (!status.logPath)
        throw new Error("No runtime logs yet. Run apps-of-dots reddit start first.");
      await showLogs(
        status.logPath,
        Object.values(await readSecrets(directory, config)),
        Boolean(options.follow),
      );
    });
  reddit.configureHelp({
    visibleCommands: (cmd) => new Help().visibleCommands(cmd).sort(compareCommands),
  });
  reddit.addHelpText(
    "after",
    "\nFirst use: install the Devvit bridge (reddit/devvit), then setup → start → status.",
  );
}
