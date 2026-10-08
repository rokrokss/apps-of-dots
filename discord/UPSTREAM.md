# Upstream provenance

| Item              | Pin                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Project           | [PaSympa/discord-mcp](https://github.com/PaSympa/discord-mcp)                                     |
| Package           | `@pasympa/discord-mcp@2.2.0`                                                                      |
| Published gitHead | `5d13fea701d567f1c67a4f21f75844db1f1acda4`                                                        |
| Reference PR      | [#151](https://github.com/PaSympa/discord-mcp/pull/151)                                           |
| PR head inspected | `9f5204bdd5ec56ec070a049f44a68d87fa931caa`                                                        |
| Integrity         | `sha512-8mq9avtWLZ0/T5i3fBI+9RohDmeOp3Twwq1itRGtWRW5znr48QTf7mtPxYjgEsc3HkmfrgYcAhuEF9wcZcLD1g==` |
| License           | MIT, copyright 2026 Léandre Moreau                                                                |

PR #151 adds documentation, npm commands, and tunnel configuration. Those files are not in the npm
tarball. This repository implements connection management around the released MCP; it does not claim
that the PR is merged.

No tool implementation is copied, patched, or re-registered. We resolve the package's public main
executable and run it as a child. All toolsets are enabled. Token and optional guild scope are
injected before startup; unrelated shell configuration and `.env` loading cannot silently reduce the
catalog.

The lockfile pins the complete dependency graph, with updated transitive dependencies. The PR's
older lockfile is not reused. The upstream SDK remains on its supported v1 dependency; an
Events-specific migration is unnecessary.

## Updating

1. Review upstream release notes and the public CLI contract.
2. Update the exact package pin and regenerate `pnpm-lock.yaml`.
3. Update `UPSTREAM_VERSION`, expected tool count, and documented toolsets if upstream deliberately
   changes them.
4. Run `pnpm test`, `pnpm check`, and `pnpm audit --prod`. Parity tests compare actual stdio
   definitions from the package and our wrapper.
5. Verify a real tunnel and representative reads/writes in a test guild before publishing a release.

Copyright and permission text: [third-party notices](../THIRD_PARTY_NOTICES.md).
