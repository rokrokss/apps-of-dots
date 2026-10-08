# Security

Report vulnerabilities privately to the repository maintainer; use GitHub private vulnerability
reporting when available. Do not post tokens, keys, or private Discord content in public issues.

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
