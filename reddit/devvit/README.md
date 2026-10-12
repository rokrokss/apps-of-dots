# Reddit Devvit probe

A throwaway Devvit app that answers three questions before the Discord ↔ Reddit bridge gets built:

1. Can a Devvit app `fetch` `discord.com` in playtest and as a private upload, without app review?
2. Does the bot token return message `content` (Discord's Message Content intent)?
3. Can the app account `submitPost` in a subreddit you moderate?

It adds one moderator-only subreddit menu action, **Bridge probe: post latest Discord draft**. The
action reads the newest message in one Discord channel, parses it as
`{"title": "...", "text": "..."}`, and posts it to the subreddit as the app account. The toast names
the step that failed.

This is not the bridge. It reads only the newest message (`limit=1`); the real bridge must page with
an `after=` cursor, or messages that arrive between polls are lost. It has no scheduler, Redis,
approval step or Discord status reply. The app runs on Reddit's servers, not on your computer, so it
has no tunnel or CLI command in apps-of-dots.

## What you need

- The repository installed (`pnpm install --frozen-lockfile` at the root)
- A Reddit account
- A Discord server where you can add a bot and create a private channel

The first `devvit upload` creates a private playtest subreddit with you as moderator and the app
installed, so you do not need to create a subreddit.

## Steps

Run the `devvit` commands from this directory (`reddit/devvit`).

1. **Create a separate Discord bot** for this app at <https://discord.com/developers/applications>
   (**New Application**). Do not reuse the apps-of-dots Discord bot; its token would end up in
   Reddit's secret store. On the **Bot** page:
   - **Reset Token** and keep the token for step 7. Discord shows it once.
   - Turn on **Message Content Intent** and save.
   - Turn off **Public Bot**, so only you can add it to servers.
2. **Invite it.** On **OAuth2 → URL Generator**, select the `bot` scope and the **View Channels**
   and **Read Message History** permissions. Open the generated URL and pick your server.
3. **Make a private channel** (for example `#reddit-outbox`) and add the bot to it. In Discord, turn
   on **Settings → Advanced → Developer Mode**, then right-click the channel and **Copy Channel
   ID**. Right-click your own name and **Copy User ID** too.
4. **Log in and upload.** `login` opens a browser to authorize the CLI. The first `upload` asks you
   to finish a Reddit developer account and to name the app in the browser, then creates the app
   (private, visible only to you) and a private playtest subreddit named `<app-name>_dev`. The name
   becomes the app account's username and cannot be changed; the CLI writes it to `devvit.json`.
   Note whether `upload` asks for a Terms and Privacy Policy link or a review; that is part of the
   answer to question 1.

   ```sh
   pnpm exec devvit login
   pnpm exec devvit upload
   ```

5. **Undo the first upload's project setup.** The CLI treats this directory as a new standalone
   project: it runs `git init`, installs with npm (`package-lock.json`), creates an empty `.env`,
   and rewrites `package.json`. Remove those and restore the workspace install from the repository
   root:

   ```sh
   rm -rf .git package-lock.json .env
   git checkout -- package.json
   cd ../.. && pnpm install --frozen-lockfile && cd reddit/devvit
   ```

6. **Start playtest.** It prints the playtest subreddit link and streams logs; keep it running:

   ```sh
   pnpm exec devvit playtest
   ```

7. In another terminal, **store the bot token**. Secrets can only be set after the app has an
   installation, so step 4 comes first. Paste the token at the prompt:

   ```sh
   pnpm exec devvit settings set discordBotToken
   ```

   The prompt echoes the token. Clear the terminal afterwards, and reset the token in Discord if the
   scrollback was shared or recorded.

8. **Configure the installation** at
   `https://developers.reddit.com/r/<playtest_subreddit>/apps/<app-name>`. Set **Discord channel ID
   to read drafts from** to the channel ID, and **Only accept drafts from this Discord user ID** to
   your user ID. Save.
9. **Post a draft** in the Discord channel as yourself:

   ```json
   { "title": "Bridge probe test", "text": "Posted from Discord by a Devvit app." }
   ```

10. **Run the probe.** Open the playtest subreddit, open its three-dot menu, and choose **Bridge
    probe: post latest Discord draft**. Read the toast, then check that a post by the app account
    appeared.
11. **Repeat with the uploaded build.** Stop playtest with Ctrl+C, reinstall the uploaded version,
    post a new draft, and run the probe again:

    ```sh
    pnpm exec devvit install <playtest_subreddit>
    pnpm exec devvit logs <playtest_subreddit>
    ```

## Reading the result

| Toast                                   | Answer                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3/3 posted as the app account: <url>`  | All three questions are yes for this mode (playtest or upload)                                                                                                                                                                                                                         |
| `1/3 Discord fetch: HTTP 401`           | Wrong bot token                                                                                                                                                                                                                                                                        |
| `1/3 Discord fetch: HTTP 403`           | The bot cannot see the channel; check its channel permissions                                                                                                                                                                                                                          |
| `1/3 Discord fetch: …` (other)          | The app could not reach `discord.com` in this mode. Domain requests are reviewed when you playtest or upload, usually within 1–2 business days, so check whether `discord.com` shows as approved at `https://developers.reddit.com/apps/<app-name>/developer-settings` and retry first |
| `2/3 parse: message content is empty …` | Message Content intent is off for this bot                                                                                                                                                                                                                                             |
| `2/3 parse: …` (other)                  | The newest message is not a valid draft                                                                                                                                                                                                                                                |
| `3/3 submitPost: …`                     | Posting as the app account failed; the error says why                                                                                                                                                                                                                                  |

Playtest streams logs; after an upload, run `pnpm exec devvit logs your_test_subreddit`.

## Development

`pnpm build`, `pnpm typecheck` and `pnpm test` at the repository root include this package. The unit
tests cover draft parsing only; the menu handler runs only inside Devvit. Devvit tooling is a dev
dependency because the server is bundled into `dist/server/index.cjs` before upload.
