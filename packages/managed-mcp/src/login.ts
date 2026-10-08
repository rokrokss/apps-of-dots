import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import type { RunningChild } from "./process.js";

export type LoginEvent =
  | { type: "qr"; code: string; expiresAt: number }
  | { type: "password"; requestId: string; retry?: boolean }
  | { type: "expired" | "scanned" | "authenticated" };
export interface WebLoginOptions {
  signal: AbortSignal;
  event: (event: LoginEvent) => void;
  input: (send: (requestId: string, password: string) => Promise<void>) => void;
}

// QR payloads have their own pipe. Normal stdout/stderr are never parsed or logged.
export function loginProcess(
  options: WebLoginOptions & {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
) {
  options.signal.throwIfAborted();
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...options.env, APPS_OF_DOTS_LOGIN_EVENTS: "3" },
    detached: true,
    stdio: ["pipe", "ignore", "ignore", "pipe"],
  });
  let closing: Promise<void> | undefined;
  let invalid = false;
  let pending = "";
  const decoder = new StringDecoder("utf8");
  const running: RunningChild = { child, exited: false, done: Promise.resolve(1) };
  running.done = new Promise<number>((resolve) => {
    child.once("error", () => {
      running.exited = true;
      resolve(1);
    });
    child.once("close", (code) => {
      running.exited = true;
      resolve(invalid ? 1 : (code ?? 1));
    });
  });
  const kill = (signal: NodeJS.Signals) => {
    if (running.exited || !child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const close = () =>
    (closing ??= (async () => {
      kill("SIGTERM");
      const timer = setTimeout(() => kill("SIGKILL"), 2000);
      await running.done;
      clearTimeout(timer);
    })());
  const abort = () => {
    void close();
  };
  options.signal.addEventListener("abort", abort, { once: true });
  void running.done.then(() => options.signal.removeEventListener("abort", abort));
  const fail = () => {
    invalid = true;
    void close();
  };
  (child.stdio[3] as Readable).on("data", (data: Buffer) => {
    pending += decoder.write(data);
    if (pending.length > 32 * 1024) {
      fail();
      return;
    }
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const event = JSON.parse(line) as LoginEvent;
        if (
          event.type === "qr" &&
          typeof event.code === "string" &&
          event.code.length > 0 &&
          event.code.length <= 8192 &&
          Number.isFinite(event.expiresAt)
        )
          options.event({ type: "qr", code: event.code, expiresAt: event.expiresAt });
        else if (
          event.type === "password" &&
          typeof event.requestId === "string" &&
          /^[a-zA-Z0-9_-]{1,80}$/.test(event.requestId)
        )
          options.event({
            type: "password",
            requestId: event.requestId,
            retry: event.retry === true,
          });
        else if (["scanned", "expired", "authenticated"].includes(event.type))
          options.event({ type: event.type } as LoginEvent);
        else fail();
      } catch {
        fail();
      }
    }
  });
  child.stdin!.on("error", () => {
    /* Exit/cancellation owns the failure. */
  });
  options.input(
    (requestId, password) =>
      new Promise<void>((resolve, reject) => {
        if (running.exited || options.signal.aborted) {
          reject(new Error("Login ended."));
          return;
        }
        child.stdin!.write(JSON.stringify({ requestId, password }) + "\n", (error) =>
          error ? reject(new Error("Login ended.")) : resolve(),
        );
      }),
  );
  if (options.signal.aborted) abort();
  return { running, close };
}
