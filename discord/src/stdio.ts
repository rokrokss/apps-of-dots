import { join, resolve } from "node:path";
import { requireConfig, readSecrets } from "./config.js";
import { runUpstream } from "./upstream.js";

// This entrypoint is launched by tunnel-client. Only the upstream MCP owns stdout.
const home = process.argv[2];
try {
  if (!home) throw new Error("Missing apps-of-dots data directory.");
  const absoluteHome = resolve(home);
  const config = await requireConfig(absoluteHome);
  const secrets = await readSecrets(absoluteHome, config);
  process.exitCode = await runUpstream(
    secrets.bot,
    config.allowedGuilds,
    join(absoluteHome, "discord"),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
