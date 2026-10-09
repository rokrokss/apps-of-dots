# Source provenance

The complete TypeScript implementation and its tests live in [`server/`](server/), built as the
local `@apps-of-dots/discord-server` workspace package. There is no external Discord MCP dependency.

| Item              | Imported baseline                                                                     |
| ----------------- | ------------------------------------------------------------------------------------- |
| Project           | [PaSympa/discord-mcp](https://github.com/PaSympa/discord-mcp)                         |
| Release           | `@pasympa/discord-mcp@2.2.0`                                                          |
| Published gitHead | `5d13fea701d567f1c67a4f21f75844db1f1acda4`                                            |
| Catalog           | 99 tools across 14 toolsets; frozen definitions in `core/test/contracts/discord.json` |
| License           | [MIT](server/LICENSE), copyright 2026 Léandre Moreau                                  |

Tool implementation and tests are retained. Local packaging uses a private workspace name and
version and a separate CommonJS build; the server reports that local version. Formatting follows
this repository. General libraries (discord.js, MCP SDK, dotenv and Zod) remain normal locked
dependencies. All toolsets are enabled and the wrapper forwards protocol bytes unchanged.

Token and optional guild scope are injected before startup; shell settings and `.env` loading cannot
silently reduce the catalog. There is no MCP Events subsystem.

For implementation or dependency updates, run `pnpm test`, `pnpm check`, and `pnpm audit --prod`.
Contract tests compare the local server and wrapper to the imported baseline. Update that baseline
only when deliberately changing the public tool contract. Verify a real tunnel in a test guild
before publishing a release.

Copyright and permission text: [third-party notices](../THIRD_PARTY_NOTICES.md).
