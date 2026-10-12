# Reddit bridge (Devvit app)

The Devvit side of the Discord ↔ Reddit bridge in [`../PROTOCOL.md`](../PROTOCOL.md). Installed in
one subreddit you moderate, it:

- reads post and reply requests that an agent writes to a Discord outbox channel, once a minute;
- posts them **as the app account** after a moderator approves them (or automatically, within
  limits; see [Approval](#approval));
- answers each request with one status reply that it edits as the request moves on;
- copies new, visible posts and comments in the subreddit to a Discord inbox channel, and follows
  Reddit edits and deletions there.

It runs on Reddit's servers. Nothing in apps-of-dots needs to run for it to work, and it never
receives requests from the internet; it only calls `discord.com`.

## Approval

`approvalMode` is a per-subreddit setting that any moderator can change.

- **Manual (default).** Every valid request waits until a moderator opens **Review bridge drafts**
  in the subreddit's moderator menu, optionally edits the title and text, and approves or rejects
  it. The server checks that the user is a moderator.
- **Auto.** Valid requests are posted without review, at most `maxPostsPerDay` posts and comments in
  any 24 hours and `minMinutesBetweenPosts` apart (defaults 10 and 30). A post whose title matches
  one of the last 7 days is rejected.

Drafts not handled within 7 days expire. A request that Reddit refuses is reported as failed and
never retried, so it cannot be posted twice.

## Data handling

- Only posts and comments that are still visible when the bridge fetches them are copied; removed,
  deleted, spam and filtered items are skipped.
- An edit on Reddit updates the copy. A deletion or removal deletes it. Every copy is deleted 30
  days after it was sent.
- Mentions are disabled on everything the bridge sends to Discord.
- The bridge stores request metadata, its read position and the copy index in the installation's
  Redis. Request text is dropped once a request is finished.

## Setup

You need the apps-of-dots Discord bot (the **agent**) in a Discord server, and a moderator account
for the subreddit. The first `devvit upload` creates a private playtest subreddit,
`r/<app-name>_dev`, that you can use.

### Discord

1. **Create a separate bridge bot** at <https://discord.com/developers/applications>. Do not reuse
   the agent bot; the bridge bot's token is stored at Reddit. On **Bot**: **Reset Token** and keep
   it, turn on **Message Content Intent**, and turn off **Public Bot** (if Discord refuses, first
   set **Installation → Install Link** to **None**).
2. **Make two private channels**, for example `#reddit-outbox` and `#reddit-inbox`.
3. **Invite the bridge bot** with **OAuth2 → URL Generator**: scope `bot`, permissions **View
   Channels**, **Read Message History** and **Send Messages**. Give it access to the outbox only.
4. Give the **agent bot** access to both channels.
5. **Create the inbox webhook:** inbox channel → **Edit Channel → Integrations → Webhooks → New
   Webhook → Copy Webhook URL**.
6. Turn on **Settings → Advanced → Developer Mode**. Copy the outbox **channel ID** and the agent
   bot's **user ID** (right-click the bot).

### Devvit

Run these from this directory (`reddit/devvit`).

1. **Log in and upload.** The first upload asks you to set up a Reddit developer account and name
   the app; the name becomes the app account's username and cannot be changed.

   ```sh
   pnpm exec devvit login
   pnpm exec devvit upload
   ```

2. **Undo the first upload's project setup.** The CLI treats this directory as a new project: it
   runs `git init`, installs with npm (`package-lock.json`), creates an empty `.env`, and rewrites
   `package.json`. Remove those and restore the workspace install:

   ```sh
   rm -rf .git package-lock.json .env
   git checkout -- package.json
   cd ../.. && pnpm install --frozen-lockfile && cd reddit/devvit
   ```

3. **Store the secrets.** The prompt echoes what you paste, so clear the terminal afterwards:

   ```sh
   pnpm exec devvit settings set discordBotToken
   pnpm exec devvit settings set inboxWebhookUrl
   ```

4. **Configure the installation** at `https://developers.reddit.com/r/<subreddit>/apps/<app-name>`:
   **Outbox channel ID**, **Agent bot user ID**, and the approval settings.
5. **Install a new version** after code changes, either with a live playtest that streams logs or
   with an upload:

   ```sh
   pnpm exec devvit playtest <subreddit>
   pnpm exec devvit upload && pnpm exec devvit install <subreddit>
   ```

The first poll after installation records the newest outbox message and ignores everything before
it.

## Try it

From the agent bot (for example with the apps-of-dots Discord MCP's `discord_send_message`), write
to the outbox. To test by hand first, set **Agent bot user ID** to your own Discord user ID, type
the request yourself, and switch it back afterwards:

```json
{ "v": 1, "op": "post", "ref": "hello-1", "title": "Hello from the bridge", "text": "First post." }
```

Within a minute the bridge replies `{"v":1,"ref":"hello-1","status":"queued"}`. Open the subreddit's
three-dot menu → **Review bridge drafts**, approve it, and the reply changes to `posted` with the
post's URL. A post or comment in the subreddit then appears in the inbox channel.

Logs: `pnpm exec devvit logs <subreddit>`.

## Known limits

- If editing a status reply fails after a request is finished, that reply stays out of date; the
  request itself is not run again.
- A post that AutoModerator filters and a moderator approves later is not copied to the inbox,
  because the bridge only copies items that are visible when they are created.

## Development

`pnpm build`, `pnpm typecheck` and `pnpm test` at the repository root include this package. The
tests run the outbox, approval and inbox logic against in-memory Redis, Discord and Reddit fakes;
the Devvit wiring in `src/devvit.ts`, `src/review.ts` and `src/index.ts` runs only inside Devvit.
Devvit tooling is a dev dependency because the server is bundled into `dist/server/index.cjs` before
upload.
