import { join } from "node:path";
import { Help, type Command } from "commander";
import * as prompts from "@clack/prompts";
import {
  TunnelRuntime,
  commandHelp,
  jsonHelp,
  compareCommands,
  printResult as print,
  printStartupHint,
  printTools,
  setupSummary,
  type SetupResult,
  runCommand,
  tunnelEnvironment,
} from "@apps-of-dots/runtime";
import {
  loadConfig,
  requireConfig,
  readSecrets,
  secretDirectory,
  type ManagedConfig,
} from "./config.js";
import { installSource, requireInstallation, type SourceSpec } from "./source.js";
import { withAppLock } from "./process.js";
import { inspectCatalog } from "./catalog.js";
import { showLogs } from "./logs.js";
import type { SetupOptions } from "./setup.js";

export interface ManagedIntegration {
  id: string;
  name: string;
  source: SourceSpec;
  toolCount: number;
  entry: string;
  setupOptions(command: Command): void;
  setup(home: string, options: SetupOptions): Promise<SetupResult>;
  login(home: string): Promise<void>;
  preflight(home: string): Promise<void>;
  run(home: string): Promise<number>;
  liveCheck?(home: string): Promise<string>;
  liveCheckHelp: string;
  liveCheckInstructions: string;
}
export async function managedRuntime(
  home: string,
  app: ManagedIntegration,
  config?: ManagedConfig,
): Promise<TunnelRuntime> {
  const c = config ?? (await requireConfig(home, app.id));
  const secrets = await readSecrets(home, app.id, c).catch(() => ({}));
  return new TunnelRuntime({
    binary: c.tunnelClient,
    home,
    app: app.id,
    tunnelId: c.tunnelId,
    keyFile: join(secretDirectory(home, app.id, c), "tunnel-key"),
    command: [process.execPath, app.entry, home],
    secrets: Object.values(secrets),
  });
}
export async function requireStopped(home: string, app: ManagedIntegration): Promise<void> {
  const c = await loadConfig(home, app.id);
  if (c && (await (await managedRuntime(home, app, c)).status()).processRunning)
    throw new Error(`Stop ${app.name} first: apps-of-dots ${app.id} stop`);
}

export function registerManaged(
  program: Command,
  home: () => string,
  app: ManagedIntegration,
): void {
  const command = program
    .command(app.id)
    .description(`${app.name} MCP through a private OpenAI tunnel`);
  const setup = command
    .command("setup")
    .description(commandHelp.setup)
    .option("--tunnel-id <id>", "Existing OpenAI tunnel ID")
    .option("--tunnel-key-file <path>", "Read the tunnel runtime key from a file")
    .option("--tunnel-client <path>", "Official tunnel-client executable")
    .option("--skip-install", "Save settings without installing dependencies/building local code")
    .option("--json", jsonHelp.setup);
  app.setupOptions(setup);
  setup.action(async (options: SetupOptions) => {
    const directory = home();
    await requireStopped(directory, app);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.json);
    await withAppLock(directory, app.id, async () => {
      if (interactive) prompts.intro(`apps-of-dots · ${app.name}`);
      const result = await app.setup(directory, options);
      if (interactive) prompts.outro(setupSummary(result));
      else print(result, options.json);
    });
  });
  command
    .command("install")
    .description(commandHelp.install)
    .option("--json", "Print JSON")
    .action(async (options: { json?: boolean }) => {
      const directory = home();
      await requireStopped(directory, app);
      await withAppLock(directory, app.id, () => installSource(directory, app.source));
      print({ installed: true, source: app.source.directory }, options.json);
      if (!options.json)
        console.log(
          `Next: apps-of-dots ${app.id} login, or apps-of-dots ${app.id} start if already signed in.`,
        );
    });
  command
    .command("login")
    .description(commandHelp.login)
    .action(async () => {
      const directory = home();
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error(`Run apps-of-dots ${app.id} login in an interactive terminal.`);
      await requireStopped(directory, app);
      await requireInstallation(directory, app.source);
      await withAppLock(directory, app.id, () => app.login(directory));
    });
  for (const action of ["start", "stop", "restart", "status"] as const) {
    command
      .command(action)
      .description(commandHelp[action])
      .option("--json", jsonHelp.status)
      .action(async (options: { json?: boolean }) => {
        const directory = home();
        const config = await loadConfig(directory, app.id);
        if (!config && action === "status") {
          print({ state: "not configured", next: `apps-of-dots ${app.id} setup` }, options.json);
          return;
        }
        const runner = await managedRuntime(directory, app, config);
        if (action === "restart") await runner.stop();
        if (action === "start" || action === "restart") {
          await requireInstallation(directory, app.source);
          await app.preflight(directory);
        }
        const result =
          action === "start" || action === "restart"
            ? await runner.start()
            : action === "stop"
              ? await runner.stop()
              : await runner.status();
        print(result, options.json);
        if (action === "start" || action === "restart")
          printStartupHint(app.id, result, options.json);
        if (
          (action === "start" || action === "restart") &&
          (!result.processRunning || !result.healthy)
        )
          process.exitCode = 1;
      });
  }
  command
    .command("mcp")
    .description(commandHelp.mcp)
    .action(async () => {
      process.exitCode = await app.run(home());
    });
  command
    .command("tools")
    .description(commandHelp.tools)
    .option("--json", jsonHelp.tools)
    .action(async (options: { json?: boolean }) => {
      const tools = await inspectCatalog(home(), app.source);
      printTools(app.name, tools, options.json);
    });
  command
    .command("doctor")
    .description(commandHelp.doctor)
    .option("--live", app.liveCheckHelp)
    .addHelpText("after", `\n${app.liveCheckInstructions}`)
    .option("--json", jsonHelp.checks)
    .action(async (options: { json?: boolean; live?: boolean }) => {
      const directory = home();
      const checks: { name: string; ok: boolean; detail: string }[] = [];
      const check = async (name: string, work: () => Promise<string>) => {
        try {
          checks.push({ name, ok: true, detail: await work() });
        } catch (error) {
          checks.push({ name, ok: false, detail: (error as Error).message });
        }
      };
      await check("local MCP tools", async () => {
        const tools = await inspectCatalog(directory, app.source);
        if (tools.length !== app.toolCount)
          throw new Error(`Expected ${app.toolCount}, discovered ${tools.length}.`);
        return `${tools.length} local tools (offline metadata inspection).`;
      });
      await check("configuration and login files", async () => {
        await app.preflight(directory);
        return "Private configuration and local session files exist; live authentication is not checked.";
      });
      await check("tunnel-client", async () => {
        const c = await requireConfig(directory, app.id);
        return runCommand(c.tunnelClient, ["--version"], tunnelEnvironment(directory), 5000);
      });
      await check("tunnel status", async () => {
        const s = await (await managedRuntime(directory, app)).status();
        return `${s.state}; process=${s.processRunning}, healthy=${s.healthy}, ready=${s.ready}`;
      });
      if (options.live) {
        if (app.liveCheck) await check("account", () => app.liveCheck!(directory));
        await check("native tunnel diagnostics", async () => {
          await (await managedRuntime(directory, app)).doctor();
          return "Native tunnel diagnostics passed.";
        });
      }
      const result = { ok: checks.every((c) => c.ok), checks, liveChecks: Boolean(options.live) };
      if (options.json) print(result, true);
      else for (const c of checks) console.log(`${c.ok ? "OK" : "FAIL"}  ${c.name}: ${c.detail}`);
      if (!result.ok) process.exitCode = 1;
    });
  command
    .command("logs")
    .description(commandHelp.logs)
    .option("-f, --follow", "Follow new log output until Ctrl-C")
    .action(async (options: { follow?: boolean }) => {
      const directory = home();
      const c = await requireConfig(directory, app.id);
      const status = await (await managedRuntime(directory, app, c)).status();
      if (!status.logPath) throw new Error(`No logs yet. Run apps-of-dots ${app.id} start.`);
      await showLogs(
        status.logPath,
        Object.values(await readSecrets(directory, app.id, c)),
        Boolean(options.follow),
      );
    });
  command.configureHelp({
    visibleCommands: (cmd) => new Help().visibleCommands(cmd).sort(compareCommands),
  });
  command.addHelpText(
    "after",
    "\nFirst use: setup → login → start → status\nSetup prepares the local runtime. Login displays a QR code; stop before signing in again.",
  );
}
