import { copyFile, chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";

export async function fixture(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), "apps-of-dots test ' "));
  t.after(() => rm(home, { recursive: true, force: true }));
  const binary = join(home, "tunnel-client");
  await copyFile(fileURLToPath(new URL("./fixtures/tunnel-client.mjs", import.meta.url)), binary);
  await chmod(binary, 0o700);
  return { home, binary };
}
