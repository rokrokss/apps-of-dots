# Telegram

Run the Telegram implementation in [`server/`](server/) through the same private OpenAI Secure MCP
Tunnel lifecycle as Discord. Its source and dependency lockfile are maintained in this repository,
based on chigwell/telegram-mcp. All **139 tools** are exposed, including messages, groups, contacts,
files, account settings, and administration.

This uses your personal Telegram account through Telethon/MTProto. Telegram's account permissions
still apply. The upstream's event polling/waiting tools are included; this integration does not add
OpenAI MCP Events delivery.

## Setup

Prerequisites: Node.js 24+, pnpm 10, [uv](https://docs.astral.sh/uv/getting-started/installation/),
and the official [tunnel-client](https://github.com/openai/tunnel-client). `uv` installs Python 3.12
if needed. On macOS, `brew install uv openai/tools/tunnel-client` installs the two CLI
prerequisites.

1. Obtain an API ID and hash from [my.telegram.org](https://my.telegram.org) → API development
   tools.
2. Create a separate Telegram tunnel in
   [OpenAI Platform](https://platform.openai.com/settings/organization/tunnels), associate the
   intended ChatGPT workspace, and obtain its runtime key. Use a distinct tunnel ID for each app.
3. Build this repository, then run:

```sh
pnpm apps-of-dots telegram setup
pnpm apps-of-dots telegram login
pnpm apps-of-dots telegram start
pnpm apps-of-dots telegram status
```

`setup` prompts for the tunnel ID, hidden runtime key, API ID, and hidden API hash, then installs
locked dependencies for the local source. It does not sign in. `login` displays a QR in your
terminal: open Telegram → Settings → Devices → Link Desktop Device. Accounts with two-step
verification also prompt for the password. The password is not saved and session keys are never
printed.

After `status` reports `ready: true`, add the tunnel in ChatGPT Plugins → Add custom MCP server →
Tunnel, with **No authentication**. Ask for your Telegram chat list to verify a real tool call. The
tunnel authenticates access; everyone allowed to use it shares this Telegram account.

### Non-interactive provisioning

```sh
pnpm apps-of-dots telegram setup \
  --tunnel-id tunnel_YOUR_TELEGRAM_ID \
  --tunnel-key-file /private/path/tunnel-key \
  --api-id 12345678 \
  --api-hash-file /private/path/api-hash \
  --json
```

Login still requires an interactive terminal. `--skip-install` saves settings offline; run
`telegram install` before login or start. Rerunning setup reuses saved values and session files.
Pass new key files to rotate credentials. Stop the tunnel before setup, install or login.

## Operations

```sh
pnpm apps-of-dots telegram tools --json
pnpm apps-of-dots telegram doctor
pnpm apps-of-dots telegram logs --follow
pnpm apps-of-dots telegram restart
pnpm apps-of-dots telegram stop
pnpm apps-of-dots telegram doctor --live # Requires the tunnel/local MCP to be stopped
pnpm apps-of-dots telegram start         # Reconnect after the check
```

`tools` and ordinary `doctor` inspect the local tool schemas without connecting to Telegram.
`doctor` also checks local session/configuration files and the tunnel process. File presence does
not prove authorization. **With the tunnel stopped**, `doctor --live` makes a read-only Telegram
identity check and runs native tunnel configuration diagnostics. It refuses concurrent access to the
session. Normal startup connects and authenticates before the server opens MCP stdio.

`setup`, `install`, lifecycle commands, `tools`, and `doctor` support `--json`. `mcp` runs the same
implementation over local stdio:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/apps-of-dots/dist/cli.js", "telegram", "mcp"]
    }
  }
}
```

Keep only one local MCP/tunnel owner for this managed account. The adapter forwards protocol bytes,
signals, and EOF; it does not re-register or rewrite tool calls. The official tunnel client owns
background supervision. Run `start` again after a reboot.

## Storage and scope

Under the common private data home (`--home` or `APPS_OF_DOTS_HOME`):

- `telegram/config.json`: tunnel settings and API ID.
- `telegram/secrets/<generation>/`: API hash and tunnel key, owner-only files.
- `telegram/session/account.session`: private SQLite session, retained across restarts/upgrades.
- `telegram/files/`: the permitted root for upload/download tools. Put outgoing files here.
- `telegram/aliases.json`: contact aliases.
- `telegram/runtime/`: locked Python environment and source fingerprint receipt.
- `telegram/mcp-errors.log`: server diagnostics.

Source stays in this repository's `telegram/server/`. Setup never fetches another MCP repository or
the PyPI package named `telegram-mcp`. After source/dependency changes, rerun `telegram install`.

Directories are private and child processes use an owner-only umask. These files are not encrypted.
Inherited `TELEGRAM_*`, MCP transport settings, unrelated API keys, and `.env` files cannot silently
change the managed account or hide tools. Optional third-party transcription services/engines are
not provisioned by this adapter; their tools remain in the catalog and report unmet prerequisites.
The dedicated file root is enforced by the server, including for MCP client-supplied roots.

## Verification and limits

`pnpm test` exercises private configuration, CLI lifecycle, environment isolation, and the stdio
adapter with offline fixtures. `pnpm test:servers` builds the local sources and checks all 139 tool
names/input schemas against the frozen original contract without account login. A real Telegram
login and tunnel/dot round trip require your credentials and have not been verified in this
checkout. macOS and Linux are supported by the adapter/CI; Windows and boot services are outside
this version.

[Upstream pin and license](UPSTREAM.md) ·
[Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
