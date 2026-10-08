import type { RuntimeStatus } from "./tunnel.js";

// Shared presentation for every integration; account-specific behavior stays in each app.
export const commandHelp = {
  setup: "Configure account and tunnel settings",
  install: "Install or update the local runtime",
  login: "Sign in with a QR code in this terminal (stop first)",
  start: "Start or reuse the managed tunnel",
  stop: "Stop the managed tunnel and keep account settings",
  restart: "Reload settings and restart the managed tunnel",
  status: "Show process, health, and readiness separately",
  logs: "Read tunnel logs with saved credentials redacted",
  doctor: "Check local setup, tools, and tunnel status",
  tools: "List all tool schemas without signing in",
  mcp: "Run the local MCP server over stdio",
} as const;

export const jsonHelp = {
  setup: "Print JSON without prompting",
  status: "Print JSON status",
  checks: "Print JSON checks",
  tools: "Print full tool schemas as JSON",
};

export function compareCommands(a: { name(): string }, b: { name(): string }): number {
  const order = Object.keys(commandHelp);
  const rank = (name: string) => {
    const index = order.indexOf(name);
    return index < 0 ? order.length : index;
  };
  return rank(a.name()) - rank(b.name());
}

export function printResult(value: unknown, json = false): void {
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

export interface SetupResult {
  configured: boolean;
  toolCount: number;
  next: string;
}

export function setupSummary(result: SetupResult): string {
  return `Saved. ${result.toolCount} tools available.\nNext: ${result.next}`;
}

export function printStartupHint(app: string, status: RuntimeStatus, json = false): void {
  if (json) return;
  if (!status.processRunning || !status.healthy)
    console.log(`Check apps-of-dots ${app} doctor and apps-of-dots ${app} logs for details.`);
  else if (!status.ready)
    console.log(
      `Still starting. Run apps-of-dots ${app} status again before connecting the plugin.`,
    );
}

export function printTools(
  name: string,
  tools: { name: string; description?: string }[],
  json = false,
): void {
  if (json) printResult(tools, true);
  else {
    console.log(`${tools.length} tools · apps-of-dots ${name}\n`);
    for (const tool of tools)
      console.log(`${tool.name}\n  ${tool.description?.replaceAll("\n", " ") ?? ""}`);
  }
}
