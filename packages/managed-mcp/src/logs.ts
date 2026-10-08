import { open, stat } from "node:fs/promises";
import { redact } from "@apps-of-dots/runtime";

export async function showLogs(path: string, secrets: string[], follow: boolean): Promise<void> {
  let offset: number | undefined;
  let partial = "";
  let discard = false;
  async function flush() {
    const size = (await stat(path)).size;
    if (offset !== undefined && size < offset) {
      offset = 0;
      partial = "";
      discard = false;
    }
    const start = offset ?? Math.max(0, size - 128 * 1024);
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(Math.min(size - start, 128 * 1024));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      let text = buffer.subarray(0, bytesRead).toString("utf8");
      if ((offset === undefined && start > 0) || discard) {
        const newline = text.indexOf("\n");
        discard = newline < 0;
        text = newline < 0 ? "" : text.slice(newline + 1);
      }
      offset = start + bytesRead;
      partial += text;
      const end = partial.lastIndexOf("\n");
      if (end >= 0) {
        process.stdout.write(redact(partial.slice(0, end + 1), secrets));
        partial = partial.slice(end + 1);
      }
      if (partial.length > 128 * 1024) {
        partial = "";
        discard = true;
      }
    } finally {
      await file.close();
    }
  }
  await flush();
  if (!follow) return;
  await new Promise<void>((resolve, reject) => {
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void flush()
        .catch((error) => {
          cleanup();
          reject(error);
        })
        .finally(() => {
          pending = false;
        });
    }, 500);
    const cleanup = () => {
      clearInterval(timer);
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}
