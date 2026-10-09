# Contributing

Use Node.js 24+ and pnpm 10.28.2.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:servers
pnpm check
```

`pnpm dev --help` runs the CLI source against built workspace packages. Rebuild after editing shared
packages. Tests use temporary directories and fake keys; they never require a live Discord or OpenAI
account.

Telegram/WhatsApp contract checks additionally require uv, Go 1.26+ and a C compiler. They build the
in-repository sources with locked libraries in a temporary runtime, compare real FastMCP schemas to
the frozen original contracts, and remove the runtime afterward. They never sign in or require
account credentials. Source attribution and licenses must stay with the local servers. `pnpm test`
includes the local Discord server's unit tests. `pnpm test:servers` also runs both Python test
suites and the Go bridge tests with their locked development dependencies.

## Language

English is the primary language for documentation, CLI help and messages, code comments, and release
notes. Update the English documentation first. Translations such as `README.ko.md` are
supplementary; keep them consistent with the English source when updating them.

## Add an integration

1. Put app-specific code and a README in a top-level directory, following `discord/`. Keep domain
   dependencies out of `core/packages/runtime/`.
2. Add its workspace in `pnpm-workspace.yaml`, register commands in `core/src/cli.ts`, and add
   metadata to `core/src/catalog.ts`.
3. Reuse common command names: `setup`, `start`, `stop`, `restart`, `status`, `logs`, and `doctor`.
   Provide JSON output for automation.
4. Test the real MCP boundary, private configuration, and recovery paths. Never contact live
   services in PR CI.
5. Document prerequisites, platform support, authentication, upstream provenance, and which
   tools/events exist.

For external projects, add a reference directory and catalog entry. Do not take over their
installations or move their code into this repository.

## Keep changes reviewable

Preserve upstream behavior and use small explicit modules. Dependency changes need tool-parity
checks and a production audit. Keep credentials, generated state, and real messages out of fixtures
and issue reports.

No packages are published automatically. Before claiming a release is ready, perform a clean-machine
installation and record a real Discord/tunnel/dot check.
