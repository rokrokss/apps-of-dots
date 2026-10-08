import { spawn, type ChildProcess } from "node:child_process";
import { open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { privateDirectory } from "@apps-of-dots/runtime";
import { appDirectory } from "./config.js";

// The lock covers setup/install/login and the lifetime of a stdio supervisor.
export async function withAppLock<T>(
  home: string,
  app: string,
  work: () => Promise<T>,
): Promise<T> {
  await privateDirectory(home);
  await privateDirectory(appDirectory(home, app));
  const path = join(appDirectory(home, app), ".owner.lock");
  for (let attempt = 0; ; attempt++) {
    try {
      const file = await open(path, "wx", 0o600);
      await file.writeFile(String(process.pid));
      await file.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(path, "utf8").catch(() => ""));
      let alive = true;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
        }
      }
      if (alive || attempt > 0)
        throw new Error(
          `${app} is in use. Stop its tunnel/local MCP or finish login before changing it.`,
        );
      await rm(path, { force: true });
    }
  }
  try {
    return await work();
  } finally {
    await rm(path, { force: true });
  }
}

export interface RunningChild {
  child: ChildProcess;
  done: Promise<number>;
  exited: boolean;
}

export class ProcessScope {
  readonly abort = new AbortController();
  private children: RunningChild[] = [];
  private closing?: Promise<void>;
  private readonly interrupt = () => {
    void this.close();
  };
  constructor() {
    process.on("SIGINT", this.interrupt);
    process.on("SIGTERM", this.interrupt);
  }
  start(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; protocol?: boolean; interactive?: boolean },
  ): RunningChild {
    if (this.abort.signal.aborted) throw new Error("Operation interrupted.");
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: !options.interactive,
      // Only protocol stdout may reach tunnel-client. Bridge output goes to stderr.
      stdio: [
        options.protocol ? "pipe" : options.interactive ? "inherit" : "ignore",
        options.protocol ? "inherit" : "pipe",
        "inherit",
      ],
    });
    child.stdout?.pipe(process.stderr, { end: false });
    const running: RunningChild = { child, exited: false, done: Promise.resolve(1) };
    running.done = new Promise((resolve) => {
      child.once("error", (error) => {
        console.error(`Cannot launch child: ${error.message}`);
        running.exited = true;
        resolve(1);
      });
      child.once("exit", (code, signal) => {
        running.exited = true;
        resolve(code ?? (signal === "SIGINT" ? 130 : 143));
      });
    });
    if (options.protocol) {
      process.stdin.pipe(child.stdin!);
      child.stdin!.on("error", () => {
        /* Child exit owns the result; no EPIPE crash. */
      });
      const end = () => {
        void this.close();
      };
      // stdin EOF means the MCP host has gone away; it must not leave the bridge alive.
      process.stdin.once("end", end);
      void running.done.then(() => {
        process.stdin.off("end", end);
        process.stdin.unpipe(child.stdin!);
        process.stdin.pause();
      });
    }
    this.children.push(running);
    return running;
  }
  close(): Promise<void> {
    return (this.closing ??= this.shutdown());
  }
  private async shutdown(): Promise<void> {
    this.abort.abort();
    const kill = (signal: NodeJS.Signals) => {
      for (const { child, exited } of this.children) {
        if (!child.pid) continue;
        try {
          process.kill(-child.pid, signal);
        } catch {
          if (!exited) child.kill(signal);
        }
      }
    };
    kill("SIGTERM");
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(this.children.map((c) => c.done)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    kill("SIGKILL");
    await Promise.all(this.children.map((c) => c.done));
    process.off("SIGINT", this.interrupt);
    process.off("SIGTERM", this.interrupt);
  }
}

export async function waitFor(
  check: () => Promise<boolean>,
  child: RunningChild,
  signal: AbortSignal,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("Operation interrupted.");
    if (child.exited)
      throw new Error(`Server exited before it was ready (exit ${await child.done}).`);
    if (await check()) return;
    await delay(300, undefined, { signal });
  }
  throw new Error("Timed out waiting for account connection. Run login again and inspect logs.");
}
