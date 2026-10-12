import {
  autoModeAllows,
  MAX_TITLE,
  normalizeTitle,
  parseRequest,
  statusContent,
  type DiscordMessage,
} from "./protocol.js";
import {
  acquireLock,
  getDraft,
  keys,
  releaseLock,
  saveDraft,
  type Draft,
  type Kv,
} from "./store.js";

// The outbox side of reddit/PROTOCOL.md: read requests, queue them, post them, report status.

export type Outbox = {
  newestMessageId(): Promise<string | undefined>;
  /** Messages after `after`, oldest first, across all pages. */
  messagesAfter(after: string): Promise<DiscordMessage[]>;
  /** Replies to a message and returns the reply's ID. */
  reply(to: string, content: string): Promise<string>;
  edit(messageId: string, content: string): Promise<void>;
};

export type Poster = {
  submitPost(title: string, text: string): Promise<{ id: string; url: string }>;
  submitComment(parent: string, text: string): Promise<{ id: string; url: string }>;
  subredditOf(thing: string): Promise<string>;
};

export type BridgeConfig = {
  subredditName: string;
  agentAuthorId: string;
  approvalMode: "manual" | "auto";
  maxPostsPerDay: number;
  minMinutesBetweenPosts: number;
};

export type Deps = {
  kv: Kv;
  outbox: Outbox;
  reddit: Poster;
  config: BridgeConfig;
  now: () => number;
};

const DAY = 24 * 60 * 60 * 1000;
const EXPIRY = 7 * DAY;
const MAX_MODERATOR_TEXT = 40_000;

export async function poll(d: Deps): Promise<void> {
  if (!(await acquireLock(d.kv, d.now()))) return;
  try {
    await readOutbox(d);
    await processQueue(d);
  } finally {
    await releaseLock(d.kv);
  }
}

async function readOutbox(d: Deps): Promise<void> {
  const cursor = await d.kv.get(keys.cursor);
  if (cursor === undefined) {
    // First run: start after the newest message so nothing written before install is replayed.
    await d.kv.set(keys.cursor, (await d.outbox.newestMessageId()) ?? "0");
    return;
  }
  // A read failure throws here and leaves the cursor, so the next run reads the same messages.
  for (const message of await d.outbox.messagesAfter(cursor)) {
    if (message.authorId === d.config.agentAuthorId) await handleRequest(d, message);
    await d.kv.set(keys.cursor, message.id);
  }
}

async function handleRequest(d: Deps, message: DiscordMessage): Promise<void> {
  const parsed = parseRequest(message);
  if (!parsed.ok) {
    await d.outbox.reply(message.id, statusContent({ status: "rejected", ...parsed }));
    return;
  }
  const existing = await getDraft(d.kv, parsed.request.ref);
  if (existing) {
    // The same message again means an earlier run stopped midway; finish reporting its status.
    if (existing.messageId === message.id) await publishStatus(d, existing);
    else await d.outbox.reply(message.id, statusContent(existing));
    return;
  }

  const draft: Draft = {
    ...parsed.request,
    messageId: message.id,
    createdAt: d.now(),
    status: "queued",
  };
  if (draft.op === "reply") {
    const subreddit = await d.reddit.subredditOf(draft.parent).catch(() => undefined);
    if (!subreddit)
      Object.assign(draft, {
        status: "rejected",
        reason: "bad_request",
        detail: "parent not found",
      });
    else if (subreddit.toLowerCase() !== d.config.subredditName.toLowerCase()) {
      Object.assign(draft, { status: "rejected", reason: "wrong_subreddit" });
    }
  }
  await saveDraft(d.kv, draft);
  if (draft.status === "queued")
    await d.kv.zAdd(keys.queue, { member: draft.ref, score: draft.createdAt });
  await publishStatus(d, draft);
}

async function publishStatus(d: Deps, draft: Draft): Promise<void> {
  const content = statusContent(draft);
  if (draft.statusMessageId) {
    await d.outbox.edit(draft.statusMessageId, content);
    return;
  }
  draft.statusMessageId = await d.outbox.reply(draft.messageId, content);
  await saveDraft(d.kv, draft);
}

async function processQueue(d: Deps): Promise<void> {
  const now = d.now();
  await d.kv.zRemRangeByScore(keys.executed, 0, now - DAY);
  await d.kv.zRemRangeByScore(keys.titles, 0, now - EXPIRY);
  for (const { member: ref } of await d.kv.zRange(keys.queue, 0, -1, { by: "rank" })) {
    const draft = await getDraft(d.kv, ref);
    if (!draft || draft.status !== "queued") {
      await d.kv.zRem(keys.queue, [ref]);
    } else if (now - draft.createdAt >= EXPIRY) {
      await finish(d, { ...draft, status: "expired" });
    } else if (d.config.approvalMode === "auto") {
      const executed = await d.kv.zRange(keys.executed, 0, -1, { by: "rank" });
      const { maxPostsPerDay, minMinutesBetweenPosts } = d.config;
      if (
        !autoModeAllows(
          executed.map((x) => x.score),
          now,
          maxPostsPerDay,
          minMinutesBetweenPosts,
        )
      ) {
        break;
      }
      if (draft.op === "post") {
        const postedAt = await d.kv.zScore(keys.titles, normalizeTitle(draft.title));
        if (postedAt !== undefined && now - postedAt < EXPIRY) {
          await finish(d, { ...draft, status: "rejected", reason: "duplicate" });
          continue;
        }
      }
      await execute(d, draft);
    }
  }
}

async function execute(d: Deps, draft: Draft): Promise<void> {
  const now = d.now();
  try {
    const { id, url } =
      draft.op === "post"
        ? await d.reddit.submitPost(draft.title, draft.text)
        : await d.reddit.submitComment(draft.parent, draft.text);
    await d.kv.zAdd(keys.executed, { member: draft.ref, score: now });
    if (draft.op === "post")
      await d.kv.zAdd(keys.titles, { member: normalizeTitle(draft.title), score: now });
    await finish(d, { ...draft, status: "posted", thing: id, url });
  } catch (error) {
    // No retry: Reddit may have created the post before the error, and a retry would post twice.
    console.error(`bridge: ${draft.op} ${draft.ref} failed`, error);
    await finish(d, {
      ...draft,
      status: "failed",
      reason: "reddit_error",
      detail: (error as Error).message,
    });
  }
}

async function finish(d: Deps, draft: Draft): Promise<void> {
  await d.kv.zRem(keys.queue, [draft.ref]);
  await saveDraft(d.kv, draft);
  await publishStatus(d, draft);
}

export async function oldestQueued(
  d: Deps,
): Promise<{ draft: Draft; waiting: number } | undefined> {
  const queued = await d.kv.zRange(keys.queue, 0, -1, { by: "rank" });
  for (const { member } of queued) {
    const draft = await getDraft(d.kv, member);
    if (draft?.status === "queued" && d.now() - draft.createdAt < EXPIRY) {
      return { draft, waiting: queued.length };
    }
  }
  return undefined;
}

export type Decision =
  { approve: true; title?: string; text: string } | { approve: false; note?: string };

// A moderator's decision from the review form. Returns the toast to show.
export async function decide(d: Deps, ref: string, decision: Decision): Promise<string> {
  const draft = await getDraft(d.kv, ref);
  if (!draft || draft.status !== "queued") return "This draft was already handled.";
  if (!decision.approve) {
    const detail = decision.note?.trim();
    await finish(d, {
      ...draft,
      status: "rejected",
      reason: "moderator",
      ...(detail ? { detail } : {}),
    });
    return "Draft rejected.";
  }

  const text = decision.text;
  if (text.length > MAX_MODERATOR_TEXT) return `Text is over ${MAX_MODERATOR_TEXT} characters.`;
  if (draft.op === "reply") {
    if (!text.trim()) return "A reply needs text.";
    await execute(d, { ...draft, text, edited: text !== draft.text });
  } else {
    const title = (decision.title ?? "").trim();
    if (!title || title.length > MAX_TITLE) return `The title must be 1-${MAX_TITLE} characters.`;
    await execute(d, {
      ...draft,
      title,
      text,
      edited: title !== draft.title || text !== draft.text,
    });
  }
  const result = await getDraft(d.kv, ref);
  return result?.status === "posted"
    ? `Posted: ${result.url}`
    : `Reddit refused it: ${result?.detail}`;
}
