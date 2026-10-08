# WhatsApp

Run the Python MCP in [`server/`](server/) and Go bridge in [`bridge/`](bridge/) through OpenAI
Secure MCP Tunnel. Both implementations are maintained here, based on verygoodplugins/whatsapp-mcp
v0.7.0. All **17 tools** remain exposed: contacts, chats, message search/context, text/media/voice
sending, reactions, read receipts, media viewing, and transcription. This connects your personal
WhatsApp as a linked device using whatsmeow/WhatsApp Web.

## Setup

Prerequisites: Node.js 24+, pnpm 10, [uv](https://docs.astral.sh/uv/getting-started/installation/),
**Go 1.26+ and a C compiler** (SQLite uses CGO), plus the official
[tunnel-client](https://github.com/openai/tunnel-client). `uv` installs Python 3.12 if needed. On
macOS, use `brew install uv go openai/tools/tunnel-client`; install Xcode Command Line Tools if a
compiler is missing. FFmpeg is optional for converting voice messages.

Create a separate WhatsApp tunnel in
[OpenAI Platform](https://platform.openai.com/settings/organization/tunnels) and associate your
ChatGPT workspace. Use its runtime key with tunnel Read/Use access. Build this repository, then run:

```sh
pnpm apps-of-dots whatsapp setup
pnpm apps-of-dots whatsapp login
pnpm apps-of-dots whatsapp start
pnpm apps-of-dots whatsapp status
```

`setup` saves the tunnel ID/key, installs locked Python dependencies for the local source, and
builds the local Go bridge. `login` displays a QR: open WhatsApp → Settings → Linked Devices → Link
a Device. The command finishes when the bridge is connected. Initial history may continue syncing
after `start`; being connected does not mean the entire history is available.

After `status` reports `ready: true`, add the tunnel in ChatGPT Plugins → Add custom MCP server →
Tunnel, with **No authentication**. Ask for recent WhatsApp chats to verify a real tool call.
Everyone permitted to use the tunnel shares the linked WhatsApp identity.

### Non-interactive provisioning

```sh
pnpm apps-of-dots whatsapp setup \
  --tunnel-id tunnel_YOUR_WHATSAPP_ID \
  --tunnel-key-file /private/path/tunnel-key \
  --bridge-port 8766 \
  --json
```

Login requires an interactive terminal. `--skip-install` saves settings offline; run
`whatsapp install` before login/start. `--bridge-port` selects an unused local port (default 8766,
range 1024–65535). Stop the tunnel before setup, install or login. Rerunning setup preserves the
paired device and message database. New key files rotate credentials without deleting account data.

## Lifecycle

```sh
pnpm apps-of-dots whatsapp tools --json
pnpm apps-of-dots whatsapp doctor
pnpm apps-of-dots whatsapp start
pnpm apps-of-dots whatsapp doctor --live # Requires the running bridge
pnpm apps-of-dots whatsapp logs --follow
pnpm apps-of-dots whatsapp restart
pnpm apps-of-dots whatsapp stop
```

One Node supervisor runs the Go bridge and Python MCP. It first waits for the authenticated loopback
bridge health endpoint to report a WhatsApp connection, then starts MCP. Only Python protocol output
reaches tunnel stdout; bridge diagnostics go to stderr. If either child exits, the supervisor stops
the other. SIGINT, SIGTERM and MCP stdin EOF shut down both process groups, with a bounded
force-kill fallback. A private owner lock prevents duplicate local account processes.

`status` describes the tunnel process. `doctor --live` additionally checks the **running bridge's**
account connection and native tunnel configuration. Ordinary `doctor` and `tools` inspect real local
schemas offline and do not contact WhatsApp. Session-file presence alone is not evidence of live
authentication.

`setup`, `install`, lifecycle commands, `tools`, and `doctor` support `--json`. A local MCP client
can use the same server over stdio:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["/absolute/apps-of-dots/dist/cli.js", "whatsapp", "mcp"]
    }
  }
}
```

Use one local MCP/tunnel owner at a time. The official tunnel client manages the background process;
run `start` again after reboot.

## Storage and capabilities

Under the common private data home (`--home` or `APPS_OF_DOTS_HOME`):

- `whatsapp/config.json`: tunnel configuration and bridge port.
- `whatsapp/secrets/<generation>/`: tunnel key and generated bridge bearer token.
- `whatsapp/data/store/`: paired device, SQLite message history and downloaded media.
- `whatsapp/files/`: allowed outgoing file root; put files to send here.
- `whatsapp/runtime/`: Python environment, compiled bridge and source fingerprint receipt.

Source stays in this repository's `whatsapp/server/` and `whatsapp/bridge/`. Setup never fetches
another MCP repository. After source/dependency changes, rerun `whatsapp install`.

The Go bridge always runs from `whatsapp/data`, so its CWD-relative `store/` stays separate from
code. Python receives explicit paths to the same databases. The bridge binds to `127.0.0.1`; its
generated token is injected privately into both children and never printed. Directories/files use
private permissions and an owner-only umask; local data is not encrypted.

Inherited webhook, account, HTTP transport, and unrelated API-key settings are cleared. Outgoing
webhook forwarding is disabled; this integration does not implement OpenAI MCP Events. All original
tool definitions are preserved, but optional voice transcription services/models are not
provisioned. FFmpeg must be available on PATH for voice conversion. The server may provide only part
of historical messages, depending on linked-device synchronization.

## Troubleshooting

- Missing runtime: run `whatsapp install`; interrupted downloads/builds can be resumed.
- Occupied port: stop the existing bridge, or rerun setup with another `--bridge-port`.
- Expired/unlinked session: stop the tunnel, run `whatsapp login`, then start again.
- Running tunnel but failed tools: check `logs`, then `doctor --live` for bridge connectivity.
- Compiler failure: verify Go 1.26+ and a working C toolchain.

`pnpm test` covers paired-state checks, private configuration, protocol forwarding, bridge health
gating, child failures, EOF and signal cleanup using offline fixtures. `pnpm test:servers` builds
the local sources and checks all 17 input schemas against the frozen original contract. Real
WhatsApp pairing and tunnel/dot access require your account and are not verified in this checkout.
The adapter supports macOS/Linux; Windows and automatic boot services are outside this version.

[Upstream pin and license](UPSTREAM.md) ·
[Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
