# Reddit

Seven tools that let your dot post, reply and follow activity in **one subreddit you moderate**.
Reddit's Data API is closing to new apps, so nothing here calls Reddit directly: a Devvit app you
install in the subreddit does the Reddit side, and the two sides talk through two private Discord
channels.

```text
dot → tunnel → apps-of-dots reddit MCP → #reddit-outbox → Devvit bridge (polls every minute) → Reddit
dot ← tunnel ← apps-of-dots reddit MCP ← #reddit-inbox  ← Devvit bridge (webhook)            ← Reddit
```

- [`devvit/`](devvit/) is the bridge, a Devvit app that runs on Reddit's servers.
- [`PROTOCOL.md`](PROTOCOL.md) is the message format both sides share.
- This package is the MCP server and its `apps-of-dots reddit` commands.

Posts and replies are made by the bridge's **app account**, labeled as an app by Reddit, and only in
the subreddit where it is installed. By default a moderator approves each one in Reddit; see the
bridge's [approval modes](devvit/README.md#approval). The
[setup center](../README.md#local-setup-center) (`pnpm apps-of-dots ui`) walks through the same
steps as the CLI below.

## Tools

| Tool                        | What it does                                                               |
| --------------------------- | -------------------------------------------------------------------------- |
| `reddit_submit_post`        | Sends a text post request (title up to 300, text up to 6,000 characters)   |
| `reddit_reply`              | Sends a comment or reply request for a `t3_` post or `t1_` comment         |
| `reddit_get_draft`          | Reports a request's state: sent, queued, posted (with URL), rejected, …    |
| `reddit_list_drafts`        | Lists recent requests and their states                                     |
| `reddit_list_activity`      | Lists new posts and comments in the subreddit, oldest first, with a cursor |
| `reddit_get_pending_events` | Lists unacknowledged `reddit.draft.finished` events, oldest first          |
| `reddit_acknowledge_events` | Marks events finished so they are not returned again                       |

Requests return at once; the bridge picks them up within a minute. Every read goes to Discord and no
posts or comments are stored on your computer, so content the bridge deletes (after a Reddit
deletion or after 30 days) is gone here too. Status replies are trusted only from the bridge bot,
and activity only from the inbox webhook.

## MCP Events

The tunnel's server also speaks MCP 2026-07-28 and publishes one
[OpenAI MCP Event](https://developers.openai.com/plugins/build/mcp-events), `reddit.draft.finished`,
when a draft is posted, rejected, failed or expired. A dot that subscribes is woken when the bridge
finishes a draft instead of checking `reddit_get_draft`.

- While the tunnel runs, the server reads the outbox every 30 seconds. Its first read only records
  drafts that are already finished, so a new subscription does not replay history.
- A dot's run may receive the event without its data, so the server's instructions tell the agent to
  call `reddit_get_pending_events`, act on each event, then call `reddit_acknowledge_events`.
  Unacknowledged events are kept for 30 days and acknowledged ones for 7.
- Deliveries are Standard Webhooks signed with the subscription's secret, sent only to
  `https://connectors.api.openai.com` without following redirects, and retried with backoff for up
  to a day. A `410` answer ends the subscription.
- Subscriptions, the event inbox (draft refs, states, titles, links and rejection notes), the
  delivery queue and the finished drafts already seen are kept in `reddit/events.json` in the
  private data directory, readable only by you.
- Local `reddit mcp` clients do not get events; the two event tools tell them so.

## Setup

1. **Install the bridge** in your subreddit and create the two channels by following
   [`devvit/README.md`](devvit/README.md).
2. **Choose the agent bot**, the Discord bot this MCP uses. It can be the same bot as the
   [Discord integration](../discord/README.md). Give it **View Channel**, **Read Message History**
   and **Send Messages** in the outbox, and **View Channel** and **Read Message History** in the
   inbox.
3. Install the official [tunnel-client](https://github.com/openai/tunnel-client) and create or reuse
   a tunnel, as for [Discord](../discord/README.md#setup). Each app needs its own tunnel.
4. **Configure.** Copy the channel IDs and the bridge bot's user ID with Discord's Developer Mode,
   then run setup; keys are collected through hidden prompts:

   ```sh
   pnpm apps-of-dots reddit setup --outbox-channel <id> --inbox-channel <id> --bridge-bot <id>
   ```

   Setup checks that the bot token works and that the bot can read both channels, then prints the
   agent bot's user ID.

5. **Point the bridge at the agent.** In the bridge's install settings in Reddit, set **Agent bot
   user ID** to that ID. The bridge ignores requests from anyone else.
6. **Start** with `pnpm apps-of-dots reddit start`, wait for `status` to report readiness, and add
   the tunnel in ChatGPT Plugins with **No authentication**. Ask your dot to list recent subreddit
   activity to verify the first real tool call.

For non-interactive setup, pass `--tunnel-id`, `--tunnel-key-file` and `--bot-token-file` as well,
and `--json` for machine-readable output. `--skip-validation` saves without contacting Discord.

## Operations

`setup`, `start`, `stop`, `restart`, `status`, `logs`, `doctor` (`--live` checks the bot and both
channels), `tools` and `mcp` (local stdio) work as they do for Discord. Stop the tunnel before
running setup again.

## Limits

- One subreddit: the one where the bridge is installed.
- Text posts and replies only; no links, media, flair, edits or deletions of the app's posts.
- No on-demand Reddit reads or search; activity starts when the bridge is installed.
- Text over 6,000 characters is refused when sending and cut (with `truncated: true`) in activity.
- Drafts are found among the last 300 outbox messages.
- The only event is a finished draft; read new subreddit activity with `reddit_list_activity`.
