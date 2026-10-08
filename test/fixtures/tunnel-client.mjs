#!/usr/bin/env node
// Local test double. It never connects to Discord or OpenAI.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("0.0.14-fixture");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log("--runtime-api-key --tunnel-id --mcp-command");
  process.exit(0);
}
const root = process.env.TUNNEL_CLIENT_STATE_DIR;
if (!root) throw new Error("Missing isolated state directory");
mkdirSync(root, { recursive: true });
appendFileSync(
  join(root, "calls.jsonl"),
  JSON.stringify({
    args,
    inheritedToken: process.env.DISCORD_TOKEN,
    inheritedKey: process.env.CONTROL_PLANE_API_KEY,
    inheritedCommand: process.env.MCP_COMMAND,
  }) + "\n",
);
const path = join(root, "fixture-status.json");
const saved = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
const option = (name) => args[args.indexOf(name) + 1];
let result;
if (args[0] === "doctor") result = { ok: true };
else if (args[1] === "connect") {
  if (process.env.FIXTURE_CONNECT_ERROR) {
    console.error(process.env.FIXTURE_CONNECT_ERROR);
    process.exit(1);
  }
  const logPath = join(root, "runtime.log");
  if (!existsSync(logPath)) writeFileSync(logPath, "Fixture runtime started\n");
  result = {
    runtime_state: "ready",
    process_running: true,
    healthy: true,
    ready: process.env.FIXTURE_READY !== "false",
    tunnel_id: option("--tunnel-id"),
    health_url: "http://127.0.0.1:12345",
    ui_url: "http://127.0.0.1:12345/ui",
    log_path: logPath,
    local: { log: { path: logPath } },
    already_running: saved?.process_running === true,
  };
  writeFileSync(path, JSON.stringify(result));
} else if (!saved) {
  console.error(`alias ${args[2]} is not known; run create or connect first`);
  process.exit(1);
} else if (args[1] === "stop") {
  result = {
    ...saved,
    runtime_state: "stopped",
    process_running: false,
    healthy: false,
    ready: false,
  };
  writeFileSync(path, JSON.stringify(result));
} else {
  const { log_path, ...status } = saved;
  result = status;
}
console.log(JSON.stringify(result));
