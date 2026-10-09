import { randomUUID } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { rm } from "node:fs/promises";
import {
  privateDirectory,
  privateWrite,
  readOptional,
  validateSecret,
} from "@apps-of-dots/runtime";

export interface ManagedConfig {
  version: 1;
  tunnelId: string;
  tunnelClient: string;
  secretId: string;
  settings: Record<string, string>;
}

export function appDirectory(home: string, app: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(app)) throw new Error("Invalid app ID.");
  return join(home, app);
}

export function secretDirectory(home: string, app: string, config: ManagedConfig): string {
  return join(appDirectory(home, app), "secrets", config.secretId);
}

export async function loadConfig(home: string, app: string): Promise<ManagedConfig | undefined> {
  const raw = await readOptional(join(appDirectory(home, app), "config.json"));
  if (raw === undefined) return;
  try {
    const c = JSON.parse(raw) as ManagedConfig;
    if (
      c.version !== 1 ||
      !/^tunnel_[a-zA-Z0-9_-]+$/.test(c.tunnelId) ||
      typeof c.tunnelClient !== "string" ||
      !isAbsolute(c.tunnelClient) ||
      typeof c.secretId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(c.secretId) ||
      !c.settings ||
      typeof c.settings !== "object" ||
      Array.isArray(c.settings) ||
      Object.values(c.settings).some((v) => typeof v !== "string")
    )
      throw new Error();
    return c;
  } catch {
    throw new Error(`Invalid ${app} configuration. Run apps-of-dots ${app} setup.`);
  }
}

export async function requireConfig(home: string, app: string): Promise<ManagedConfig> {
  const c = await loadConfig(home, app);
  if (!c) throw new Error(`Run apps-of-dots ${app} setup first.`);
  return c;
}

export async function readSecrets(
  home: string,
  app: string,
  c: ManagedConfig,
): Promise<Record<string, string>> {
  const raw = await readOptional(join(secretDirectory(home, app, c), "credentials.json"));
  if (!raw) throw new Error(`Missing ${app} credentials. Run apps-of-dots ${app} setup.`);
  const secrets: unknown = JSON.parse(raw);
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets))
    throw new Error("Invalid credentials file.");
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value !== "string") throw new Error("Invalid credentials file.");
    result[key] = validateSecret(value, key);
  }
  if (!result.tunnel) throw new Error("Missing tunnel key.");
  return result;
}

export async function saveConfig(
  home: string,
  app: string,
  settings: Omit<ManagedConfig, "version" | "secretId">,
  credentials: Record<string, string>,
): Promise<ManagedConfig> {
  const previous = await loadConfig(home, app);
  const secrets = Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => [key, validateSecret(value, key)]),
  );
  if (!secrets.tunnel) throw new Error("Missing tunnel key.");
  if (!/^tunnel_[a-zA-Z0-9_-]+$/.test(settings.tunnelId) || !isAbsolute(settings.tunnelClient))
    throw new Error("Invalid tunnel settings.");
  const c: ManagedConfig = { ...settings, version: 1, secretId: randomUUID() };
  const dir = secretDirectory(home, app, c);
  for (const path of [home, appDirectory(home, app), join(appDirectory(home, app), "secrets"), dir])
    await privateDirectory(path);
  try {
    await privateWrite(join(dir, "credentials.json"), JSON.stringify(secrets) + "\n");
    await privateWrite(join(dir, "tunnel-key"), secrets.tunnel + "\n");
    await privateWrite(
      join(appDirectory(home, app), "config.json"),
      JSON.stringify(c, null, 2) + "\n",
    );
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  if (previous) await rm(secretDirectory(home, app, previous), { recursive: true, force: true });
  return c;
}

// Children receive only OS/runtime basics, never unrelated account credentials or .env controls.
export function childEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      /^(PATH|HOME|USER|LOGNAME|TMPDIR|TMP|TEMP|LANG|LC_.*|TZ|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY)$/i.test(
        key,
      )
    )
      env[key] = value;
  }
  return { ...env, PYTHONUNBUFFERED: "1", PYTHON_DOTENV_DISABLED: "1" };
}
