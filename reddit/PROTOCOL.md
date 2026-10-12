# Reddit bridge protocol (v1)

This is the contract between an agent (a dot, later through the apps-of-dots Reddit MCP) and the
bridge, a Devvit app installed in one subreddit the user moderates. Discord carries every message;
nothing calls into Reddit from outside, because Devvit External Endpoints are not available to this
project.

- **Outbox:** the agent asks the bridge to post or reply. The bridge answers on the same channel.
- **Inbox:** the bridge reports new posts and comments in the subreddit.

The bridge posts as its app account, labeled as an app by Reddit, and only in the subreddit where it
is installed.

## Actors and channels

| Actor         | Identity                                                 | Needs                                                                              |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Agent         | The apps-of-dots Discord bot                             | Outbox: View Channel, Read Message History, Send Messages. Inbox: the first two.   |
| Bridge        | A separate Discord bot whose token is stored in Devvit   | Outbox: View Channel, Read Message History, Send Messages. Message Content intent. |
| Inbox webhook | A Discord webhook on the inbox channel, stored in Devvit | Nothing else; it can edit and delete only its own messages                         |
| Moderator     | A human moderator of the subreddit                       | Approves drafts in Reddit's moderator menu                                         |

Use two private channels, for example `#reddit-outbox` and `#reddit-inbox`. The bridge bot never
needs the inbox, and the agent bot's token never leaves the user's computer. Each side trusts only
the other's user ID: the bridge reads requests from the agent's, and the agent reads statuses from
the bridge's.

## Message framing

Every protocol message is one Discord message whose `content` is a JSON object (no code fence, no
other text) with `"v": 1`. Long text is split across the message's embeds:

> **text** = the envelope's `text` (if any), followed by each embed's `description`, in order.

Discord allows 2,000 characters of `content`, 4,096 per embed description, 10 embeds and 6,000
characters across all embeds of one message. v1 therefore caps text at **6,000 characters**; the
bridge rejects longer requests with `too_long` and truncates longer inbox text (see below). A
receiver ignores fields it does not know.

## Requests (agent → bridge, outbox)

```json
{ "v": 1, "op": "post", "ref": "2026-10-12-welcome", "title": "Welcome", "text": "Hello..." }
{ "v": 1, "op": "reply", "ref": "reply-t1_abc", "parent": "t1_abc", "text": "Thanks!" }
```

| Field    | Ops   | Rule                                                                        |
| -------- | ----- | --------------------------------------------------------------------------- |
| `op`     | all   | `post` (text post) or `reply` (comment)                                     |
| `ref`    | all   | Idempotency key chosen by the agent: 1–64 characters of `A-Z a-z 0-9 . _ -` |
| `title`  | post  | 1–300 characters after trimming                                             |
| `parent` | reply | A post (`t3_…`) or comment (`t1_…`) in the bridge's subreddit               |
| `text`   | all   | Optional for `post`, required for `reply`; framing above                    |

The bridge reads only messages authored by the configured agent user ID and silently skips all
others, including its own replies. A `ref` it has seen before is never executed again: the bridge
replies to the repeated message with the original request's current status and keeps tracking only
the original. Retrying a failed request needs a new `ref`.

## Status (bridge → agent, outbox)

The bridge answers each request with **one reply** (`message_reference` to the request) that it
authors and then edits on every state change. Its `content`:

```json
{
  "v": 1,
  "ref": "2026-10-12-welcome",
  "status": "posted",
  "thing": "t3_abc123",
  "url": "https://www.reddit.com/r/example/comments/abc123/welcome/",
  "edited": false
}
```

| `status`   | Meaning                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `queued`   | Valid; waiting for a moderator (manual mode) or for the auto-mode limits          |
| `posted`   | Done; `thing` and `url` are set. `edited` is true if a moderator changed it       |
| `rejected` | Not posted; `reason` is set                                                       |
| `failed`   | Reddit refused the post or comment; `reason` is `reddit_error`, `detail` has text |
| `expired`  | Still `queued` 7 days after the request                                           |

`reason` codes: `bad_request` (not valid JSON or a missing or invalid field), `unsupported_version`,
`too_long`, `wrong_subreddit` (the reply's parent is elsewhere), `duplicate` (auto mode: same title
posted in the last 7 days), `moderator` (rejected by a moderator; `detail` has their note). When the
request has no readable `ref`, the status omits it; the reply's `message_reference` still identifies
the request.

## Polling

A scheduler job runs every minute under a Redis lock that expires before the next run.

1. On the first run, the bridge stores the newest outbox message ID as its cursor and processes
   nothing older. Messages written before installation are never replayed.
2. It fetches messages `after` the cursor, 100 at a time until fewer come back, and handles them in
   ascending ID order, advancing the cursor after each one.
3. It then works through the queue: expires old drafts and, in auto mode, posts what the limits
   allow.

Errors are handled by where they happen:

- **Reading the outbox fails:** the cursor stays, and the next run reads the same messages again.
- **Reddit refuses a post or comment:** the request becomes `failed` and the cursor moves past it.
  The bridge does not retry, because a retry could post twice.
- **Discord answers 429:** the bridge waits for `Retry-After` when it fits in the 30-second request
  limit, and otherwise stops and continues on the next run.

## Approval

Each installation has an `approvalMode`:

- **`manual` (default).** Valid requests become `queued`. A moderator runs **Review bridge drafts**
  from the subreddit's moderator menu. The bridge checks on the server that the user is a moderator,
  then shows the oldest queued draft in a form: its `ref`, an editable title (posts) or the parent's
  link and opening text (replies), the editable text, and an approve or reject choice with an
  optional note.
- **`auto`.** Valid requests are posted without review, at most `maxPostsPerDay` in any 24 hours and
  `minMinutesBetweenPosts` apart; the rest wait as `queued`. A post whose title matches a post of
  the last 7 days is rejected as `duplicate`.

`approvalMode` is a subreddit setting, so any moderator of the subreddit can change it. The bridge's
README must describe both modes, since app review sees only the code it is given.

## Inbox events (bridge → agent, inbox)

The bridge sends one webhook message per post or comment created in the subreddit, after Reddit's
safety checks (`onPostCreate`, `onCommentCreate`):

```json
{
  "v": 1,
  "event": "comment",
  "thing": "t1_def456",
  "post": "t3_abc123",
  "parent": "t3_abc123",
  "author": "some_user",
  "byApp": false,
  "url": "https://www.reddit.com/r/example/comments/abc123/welcome/def456/",
  "created": "2026-10-12T07:30:00Z",
  "truncated": false,
  "text": "Nice post"
}
```

Posts carry `title` and omit `post` and `parent`; link posts also carry `link`, the linked URL.
`byApp` marks the bridge's own posts and comments, so the agent can see its requests go live. Text
longer than 6,000 characters is cut and marked `truncated`; `url` has the full item.

Reddit content leaves Reddit here, so the bridge sends only what is publicly visible and keeps the
copy in step with Reddit:

- Before sending, the bridge fetches the item again and skips it if it has been removed, deleted, or
  filtered, because a trigger is a snapshot that can be out of date.

- An edit (`onPostUpdate`, `onCommentUpdate`) replaces the message's text and adds `"edited"` with
  the edit time.
- A deletion or removal (`onPostDelete`, `onCommentDelete`) deletes the message.
- Every inbox message is deleted 30 days after it was sent. There is no account-deletion event, so
  this bounds how long a deleted account's content can remain.

Triggers can arrive twice or out of order; the bridge keys its webhook messages by thing ID so a
repeat edits the existing message instead of sending another.

## Settings

| Setting                  | Scope         | Value                                |
| ------------------------ | ------------- | ------------------------------------ |
| `discordBotToken`        | global secret | The bridge bot's token               |
| `inboxWebhookUrl`        | global secret | The inbox channel's webhook URL      |
| `outboxChannelId`        | subreddit     | Outbox channel ID                    |
| `agentAuthorId`          | subreddit     | The agent bot's Discord user ID      |
| `approvalMode`           | subreddit     | `manual` or `auto`, default `manual` |
| `maxPostsPerDay`         | subreddit     | Auto mode cap, default 10            |
| `minMinutesBetweenPosts` | subreddit     | Auto mode spacing, default 30        |

The probe's `discordChannelId` and `allowedAuthorId` become `outboxChannelId` and `agentAuthorId`
when the bridge replaces it.

## Versioning

`v` is 1. New optional fields may be added within v1, and receivers ignore unknown fields. Anything
else is v2; the bridge rejects other versions with `unsupported_version`.

## Not in v1

Link, image and video posts; flair; editing or deleting the app's posts; any subreddit other than
the installation's; searching or reading Reddit on demand through the outbox; posting as a person's
own account; notifying moderators that drafts are waiting.
