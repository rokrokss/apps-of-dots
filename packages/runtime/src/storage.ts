import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function dataHome(override?: string): string {
  if (override || process.env.APPS_OF_DOTS_HOME) {
    return resolve(override || process.env.APPS_OF_DOTS_HOME!);
  }
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "apps-of-dots");
}

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function privateWrite(path: string, value: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, value, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function validateSecret(value: string, label: string): string {
  const secret = value.trim();
  if (!secret || /[\s\x00-\x1f\x7f]/.test(secret)) {
    throw new Error(`${label} must be one non-empty line.`);
  }
  return secret;
}

export function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter(Boolean)
    .reduce((result, secret) => result.split(secret).join("[redacted]"), text);
}

export async function executable(command: string): Promise<string> {
  const candidates =
    isAbsolute(command) || command.includes("/")
      ? [resolve(command)]
      : (process.env.PATH ?? "")
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, command));
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* Try the next PATH entry. */
    }
  }
  throw new Error(`Cannot find ${command}. Install tunnel-client and run setup again.`);
}
