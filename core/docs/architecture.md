# Architecture

```mermaid
flowchart LR
    Dot[OpenAI dot] --> Cloud[OpenAI tunnel endpoint]
    Tunnel[Official tunnel-client] -->|Outbound HTTPS| Cloud
    Tunnel -->|Private stdio| Adapter[Discord credential adapter]
    Adapter -->|Private stdio| MCP[Local Discord server · 99 tools]
    MCP <-->|Bot API and Gateway| Discord[Discord]
    CLI[apps-of-dots CLI] -->|Configure and manage| Tunnel
```

One local Discord server process runs per managed tunnel. The stdio adapter loads private
configuration and forwards process streams and shutdown signals. It does not interpret or rewrite
tool calls. There is no Discord HTTP listener or MCP Events subsystem.

| Directory                    | Responsibility                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `core/src/`                  | CLI name, help, catalog, and command registration                               |
| `discord/`                   | Local TypeScript server, bot configuration, commands, contract tests            |
| `telegram/`                  | Local Python server, personal-account QR login, Telethon environment            |
| `whatsapp/`                  | Local Go bridge and Python server, pairing and supervision                      |
| `reddit/`                    | Local MCP over Discord channels; `reddit/devvit/` is the bridge app on Reddit   |
| `core/packages/managed-mcp/` | Local code/dependency preparation, private config, lifecycle CLI, child cleanup |
| `core/packages/runtime/`     | Private storage, quoting, official tunnel management                            |
| `kakaotalk/`, `recly/`       | Externally maintained integration references                                    |

The common runtime has no Discord dependency. It uses an app ID, data directory, executable command,
and tunnel/key references. The official client owns native supervision, process identity, profiles,
and logs. Our CLI checks status after launch; a PID alone does not mean ready.

Credential values stay out of argv and normal output. The tunnel key is a file reference; the
Discord token is injected into the local child environment. This prevents accidental disclosure in
CLI history, not access by the same OS user or administrators. Local credential files are not
encrypted.

The catalog is static. External entries do not create runtimes, impose a language, or install
third-party software. A new managed integration should bring an actual implementation and document
its capabilities.

## Managed personal messaging accounts

Telegram and WhatsApp each get their own tunnel alias, private runtime, credential generation and
persistent account directory. `setup` installs frozen Python dependencies and builds local Go code;
`login` performs interactive pairing outside the MCP channel. MCP source stays in this repository. A
source fingerprint detects stale installations. Runtime starts never install dependencies or prompt
for credentials.

Telegram runs the local Python entrypoint directly. WhatsApp runs a Go bridge from its persistent
data directory, waits for authenticated loopback health, then starts the Python MCP. A supervisor
forwards MCP bytes unchanged and cleans up children on failure, signals and stdin EOF. Only the
Python MCP owns stdout. Bridge output joins stderr and native tunnel logs.

The personal-account integrations use `core/packages/managed-mcp` for installation, configuration,
CLI lifecycle and process utilities. Their account-specific code remains in the top-level app
package. The common `core/packages/runtime` still owns native tunnel management and private storage
primitives.

Offline `tools` inspection imports the local FastMCP definitions with a temporary empty session and
skips account startup; it does not make live app calls. Normal serving always uses the real
entrypoint. `test:servers` compares all actual MCP schemas to the frozen original definitions.

## Reddit through a Devvit bridge

Reddit is the one integration whose app side does not run on this computer. Reddit's public Data API
is closing to new apps, so a Devvit app installed in the subreddit (`reddit/devvit/`) acts for the
agent, and the two sides exchange JSON messages in two private Discord channels
([protocol](../../reddit/PROTOCOL.md)).

```mermaid
flowchart LR
    Dot[OpenAI dot] --> Tunnel[tunnel-client]
    Tunnel -->|Private stdio| MCP[Reddit MCP · 7 tools]
    MCP -->|Requests| Outbox["#reddit-outbox"]
    Outbox -->|Polled every minute| Bridge[Devvit bridge on Reddit]
    Bridge -->|Status replies| Outbox
    Bridge <-->|Approve, post, read| Subreddit[Subreddit]
    Bridge -->|Webhook copies| Inbox["#reddit-inbox"]
    Inbox --> MCP
    MCP -.->|Draft and activity events| Callback[OpenAI event callback]
```

The local MCP runs in-process under the same managed tunnel lifecycle as Discord, keeps no Reddit
posts or comments, and reads Discord on each call. The same process answers MCP 2026-07-28 requests
next to the SDK's handshake, reads the outbox and the inbox every 30 seconds for finished drafts and
new posts and comments, and delivers `reddit.draft.finished` and `reddit.activity.created` to
subscribed dots as signed webhooks. Its subscriptions and event inbox are in `reddit/events.json`.
The bridge keeps request metadata, its read position and the copy index in the installation's Redis
on Reddit.
