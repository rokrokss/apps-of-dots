# Discord

Run the complete [Discord MCP](https://github.com/PaSympa/discord-mcp) through an OpenAI Secure MCP
Tunnel. This adapter pins `@pasympa/discord-mcp@2.2.0` and executes its public CLI unchanged.

**All 99 tools are always enabled.** There is no read-only preset or hidden toolset filter. Shell
values of `DISCORD_MCP_TOOLSETS` do not reduce the catalog. Discord permissions, server
capabilities, and role hierarchy still apply.

| Toolset          | Tools |
| ---------------- | ----: |
| Discovery        |     4 |
| Messages         |    20 |
| Channels         |     8 |
| Permissions      |     6 |
| Members          |    11 |
| Roles            |     9 |
| Moderation       |     1 |
| Screening        |     2 |
| Statistics       |     1 |
| Forums           |    10 |
| Webhooks         |     8 |
| Scheduled events |     7 |
| Invitations      |     5 |
| Direct messages  |     7 |

Inspect every tool name, description, and input schema without bot credentials:

```sh
pnpm apps-of-dots discord tools
pnpm apps-of-dots discord tools --json
```

There is no MCP Events subscription or push notification service. Discord scheduled-event tools are
ordinary MCP tools and are included.

## Setup

1. Create an application and bot in the
   [Discord Developer Portal](https://discord.com/developers/applications). Enable **Message
   Content** and **Server Members** privileged intents. Invite the bot with the permissions needed
   for the tools you use.
2. Install the official [tunnel-client](https://github.com/openai/tunnel-client). The
   managed-runtime interface was checked against version 0.0.14. On macOS, use
   `brew install openai/tools/tunnel-client`.
3. Create or reuse a tunnel in
   [OpenAI Platform](https://platform.openai.com/settings/organization/tunnels) and associate your
   ChatGPT workspace. Its runtime key needs tunnel **Read** and **Use** access; this CLI does not
   create tunnels or require an admin key.
4. Run `pnpm apps-of-dots discord setup`, then `pnpm apps-of-dots discord start`. Keys are collected
   through hidden prompts.
5. Wait for `status` to report readiness, then add the tunnel in ChatGPT Plugins with **No
   authentication**. Ask your dot to list servers/channels to verify the first real tool call.

The bot operates as a bot, not as your personal Discord account. Granting server permissions does
not bypass Discord's role hierarchy or server feature requirements. See the
[upstream tool guide](https://github.com/PaSympa/discord-mcp#readme).

### Non-interactive setup

Create private files containing one token/key each, then use file paths:

```sh
pnpm apps-of-dots discord setup \
  --tunnel-id tunnel_YOUR_ID \
  --bot-token-file /private/path/discord-token \
  --tunnel-key-file /private/path/tunnel-key \
  --json
```

Setup checks bot identity without sending messages. `--skip-validation` saves configuration offline
and reports that the bot was not checked. `--tunnel-client` selects an executable explicitly.
Re-running setup reuses saved values; pass new key files to rotate credentials. Stop the runtime
before changing settings.

By default the bot can access every guild it belongs to. Optionally restrict scope with
`--guilds 123456789012345678,234567890123456789`, or restore the default with `--guilds all`. This
preserves the upstream guild filter, including its restrictions on unscoped DM and webhook
operations, without hiding tool definitions.

### Operations

| Command         | Behavior                                                      |
| --------------- | ------------------------------------------------------------- |
| `start`         | Create/reuse the managed tunnel alias and inspect its health  |
| `stop`          | Stop that process; preserve configuration                     |
| `restart`       | Stop and relaunch using current configuration                 |
| `status --json` | Report process, health, readiness, and UI/log locations       |
| `logs --follow` | Follow recent logs with saved credential values redacted      |
| `doctor`        | Inspect configuration, all 99 tools, and local runtime state  |
| `doctor --live` | Also validate the bot token and run native tunnel diagnostics |
| `mcp`           | Run the same upstream MCP over stdio for a local client       |

The bot connects lazily on a tool call. Tunnel readiness does not prove Discord login or permission
to perform an action. A stopped runtime is valid configuration; `doctor` reports that state without
starting it.

`start` delegates to `tunnel-client runtimes connect`. It does not register a boot service. Run it
again after reboot. Avoid another active client on the same tunnel ID, including on a different
host.

### Local stdio client

After setup, a local MCP client can use this configuration. Replace the checkout path with your
actual absolute path. Use an absolute Node path if the client's PATH does not include Node.

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/apps-of-dots/dist/cli.js", "discord", "mcp"]
    }
  }
}
```

For another data directory, put `--home /absolute/private-data` before `discord`. MCP owns stdout;
operational messages go to stderr.

## Storage and connection boundary

Default data locations:

- macOS: `~/Library/Application Support/apps-of-dots`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/apps-of-dots`
- Override: `--home <path>` or `APPS_OF_DOTS_HOME`

Settings live in `discord/config.json`. Tokens live in a separate versioned secret directory.
Configuration commits only after both credential files exist. Directories use `0700` and files use
`0600`. These are local files, not encrypted keychain storage. The tunnel key is passed by file
reference, never as its value in command arguments. The stdio adapter loads the Discord token for
its child.

Native tunnel state is isolated inside this data directory. Anyone permitted to use this tunnel
shares the configured bot's tools; individual ChatGPT users do not get separate Discord identities.

## Troubleshooting

- **Tunnel not listed:** check workspace association and tunnel Read/Use access.
- **Running but not ready:** inspect `status`, `logs`, and `doctor --live`.
- **Intent failure:** enable both privileged intents and check the bot token.
- **Permission denied:** check bot permissions, channel overrides, role order, and any configured
  guild allowlist.
- **Changed settings:** stop, rerun setup, then start.
- **Updated source:** install from the lockfile, rebuild, and restart.
- **After reboot:** run `start`; no automatic startup service is installed.

[OpenAI tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) ·
[Upstream provenance](UPSTREAM.md)
