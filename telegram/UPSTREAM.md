# Source provenance

The full Python implementation and its tests are maintained in [`server/`](server/). Setup installs
libraries from its frozen `uv.lock`; it never clones or installs an external MCP.

| Item              | Imported baseline                                                         |
| ----------------- | ------------------------------------------------------------------------- |
| Project           | [chigwell/telegram-mcp](https://github.com/chigwell/telegram-mcp)         |
| Commit            | `87b38d3c453fbf6bb516259732296d5b6fcda376`                                |
| Original metadata | `telegram-mcp` 2.0.1                                                      |
| Runtime           | Python 3.12, `uv sync --frozen --no-dev`                                  |
| Catalog           | 139 tools, frozen definitions in `core/test/contracts/telegram.json`      |
| License           | [Apache-2.0](server/LICENSE); retained authors in `server/pyproject.toml` |

The original package metadata is retained for attribution and compatibility with its installation
guard. It identifies the local project, not a dependency on the unrelated PyPI `telegram-mcp`. All
tool modules, transport helpers and tests are included. The local change to
`server/telegram_mcp/runtime.py` adds `TELEGRAM_LOG_FILE` so diagnostics stay in the private data
home. `server/tests/test_runtime.py` checks the log override as well as the original default. Our
separate QR login helper writes a private Telethon SQLite session without printing its keys.

Offline metadata inspection imports local definitions and serves FastMCP without invoking account
startup. Normal `mcp` and tunnel execution run the local `main.py` with real authentication.

When changing the implementation, review the frozen tool contract and dependency locks, retain
license notices, and document source modifications here. Run `pnpm test`, `pnpm test:servers`,
`pnpm check`, and `pnpm audit --prod`. Users rerun `telegram install` after source changes; a
receipt fingerprint prevents silently running a stale environment. Session data stays outside the
code.
