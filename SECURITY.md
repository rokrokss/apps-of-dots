# Security

Report vulnerabilities privately to the repository maintainer; use GitHub private vulnerability
reporting when available. Do not post tokens, keys, or private Discord content in public issues.

This also applies to Telegram sessions, WhatsApp linked-device databases, and message/media caches.

## Trust boundary

- All 99 tools are exposed, including writes and administration. The bot's permissions and role
  hierarchy remain authoritative.
- Tunnel users share the configured bot identity. There is no per-user Discord OAuth or workspace
  tenant isolation.
- Keys are owner-only files, not encrypted keychain entries. The same OS user and administrators can
  read them. Normal command output omits their values.
- The official tunnel client connects outbound. Do not publish its admin UI or enable raw HTTP
  logging with real credentials.
- `logs` redacts currently saved key values. Review operational data before sharing logs, and never
  share old rotated credentials either.
- Stopping the process or deleting source does not revoke credentials. Revoke tokens and keys at
  their providers when retiring an installation.

Use a dedicated bot with the permissions needed for the servers where it should act. See
[connection boundaries](discord/README.md#storage-and-connection-boundary).

## Local setup center

`apps-of-dots ui` binds only to IPv4 loopback. An unpredictable per-process token in the printed URL
fragment authorizes API reads and writes; the browser removes it from the URL and keeps it in tab
session storage for refreshes. Restarting the UI invalidates old links. Do not share the link or
forward/publish the listener. Host and Origin checks, bearer authentication, and a restrictive
content security policy protect the management API from other websites. No request bodies are
logged.

Discord tokens, tunnel keys, and Telegram API hashes go directly to the local service and owner-only
credential files. They are never returned in status, job results, or errors, and are not persisted
in browser storage. Public status exposes only configuration and tunnel health, not raw client
output or log paths. Telegram two-step passwords are sent through the active login child's stdin and
are not persisted, returned, or placed in arguments, environment variables, or browser storage. QR
payloads travel through a private child pipe and are kept only in memory. The API serves a QR image
only for the current authenticated login job and version; expiry, cancellation, or completion
invalidates it. Setup and login share the CLI's per-app session lock. Closing the UI server cancels
pending logins and terminates their child processes, while established MCP tunnels keep running.

## Personal messaging integrations

Telegram and WhatsApp operate as the configured personal account. Their tunnel is an account-level
capability; each caller with access shares that identity. Login is performed through the local setup
center or CLI, separately from the tunnel. Sessions and account state persist after stop and are
revoked through the provider's device/session settings, not by stopping this CLI.

MCP source is maintained in this repository; locked libraries and compiled bridges are installed
into private runtime directories. Child processes receive explicit account settings and a limited OS
environment, excluding unrelated credentials, alternate transports and webhook destinations. Files
to upload are confined to each app's `files/` directory. WhatsApp's bridge uses a generated bearer
token and a loopback listener; its raw stdout never reaches MCP stdout. Server logs and local
databases can still contain private conversation content.
