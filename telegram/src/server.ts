import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";
import { privateDirectory, runCommand } from "@apps-of-dots/runtime";
import {
  appDirectory,
  childEnvironment,
  requireConfig,
  readSecrets,
  sourcePaths,
  requireInstallation,
  ProcessScope,
  withAppLock,
  type SourceSpec,
} from "@apps-of-dots/managed-mcp";

export const SOURCE: SourceSpec = {
  app: "telegram",
  directory: fileURLToPath(new URL("../server/", import.meta.url)),
  project: ".",
};
export const TOOL_COUNT = 139;
export const loginScript = fileURLToPath(new URL("../python/login.py", import.meta.url));
export function sessionPath(home: string): string {
  return join(appDirectory(home, "telegram"), "session", "account");
}

export async function telegramEnvironment(home: string): Promise<Record<string, string>> {
  const c = await requireConfig(home, "telegram");
  const secrets = await readSecrets(home, "telegram", c);
  if (
    !/^[1-9][0-9]*$/.test(c.settings.apiId ?? "") ||
    !/^[a-fA-F0-9]{32}$/.test(secrets.apiHash ?? "")
  )
    throw new Error("Invalid Telegram API credentials. Run telegram setup.");
  const directory = appDirectory(home, "telegram");
  return {
    ...childEnvironment(),
    TELEGRAM_API_ID: c.settings.apiId!,
    TELEGRAM_API_HASH: secrets.apiHash!,
    TELEGRAM_SESSION_NAME: sessionPath(home),
    TELEGRAM_EXPOSED_TOOLS: "all",
    MCP_TRANSPORT: "stdio",
    TELEGRAM_SESSION_LOCK: "exclusive",
    TELEGRAM_LOCK_GRACE_SECONDS: "0",
    TELEGRAM_ALLOWED_ROOTS: join(directory, "files"),
    TELEGRAM_SERVER_ROOTS_ONLY: "1",
    TELEGRAM_ALIASES_FILE: join(directory, "aliases.json"),
    TELEGRAM_DEVICE_MODEL: "apps-of-dots Telegram",
    TELEGRAM_LOG_FILE: join(directory, "mcp-errors.log"),
  };
}
async function prepareDirectories(home: string) {
  for (const directory of [
    appDirectory(home, "telegram"),
    join(appDirectory(home, "telegram"), "session"),
    join(appDirectory(home, "telegram"), "files"),
  ])
    await privateDirectory(directory);
}
export async function preflight(home: string): Promise<void> {
  await telegramEnvironment(home);
  try {
    if (!(await stat(sessionPath(home) + ".session")).isFile()) throw new Error();
  } catch {
    throw new Error("Telegram session is missing. Run apps-of-dots telegram login.");
  }
}
export async function login(home: string): Promise<void> {
  await prepareDirectories(home);
  const paths = sourcePaths(home, SOURCE);
  const scope = new ProcessScope();
  try {
    const child = scope.start(paths.python, [loginScript], {
      cwd: appDirectory(home, "telegram"),
      env: await telegramEnvironment(home),
      interactive: true,
    });
    if ((await child.done) !== 0)
      throw new Error("Telegram login did not complete. Retry apps-of-dots telegram login.");
    console.log("Telegram session saved. Run apps-of-dots telegram start.");
  } finally {
    await scope.close();
  }
}
export async function verifyAccount(home: string): Promise<string> {
  await preflight(home);
  return withAppLock(home, "telegram", async () => {
    await runCommand(
      sourcePaths(home, SOURCE).python,
      [loginScript, "--check"],
      await telegramEnvironment(home),
      30_000,
    );
    return "Telegram session authenticated (read-only identity check).";
  });
}
export async function run(home: string): Promise<number> {
  process.umask(0o077);
  return withAppLock(home, "telegram", async () => {
    await requireInstallation(home, SOURCE);
    await preflight(home);
    await prepareDirectories(home);
    const paths = sourcePaths(home, SOURCE);
    const scope = new ProcessScope();
    try {
      return await scope.start(paths.python, [join(paths.project, "main.py")], {
        cwd: appDirectory(home, "telegram"),
        env: await telegramEnvironment(home),
        protocol: true,
      }).done;
    } finally {
      await scope.close();
    }
  });
}
