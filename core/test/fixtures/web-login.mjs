#!/usr/bin/env node
// Offline stand-in for the Python login process and the WhatsApp Go bridge.
// Uses the same private event pipe, password stdin and authenticated health API.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { join } from "node:path";

const telegram = Boolean(process.env.TELEGRAM_SESSION_NAME);
const emit = (event) => writeFileSync(3, JSON.stringify(event) + "\n");
const config = JSON.parse(readFileSync("login-fixture.json", "utf8"));
writeFileSync("login.pid", String(process.pid));
let version = 0;
let requestId;
let connected = false;
const qr = () =>
  emit({
    type: "qr",
    code: `private-fixture-qr-${++version}`,
    expiresAt: Date.now() + (config.expiresMs ?? 60000),
  });
const password = (retry = false) => {
  requestId = `challenge-${++version}`;
  emit({ type: "password", requestId, retry });
};
const approve = () => {
  if (telegram) {
    writeFileSync(process.env.TELEGRAM_SESSION_NAME + ".session", "fixture session", {
      mode: 0o600,
    });
    emit({ type: "authenticated" });
    process.exit(0);
  }
  writeFileSync(process.env.WHATSMEOW_DB_PATH, "fixture database", { mode: 0o600 });
  connected = true;
};
if (!telegram) {
  createServer((req, res) => {
    const authorized = req.headers.authorization === `Bearer ${process.env.WHATSAPP_BRIDGE_TOKEN}`;
    res.writeHead(authorized ? 200 : 401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ connected: authorized && connected }));
  }).listen(Number(process.env.WHATSAPP_BRIDGE_PORT), "127.0.0.1");
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const answer = JSON.parse(line);
  if (answer.requestId !== requestId) process.exit(1);
  if (answer.password === "fixture-two-step-secret") approve();
  else password(true);
});
qr();
let previous;
setInterval(() => {
  const path = join(process.cwd(), "login-action.json");
  if (!existsSync(path)) return;
  let action;
  try {
    action = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  if (action.id === previous) return;
  previous = action.id;
  if (action.type === "rotate") qr();
  if (action.type === "password") password();
  if (action.type === "scanned") emit({ type: "scanned" });
  if (action.type === "approve") approve();
  if (action.type === "fail") process.exit(1);
}, 25);
