#!/usr/bin/env node
// Offline MCP protocol fixture; no credentials or live services are used.
import { createInterface } from "node:readline";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const settings = JSON.parse(readFileSync(join(process.cwd(), "mcp-fixture.json"), "utf8"));
writeFileSync(join(process.cwd(), "mcp-pid"), String(process.pid));
if (settings.exitImmediately) process.exit(9);
const send = (id, result) => console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
const tool = {
  name: "fixture_echo",
  description: "Protocol passthrough check",
  inputSchema: { type: "object", properties: { value: { type: "string" } } },
};
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    if (request.method === "initialize")
      send(request.id, {
        protocolVersion: request.params.protocolVersion,
        serverInfo: { name: settings.name, version: "1" },
        capabilities: { tools: {} },
      });
    else if (request.method === "tools/list") send(request.id, { tools: [tool] });
    else if (request.method === "tools/call")
      send(request.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              value: request.params.arguments.value,
              transport: process.env.MCP_TRANSPORT || process.env.WHATSAPP_MCP_TRANSPORT,
              toolMode: process.env.TELEGRAM_EXPOSED_TOOLS,
              webhook: process.env.WEBHOOK_ENABLED,
              leakedTunnelKey: process.env.CONTROL_PLANE_API_KEY,
              leakedOtherAccount: process.env.DISCORD_TOKEN,
            }),
          },
        ],
      });
    else if (request.method === "ping") send(request.id, {});
  })
  .on("close", () => process.exit(0));
