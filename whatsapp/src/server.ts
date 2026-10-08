import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { stat } from "node:fs/promises";
import { privateDirectory, privateWrite } from "@apps-of-dots/runtime";
import {
  appDirectory,
  childEnvironment,
  requireConfig,
  readSecrets,
  sourcePaths,
  requireInstallation,
  ProcessScope,
  waitFor,
  withAppLock,
  type SourceSpec,
} from "@apps-of-dots/managed-mcp";

export const SOURCE: SourceSpec = {
  app: "whatsapp",
  directory: fileURLToPath(new URL("../", import.meta.url)),
  project: "server",
  bridge: "bridge",
};
export const TOOL_COUNT = 17;
export function stateDirectory(home: string): string {
  return join(appDirectory(home, "whatsapp"), "data");
}
export async function whatsappEnvironment(home: string): Promise<Record<string, string>> {
  const c = await requireConfig(home, "whatsapp");
  const secrets = await readSecrets(home, "whatsapp", c);
  const port = Number(c.settings.bridgePort);
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !secrets.bridgeToken ||
    secrets.bridgeToken.length < 32
  )
    throw new Error("Invalid WhatsApp settings. Run whatsapp setup.");
  return {
    ...childEnvironment(),
    WHATSAPP_BRIDGE_PORT: String(port),
    WHATSAPP_BRIDGE_TOKEN: secrets.bridgeToken,
    WHATSAPP_API_URL: `http://127.0.0.1:${port}/api`,
    WHATSAPP_MCP_TRANSPORT: "stdio",
    WHATSAPP_DB_PATH: join(stateDirectory(home), "store", "messages.db"),
    WHATSMEOW_DB_PATH: join(stateDirectory(home), "store", "whatsapp.db"),
    WEBHOOK_ENABLED: "false",
    WHATSAPP_DEVICE_NAME: "apps-of-dots WhatsApp",
    WHATSAPP_MEDIA_ROOTS: join(appDirectory(home, "whatsapp"), "files"),
  };
}
export async function preflight(home: string): Promise<void> {
  await whatsappEnvironment(home);
  try {
    if (!(await stat(join(stateDirectory(home), "store", "whatsapp.db"))).isFile())
      throw new Error();
    if (!(await stat(join(stateDirectory(home), "paired.json"))).isFile()) throw new Error();
  } catch {
    throw new Error("WhatsApp is not paired. Run apps-of-dots whatsapp login.");
  }
}
export async function bridgeHealth(env: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(`${env.WHATSAPP_API_URL}/health`, {
      headers: { Authorization: `Bearer ${env.WHATSAPP_BRIDGE_TOKEN}` },
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    });
    if (!response.ok) return false;
    return ((await response.json()) as { connected?: boolean }).connected === true;
  } catch {
    return false;
  }
}
async function requireFreePort(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `WhatsApp bridge port ${port} is in use. Stop the existing bridge or change --bridge-port in setup.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
async function serve(home: string, pairing: boolean): Promise<number> {
  await requireInstallation(home, SOURCE);
  const env = await whatsappEnvironment(home);
  await requireFreePort(Number(env.WHATSAPP_BRIDGE_PORT));
  for (const dir of [
    stateDirectory(home),
    join(stateDirectory(home), "store"),
    join(appDirectory(home, "whatsapp"), "files"),
  ])
    await privateDirectory(dir);
  const paths = sourcePaths(home, SOURCE);
  const scope = new ProcessScope();
  try {
    const bridge = scope.start(paths.bridge, [], { cwd: stateDirectory(home), env });
    await waitFor(() => bridgeHealth(env), bridge, scope.abort.signal, pairing ? 300_000 : 45_000);
    if (pairing) {
      await privateWrite(
        join(stateDirectory(home), "paired.json"),
        JSON.stringify({ paired: true }) + "\n",
      );
      console.log(
        "WhatsApp linked. Run apps-of-dots whatsapp start. History continues syncing in the background.",
      );
      return 0;
    }
    const mcp = scope.start(paths.python, [join(paths.project, "main.py")], {
      cwd: stateDirectory(home),
      env,
      protocol: true,
    });
    return await Promise.race([
      mcp.done,
      bridge.done.then(() => {
        console.error("WhatsApp bridge exited; closing MCP.");
        return 1;
      }),
    ]);
  } finally {
    await scope.close();
  }
}
export async function login(home: string): Promise<void> {
  process.umask(0o077);
  console.log("WhatsApp: Settings > Linked Devices > Link a Device. Scan the QR code below.");
  await serve(home, true);
}
export async function run(home: string): Promise<number> {
  process.umask(0o077);
  return withAppLock(home, "whatsapp", async () => {
    await preflight(home);
    return serve(home, false);
  });
}
export async function verifyAccount(home: string): Promise<string> {
  if (!(await bridgeHealth(await whatsappEnvironment(home))))
    throw new Error(
      "The running WhatsApp bridge is not connected. Start the tunnel, or run login again.",
    );
  return "Running bridge is authenticated and connected to WhatsApp.";
}
