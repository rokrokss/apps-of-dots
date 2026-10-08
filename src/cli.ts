#!/usr/bin/env node
import { Command } from "commander";
import { dataHome } from "@apps-of-dots/runtime";
import { registerDiscord } from "@apps-of-dots/discord";
import { registerTelegram } from "@apps-of-dots/telegram";
import { registerWhatsApp } from "@apps-of-dots/whatsapp";
import { integrations } from "./catalog.js";
import { openBrowser, startWebUi } from "./ui/server.js";

const program = new Command()
  .name("apps-of-dots")
  .description("Self-hosted MCP integrations for OpenAI dots")
  .version("0.1.0")
  .option("--home <path>", "Override the private data directory (or APPS_OF_DOTS_HOME)")
  .showHelpAfterError();

program
  .command("list")
  .description("List built-in integrations and external projects")
  .option("--json", "Print machine-readable output")
  .action((options: { json?: boolean }) => {
    if (options.json) console.log(JSON.stringify(integrations, null, 2));
    else
      for (const integration of integrations)
        console.log(
          `${integration.id.padEnd(12)} ${integration.kind.padEnd(10)} ${integration.guide}`,
        );
  });

registerDiscord(program, () => dataHome(program.opts<{ home?: string }>().home));
registerTelegram(program, () => dataHome(program.opts<{ home?: string }>().home));
registerWhatsApp(program, () => dataHome(program.opts<{ home?: string }>().home));
program
  .command("ui")
  .description("Open the local setup center (guided setup, QR sign-in, and tunnel controls)")
  .option("--port <port>", "Local port (0 chooses an available port)", "3210")
  .option("--no-open", "Print the setup link without opening a browser")
  .action(async (options: { port: string; open: boolean }) => {
    if (!/^\d+$/.test(options.port) || Number(options.port) > 65535)
      throw new Error("Port must be between 0 and 65535.");
    const { server, url } = await startWebUi({
      home: dataHome(program.opts<{ home?: string }>().home),
      port: Number(options.port),
    });
    console.log(
      `Setup center: ${url}\nKeep this terminal open while using the setup center. Started MCP tunnels run independently.`,
    );
    if (options.open)
      await openBrowser(url).catch(() => console.log("Open the setup link above in your browser."));
    const close = () => {
      server.close();
      server.closeIdleConnections();
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      process.off("SIGHUP", close);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    process.once("SIGHUP", close);
  });
try {
  await program.parseAsync();
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
}
