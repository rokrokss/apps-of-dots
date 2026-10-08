#!/usr/bin/env node
import { Command } from "commander";
import { dataHome } from "@apps-of-dots/runtime";
import { registerDiscord } from "@apps-of-dots/discord";
import { registerTelegram } from "@apps-of-dots/telegram";
import { registerWhatsApp } from "@apps-of-dots/whatsapp";
import { integrations } from "./catalog.js";

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
try {
  await program.parseAsync();
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
}
