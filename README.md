# apps-of-dots

Bring your apps to your OpenAI dot.

Self-hosted MCP integrations with a consistent command line. Secure MCP Tunnel connects supported
OpenAI clients to your local MCP without a public server.

[Discord guide](discord/README.md) · [Telegram guide](telegram/README.md) ·
[WhatsApp guide](whatsapp/README.md) · [Architecture](docs/architecture.md) ·
[Contributing](CONTRIBUTING.md)

English is the primary language of this project. Translation: [한국어](README.ko.md).

| Integration          | Location                                                                             | What it provides                                                        |
| -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Discord**          | [Built in](discord/)                                                                 | All **99 upstream MCP tools**, through Secure MCP Tunnel or local stdio |
| **Telegram**         | [Built in](telegram/)                                                                | All **139 upstream tools**, personal account via Telethon               |
| **WhatsApp**         | [Built in](whatsapp/)                                                                | All **17 upstream tools**, personal linked device via whatsmeow         |
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

## Telegram and WhatsApp

All three MCP implementations live in this repository: `discord/server`, `telegram/server`, and
`whatsapp/server` + `whatsapp/bridge`. No external MCP package or checkout is needed at runtime.
Telegram/WhatsApp setup installs locked libraries using `uv`; WhatsApp also needs Go 1.26+ and a C
compiler to build the local bridge. Python 3.12 is downloaded by `uv` when needed. Use a separate
tunnel ID for each app.

```sh
pnpm apps-of-dots telegram setup
pnpm apps-of-dots telegram login
pnpm apps-of-dots telegram start
pnpm apps-of-dots telegram status

pnpm apps-of-dots whatsapp setup
pnpm apps-of-dots whatsapp login
pnpm apps-of-dots whatsapp start
pnpm apps-of-dots whatsapp status
```

Telegram setup needs an API ID/hash from `my.telegram.org`. Each `login` displays a QR code in your
terminal; Telegram may also request its two-step password. Credentials and persistent sessions stay
in the private data directory. The tools act as your personal account. Follow the
[Telegram](telegram/README.md) and [WhatsApp](whatsapp/README.md) guides for setup and file access.

Both provide `status`, `stop`, `restart`, `logs`, `doctor`, `tools`, and local `mcp` commands.
WhatsApp supervises its Go bridge and Python MCP together. Optional transcription services/models
are not provisioned, and neither integration adds OpenAI MCP Events delivery.

For the standalone `apps-of-dots` command, run `pnpm link --global` after building. Its global bin
directory must be on your PATH; keep this checkout in place. There is no published npm release yet.

## Everyday commands

All apps use `setup → start → status`; Telegram and WhatsApp add QR `login` after setup. Common
command names, help order, setup summaries and startup hints are shared. Replace `discord` below
with `telegram` or `whatsapp` for the same operations.

```sh
pnpm apps-of-dots list
pnpm apps-of-dots discord tools
pnpm apps-of-dots discord doctor
pnpm apps-of-dots discord doctor --live
pnpm apps-of-dots discord logs --follow
pnpm apps-of-dots discord restart
pnpm apps-of-dots discord stop
```

`doctor` checks local setup. Use `doctor --live` for account checks with these prerequisites;
diagnostics never start or stop a tunnel for you:

| App      | Before `doctor --live`                                               |
| -------- | -------------------------------------------------------------------- |
| Discord  | Tunnel may be running or stopped; the bot token is checked directly. |
| Telegram | Run `telegram stop`; run `telegram start` again afterward.           |
| WhatsApp | Run `whatsapp start`; live checks use the running bridge.            |

`start` uses official tunnel-client background process management. Closing the terminal does not
stop it. **After a reboot, run `start` again**; this version does not install a login or boot
service. The host must remain online.

Setup, status, tools, and diagnostics offer `--json`. Use `--home <path>` or `APPS_OF_DOTS_HOME` for
an isolated installation. KakaoTalk and Recly remain external projects; this CLI does not change
their installations.

## Project status

This is the first implementation. macOS has local CLI and MCP contract coverage; CI is configured
for macOS and Linux on Node 24. Real account logins and app/tunnel/dot round trips require your
credentials and have not been verified in this checkout. Windows and automatic startup are follow-up
work.

```sh
pnpm test       # Build, real stdio tool parity, isolated lifecycle tests
pnpm test:servers # Build local Python/Go servers and verify all tool schemas (no login)
pnpm check      # Formatting and TypeScript
pnpm audit --prod
```

Built on [PaSympa/discord-mcp](https://github.com/PaSympa/discord-mcp), inspired by
[PR #151](https://github.com/PaSympa/discord-mcp/pull/151) and the
[KakaoTalk Bridge CLI](https://github.com/rokrokss/kakaotalk-bridge). See
[upstream provenance](discord/UPSTREAM.md) and [license notices](THIRD_PARTY_NOTICES.md).

The local Telegram implementation derives from
[chigwell/telegram-mcp](https://github.com/chigwell/telegram-mcp); WhatsApp derives from
[verygoodplugins/whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp). See
[Telegram](telegram/UPSTREAM.md) and [WhatsApp](whatsapp/UPSTREAM.md) source provenance.

MIT licensed, with imported Telegram source under Apache-2.0. An independent community project, not
an official product of OpenAI or the connected apps.
