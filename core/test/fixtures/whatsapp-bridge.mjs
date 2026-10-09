#!/usr/bin/env node
// Simulates the upstream Go bridge's authenticated loopback health contract.
import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.cwd(), "bridge-pid"), String(process.pid));
console.log("Bridge diagnostic on stdout (must never reach MCP stdout)");
console.error("Bridge diagnostic on stderr");
const settingsFile = join(process.cwd(), "bridge-fixture.json");
const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
if (settings.exitImmediately) process.exit(8);
const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.WHATSAPP_BRIDGE_TOKEN}`) {
    response.writeHead(401);
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ connected: true, status: "ok" }));
});
server.listen(Number(process.env.WHATSAPP_BRIDGE_PORT), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
