# apps-of-dots

Bring your apps to your OpenAI dot.

Self-hosted MCP integrations with a consistent command line. Secure MCP Tunnel connects supported
OpenAI clients to your local MCP without a public server.

[Discord guide](discord/README.md) · [Architecture](docs/architecture.md) ·
[Contributing](CONTRIBUTING.md)

English is the primary language of this project. Translation: [한국어](README.ko.md).

| Integration          | Location                                                                             | What it provides                                                        |
| -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Discord**          | [Built in](discord/)                                                                 | All **99 upstream MCP tools**, through Secure MCP Tunnel or local stdio |
| **KakaoTalk Bridge** | [External project](https://github.com/rokrokss/kakaotalk-bridge)                     | Follow its own installation and connection guide                        |
| **Recly Events**     | [External project](https://github.com/rokrokss/recly/blob/main/docs/recly-events.md) | Follow its own events setup guide                                       |

Discord includes messaging, channels, members, roles, moderation, forums, webhooks, scheduled-event
management, invitations, and DMs. It does **not** implement MCP Events. Discord scheduled-event
tools remain available.

## Start with Discord

You need Node.js 24+, pnpm 10, a Discord bot token, and an OpenAI tunnel ID with its runtime key.
Install the official [tunnel-client](https://github.com/openai/tunnel-client#install-with-homebrew)
first; on macOS, `brew install openai/tools/tunnel-client`.

```sh
git clone https://github.com/rokrokss/apps-of-dots.git
cd apps-of-dots
pnpm install --frozen-lockfile
pnpm build

pnpm apps-of-dots discord setup
pnpm apps-of-dots discord start
pnpm apps-of-dots discord status
```

Setup collects keys with hidden input. Enable **Message Content** and **Server Members** intents in
the Discord Developer Portal and invite the bot to your server. Every tool is exposed; Discord
permissions and role hierarchy determine which actions the bot can perform.

Once status reports `ready: true`, open ChatGPT Plugins → **Add custom MCP server** → **Tunnel**,
select your tunnel, and choose **No authentication**. The tunnel's access controls protect this
private connection. Associate the tunnel with your ChatGPT workspace so it appears in the picker.

Try: “List my Discord servers and the channels in this server.”

For the standalone `apps-of-dots` command, run `pnpm link --global` after building. Its global bin
directory must be on your PATH; keep this checkout in place. There is no published npm release yet.

## Everyday commands

```sh
pnpm apps-of-dots list
pnpm apps-of-dots discord tools
pnpm apps-of-dots discord doctor
pnpm apps-of-dots discord doctor --live
pnpm apps-of-dots discord logs --follow
pnpm apps-of-dots discord restart
pnpm apps-of-dots discord stop
```

`start` uses official tunnel-client background process management. Closing the terminal does not
stop it. **After a reboot, run `start` again**; this version does not install a login or boot
service. The host must remain online.

Setup, status, tools, and diagnostics offer `--json`. Use `--home <path>` or `APPS_OF_DOTS_HOME` for
an isolated installation. KakaoTalk and Recly remain external projects; this CLI does not change
their installations.

## Project status

This is the first implementation. macOS has local CLI and MCP contract coverage; CI is configured
for macOS and Linux on Node 24. A real Discord/tunnel/dot round trip requires your credentials and
has not been verified in this checkout. Windows support and automatic startup are follow-up work.

```sh
pnpm test       # Build, real stdio tool parity, isolated lifecycle tests
pnpm check      # Formatting and TypeScript
pnpm audit --prod
```

Built on [PaSympa/discord-mcp](https://github.com/PaSympa/discord-mcp), inspired by
[PR #151](https://github.com/PaSympa/discord-mcp/pull/151) and the
[KakaoTalk Bridge CLI](https://github.com/rokrokss/kakaotalk-bridge). See
[upstream provenance](discord/UPSTREAM.md) and [license notices](THIRD_PARTY_NOTICES.md).

MIT licensed. An independent community project, not an official OpenAI or Discord product.
