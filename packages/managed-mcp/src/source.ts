import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { join } from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { executable, privateDirectory, privateWrite, readOptional } from "@apps-of-dots/runtime";
import { appDirectory, childEnvironment } from "./config.js";

const exec = promisify(execFile);
export interface SourceSpec {
  app: string;
  directory: string;
  project: string;
  bridge?: string;
}
export function sourcePaths(home: string, spec: SourceSpec) {
  const source = spec.directory;
  const project = join(source, spec.project);
  const runtime = join(appDirectory(home, spec.app), "runtime");
  return {
    source,
    project,
    runtime,
    python: join(runtime, ".venv", "bin", "python"),
    bridge: join(runtime, "bridge-bin"),
    receipt: join(runtime, "installed.json"),
  };
}

export async function sourceFingerprint(spec: SourceSpec): Promise<string> {
  const hash = createHash("sha256");
  async function visit(directory: string, relative = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        entry.name.startsWith(".") ||
        ["__pycache__", "node_modules", "dist"].includes(entry.name) ||
        entry.name.endsWith(".egg-info")
      )
        continue;
      const path = join(directory, entry.name);
      const name = join(relative, entry.name);
      if (entry.isDirectory()) await visit(path, name);
      else if (/\.(py|toml|lock|go|mod|sum)$/.test(entry.name)) {
        hash.update(name);
        hash.update("\0");
        hash.update(await readFile(path));
        hash.update("\0");
      }
    }
  }
  await visit(spec.directory);
  return hash.digest("hex");
}

export async function requireInstallation(home: string, spec: SourceSpec): Promise<void> {
  const paths = sourcePaths(home, spec);
  try {
    const receipt = JSON.parse((await readOptional(paths.receipt)) ?? "null");
    if (
      receipt?.source !== spec.directory ||
      receipt?.fingerprint !== (await sourceFingerprint(spec))
    )
      throw new Error();
    await access(paths.python, constants.X_OK);
    if (spec.bridge) await access(paths.bridge, constants.X_OK);
  } catch {
    throw new Error(
      `Local ${spec.app} runtime is not installed or its source changed. Run apps-of-dots ${spec.app} install.`,
    );
  }
}

export async function installSource(home: string, spec: SourceSpec): Promise<void> {
  if (process.platform === "win32")
    throw new Error("Managed integrations currently support macOS and Linux.");
  const paths = sourcePaths(home, spec);
  try {
    await requireInstallation(home, spec);
    return;
  } catch {
    /* Resume incomplete installation. */
  }
  console.error(
    `Preparing in-repository ${spec.app} code (Python 3.12${spec.bridge ? " and Go bridge" : ""})…`,
  );
  const uv = await executable("uv");
  const go = spec.bridge ? await executable("go") : undefined;
  const env = {
    ...childEnvironment(),
    UV_NO_CONFIG: "1",
    UV_PROJECT_ENVIRONMENT: join(paths.runtime, ".venv"),
    GOENV: "off",
    GOWORK: "off",
    CGO_ENABLED: "1",
  };
  const run = async (command: string, args: string[], cwd: string) => {
    try {
      return (
        await exec(command, args, { cwd, env, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 })
      ).stdout.trim();
    } catch (error) {
      throw new Error(
        `Installation failed: ${(error as Error & { stderr?: string }).stderr || (error as Error).message}`,
      );
    }
  };
  for (const dir of [home, appDirectory(home, spec.app), paths.runtime])
    await privateDirectory(dir);
  const fingerprint = await sourceFingerprint(spec);
  // Create the venv at its final path: Python console scripts contain absolute paths.
  await run(uv, ["sync", "--frozen", "--no-dev", "--python", "3.12"], paths.project);
  if (go && spec.bridge)
    await run(
      go,
      ["build", "-mod=readonly", "-o", paths.bridge, "."],
      join(paths.source, spec.bridge),
    );
  await privateWrite(
    paths.receipt,
    JSON.stringify({ source: spec.directory, fingerprint, python: "3.12" }) + "\n",
  );
  await requireInstallation(home, spec);
}
