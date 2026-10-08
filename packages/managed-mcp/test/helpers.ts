import { copyFile, chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { sourcePaths, sourceFingerprint, type SourceSpec } from "../src/source.js";

export async function fakeInstallation(home: string, spec: SourceSpec, main = {}) {
  const paths = sourcePaths(home, spec);
  await mkdir(join(paths.runtime, ".venv", "bin"), { recursive: true });
  await copyFile(
    fileURLToPath(new URL("../../../test/fixtures/python-mcp.mjs", import.meta.url)),
    paths.python,
  );
  await chmod(paths.python, 0o700);
  const state = join(home, spec.app, ...(spec.bridge ? ["data"] : []));
  await mkdir(state, { recursive: true });
  await writeFile(join(state, "mcp-fixture.json"), JSON.stringify({ name: spec.app, ...main }));
  if (spec.bridge) {
    await copyFile(
      fileURLToPath(new URL("../../../test/fixtures/whatsapp-bridge.mjs", import.meta.url)),
      paths.bridge,
    );
    await chmod(paths.bridge, 0o700);
  }
  await writeFile(
    paths.receipt,
    JSON.stringify({ source: spec.directory, fingerprint: await sourceFingerprint(spec) }),
  );
  return paths;
}
export async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback address.");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
