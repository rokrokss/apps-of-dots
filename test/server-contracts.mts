// Build local source with locked dependencies; never log into real accounts.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  inspectCatalog,
  installSource,
  sourcePaths,
  childEnvironment,
} from "../packages/managed-mcp/src/index.js";
import { SOURCE as telegram, TOOL_COUNT as telegramCount } from "../telegram/src/server.js";
import { SOURCE as whatsapp, TOOL_COUNT as whatsappCount } from "../whatsapp/src/server.js";

const home = await mkdtemp(join(tmpdir(), "apps-of-dots-contracts-"));
const exec = promisify(execFile);
try {
  for (const [source, expected, names] of [
    [telegram, telegramCount, ["send_message", "delete_messages_bulk", "list_chats"]],
    [whatsapp, whatsappCount, ["send_message", "send_file", "transcribe_audio"]],
  ] as const) {
    await installSource(home, source);
    const tools = await inspectCatalog(home, source);
    assert.equal(tools.length, expected);
    for (const name of names)
      assert.ok(
        tools.some((tool) => tool.name === name),
        `Missing ${name}`,
      );
    // Compare protocol metadata to FastMCP's own definitions, including every input schema.
    const paths = sourcePaths(home, source);
    const code =
      "import asyncio,json,sys; sys.path.insert(0,sys.argv[1]); import main; print(json.dumps([t.model_dump(by_alias=True,exclude_none=True) for t in asyncio.run(main.mcp.list_tools())]))";
    const { stdout } = await exec(paths.python, ["-c", code, paths.project], {
      cwd: home,
      env: {
        ...childEnvironment(),
        TELEGRAM_API_ID: "1",
        TELEGRAM_API_HASH: "0".repeat(32),
        TELEGRAM_SESSION_NAME: join(home, "catalog-session"),
        TELEGRAM_LOG_FILE: join(home, "errors.log"),
        TELEGRAM_EXPOSED_TOOLS: "all",
      },
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const raw = JSON.parse(stdout) as {
      name: string;
      description?: string;
      inputSchema: unknown;
    }[];
    const normalize = (list: typeof raw) =>
      list
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
        .sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(normalize(tools), normalize(raw));
    const snapshot = JSON.parse(
      await readFile(new URL(`./contracts/${source.app}.json`, import.meta.url), "utf8"),
    );
    assert.deepEqual(normalize(tools), snapshot.tools);
    console.log(
      `${source.app}: ${tools.length} tools; frozen input-schema contract matches; local install/build passed`,
    );
    const env = {
      ...childEnvironment(),
      UV_NO_CONFIG: "1",
      UV_PROJECT_ENVIRONMENT: join(paths.runtime, ".venv"),
      TELEGRAM_API_ID: "12345",
      TELEGRAM_API_HASH: "0".repeat(32),
      TELEGRAM_SESSION_NAME: join(home, "unit-session"),
      TELEGRAM_LOG_FILE: join(home, "unit-errors.log"),
      CGO_ENABLED: "1",
      GOENV: "off",
      GOWORK: "off",
    };
    await exec(
      "uv",
      [
        "sync",
        "--frozen",
        "--python",
        "3.12",
        ...(source.app === "telegram" ? ["--group", "dev"] : ["--extra", "dev"]),
      ],
      { cwd: paths.project, env, timeout: 300_000 },
    );
    const unit = await exec(paths.python, ["-m", "pytest", "-q"], {
      cwd: paths.project,
      env,
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    console.log(`${source.app} Python: ${unit.stdout.trim().split("\n").at(-1)}`);
    if (source.app === "telegram") {
      const login = await exec(
        paths.python,
        ["-m", "unittest", "discover", "-s", "../python", "-p", "test_*.py"],
        { cwd: paths.project, env, timeout: 30_000 },
      );
      console.log(`telegram web login: ${login.stderr.trim().split("\n").at(-1)}`);
    }
    if (source.bridge) {
      const go = await exec("go", ["test", "-mod=readonly", "./..."], {
        cwd: join(paths.source, source.bridge),
        env,
        timeout: 300_000,
      });
      console.log(`whatsapp Go: ${go.stdout.trim()}`);
    }
  }
} finally {
  await rm(home, { recursive: true, force: true });
}
