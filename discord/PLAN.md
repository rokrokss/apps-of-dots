# Discord implementation scope

Updated 2026-10-08 after the research plan and the user's scope correction.

## Accepted decisions

- The CLI is **`apps-of-dots`**, matching the repository.
- All **99 upstream tools** remain usable, including writes and administration.
- Discord does **not** need MCP Events. No webhook sender, subscription database, outbox, SDK v2
  migration, or gateway-event changes.
- KakaoTalk and Recly remain references to their existing repositories.

The implementation now lives in `discord/server`, following the request to maintain all three MCP
servers in this repository. Build the local workspace package and wrap private configuration and
official tunnel process management around it. Preserve the complete tools protocol.

## First implementation checkpoint

Workspace packages cover root CLI/catalog, the local Discord server, adapters, and common utilities.
Commands include setup, start/stop/restart, status, logs, diagnostics, complete tool discovery, and
local stdio access.

Use `tunnel-client runtimes` for supervision. The process survives terminal closure but must be
started again after reboot. No separate daemon or platform service layer is needed at this
checkpoint.

Validate the actual 99-tool stdio catalog against upstream, JSON-RPC passthrough, environment
isolation, private credentials, process lifecycle, and readiness. Automated tests use temporary
directories and fake credentials. A real Discord/tunnel/dot round trip remains a separate live
check.

Stop at runnable code, documentation, and validation. Publishing and boot services are later
checkpoints. Telegram and WhatsApp are now included as additional managed integrations.

## Research retained

- [PR #151](https://github.com/PaSympa/discord-mcp/pull/151) was open at
  `9f5204bdd5ec56ec070a049f44a68d87fa931caa`; it changes README, scripts, and tunnel configuration.
  Its source baseline passed 77 tests.
- Upstream provides 99 tools across 14 toolsets and is packaged as a CLI. See
  [UPSTREAM.md](UPSTREAM.md) for package provenance.
- [KakaoTalk Bridge](https://github.com/rokrokss/kakaotalk-bridge) at
  `68a5584c887cd7af7afc1c5ba66bbf0f890abc77` informed hidden-key input, repeatable setup, lifecycle
  commands, and diagnostics.
- Official tunnel-client v0.0.14 was inspected for runtime supervision, key-file references, command
  quoting, and JSON status. Status logs are at `local.log.path`; process existence and readiness are
  separate facts.
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) supports
  private stdio/HTTP connections. Public plugin-directory distribution requires a separate hosting
  model.

See [architecture](../docs/architecture.md) and [usage](README.md).
