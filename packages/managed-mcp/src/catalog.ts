import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { childEnvironment } from "./config.js";
import { requireInstallation, sourcePaths, type SourceSpec } from "./source.js";

// Import local definitions without running its account-login entrypoint. Only metadata
// is requested; dummy credentials and a disposable session prevent touching a real account.
export async function inspectCatalog(home: string, source: SourceSpec) {
  await requireInstallation(home, source);
  const paths = sourcePaths(home, source);
  const temporary = await mkdtemp(join(tmpdir(), "apps-of-dots-catalog-"));
  const client = new Client({ name: "apps-of-dots-inspector", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: paths.python,
    args: [
      "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); import main; main.mcp.run(transport='stdio')",
      paths.project,
    ],
    cwd: temporary,
    env: {
      ...childEnvironment(),
      TELEGRAM_API_ID: "1",
      TELEGRAM_API_HASH: "0".repeat(32),
      TELEGRAM_SESSION_NAME: join(temporary, "session"),
      TELEGRAM_EXPOSED_TOOLS: "all",
      TELEGRAM_ALIASES_FILE: join(temporary, "aliases.json"),
      TELEGRAM_LOG_FILE: join(temporary, "errors.log"),
      WHATSAPP_DB_PATH: join(temporary, "messages.db"),
      WHATSMEOW_DB_PATH: join(temporary, "whatsapp.db"),
      WHATSAPP_MCP_TRANSPORT: "stdio",
    },
    stderr: "pipe",
  });
  let errors = "";
  transport.stderr?.on("data", (chunk) => {
    errors = (errors + String(chunk)).slice(-4000);
  });
  try {
    await client.connect(transport, { timeout: 20_000 });
    const tools = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools(cursor ? { cursor } : {}, { timeout: 20_000 });
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  } catch (error) {
    throw new Error(
      `Cannot inspect local catalog: ${(error as Error).message}${errors ? `\n${errors}` : ""}`,
    );
  } finally {
    await client.close();
    await transport.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
