import type { ApiMessage, DiscordApi } from "./discord.js";
import { ACTIVITY_CREATED, DRAFT_FINISHED, type EventHub } from "./events.js";
import { readMessage } from "./protocol.js";
import type { Channels } from "./server.js";

// Draft states read from the outbox, and the watcher that turns finished drafts and new inbox
// activity into events.

const SCAN_PAGES = 3;
const ACTIVITY_PAGES = 3;
const FINAL_STATES = new Set(["posted", "rejected", "failed", "expired"]);

export type Draft = {
  ref: string;
  state: string;
  op?: unknown;
  title?: unknown;
  parent?: unknown;
  thing?: unknown;
  url?: unknown;
  edited?: unknown;
  reason?: unknown;
  detail?: unknown;
  requestMessageId?: string | undefined;
};

async function recentOutbox(discord: DiscordApi, channelId: string): Promise<ApiMessage[]> {
  const messages: ApiMessage[] = [];
  let before: string | undefined;
  for (let page = 0; page < SCAN_PAGES; page++) {
    const batch = await discord.messages(channelId, { limit: 100, ...(before ? { before } : {}) });
    messages.push(...batch);
    if (batch.length < 100) break;
    before = batch[batch.length - 1]!.id;
  }
  return messages;
}

// Newest first: each ref's first status reply wins; a request with no reply yet is "sent".
export async function drafts(discord: DiscordApi, channels: Channels): Promise<Draft[]> {
  const [me, messages] = await Promise.all([
    discord.me(),
    recentOutbox(discord, channels.outboxChannelId),
  ]);
  const requests = new Map<string, Draft>();
  for (const message of messages) {
    if (message.author.id !== me) continue;
    const e = readMessage(message)?.envelope;
    if (typeof e?.ref !== "string") continue;
    requests.set(message.id, {
      ref: e.ref,
      state: "sent",
      op: e.op,
      ...(e.op === "post" ? { title: e.title } : { parent: e.parent }),
      requestMessageId: message.id,
    });
  }
  const statuses = new Map<string, Draft>();
  for (const message of messages) {
    if (message.author.id !== channels.bridgeBotId) continue;
    const s = readMessage(message)?.envelope;
    if (typeof s?.ref !== "string" || typeof s.status !== "string" || statuses.has(s.ref)) continue;
    const requestId = message.message_reference?.message_id;
    const request = requestId ? requests.get(requestId) : undefined;
    statuses.set(s.ref, {
      ...request,
      ref: s.ref,
      state: s.status,
      thing: s.thing,
      url: s.url,
      edited: s.edited,
      reason: s.reason,
      detail: s.detail,
      requestMessageId: requestId,
    });
  }
  // A bridge status always beats "sent", even when a repeated request is newer than it.
  const found = new Map<string, Draft>();
  for (const message of messages) {
    const request = requests.get(message.id);
    const ref =
      message.author.id === channels.bridgeBotId
        ? readMessage(message)?.envelope.ref
        : request?.ref;
    if (typeof ref !== "string" || found.has(ref)) continue;
    const draft = statuses.get(ref) ?? request;
    if (draft) found.set(ref, draft);
  }
  return [...found.values()];
}

/**
 * Emits one event per draft that reached a final state since the last scan, oldest first. The
 * first scan only records what is already finished, so subscribing does not replay history.
 */
export async function scanDrafts(
  hub: EventHub,
  discord: DiscordApi,
  channels: Channels,
): Promise<void> {
  const finished = (await drafts(discord, channels))
    .filter((d) => FINAL_STATES.has(d.state))
    .reverse();
  const keys = finished.map((d) => `draft:${d.ref}:${d.state}`);
  const seen = hub.watched();
  if (seen) {
    for (const [i, draft] of finished.entries()) {
      if (seen.includes(keys[i]!)) continue;
      const { requestMessageId: _, ...data } = draft;
      await hub.emit(DRAFT_FINISHED, keys[i]!, defined(data));
    }
  }
  await hub.setWatched(keys);
}

/**
 * Emits one event per post or comment the bridge copied to the inbox since the last scan,
 * except the bridge's own. Events hold references only; the text stays in Discord, where it
 * follows deletions on Reddit. The first scan only records where the inbox ends.
 */
export async function scanActivity(
  hub: EventHub,
  discord: DiscordApi,
  channels: Channels,
): Promise<void> {
  const channelId = channels.inboxChannelId;
  let cursor = hub.inboxCursor();
  if (cursor === undefined) {
    const [newest] = await discord.messages(channelId, { limit: 1 });
    return hub.setInboxCursor(newest?.id ?? "0");
  }
  for (let page = 0; page < ACTIVITY_PAGES; page++) {
    const batch = await discord.messages(channelId, { after: cursor, limit: 100 });
    if (batch.length === 0) break;
    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    for (const message of batch) {
      // Only the bridge's webhook writes events, as in reddit_list_activity.
      const e = message.webhook_id ? readMessage(message)?.envelope : undefined;
      if ((e?.event !== "post" && e?.event !== "comment") || typeof e.thing !== "string") continue;
      if (e.byApp === true) continue;
      await hub.emit(
        ACTIVITY_CREATED,
        `activity:${e.thing}`,
        defined({
          thing: e.thing,
          kind: e.event,
          post: e.post,
          parent: e.parent,
          url: e.url,
          created: e.created,
          messageId: message.id,
        }),
      );
    }
    cursor = batch.at(-1)!.id;
    await hub.setInboxCursor(cursor);
    if (batch.length < 100) break;
  }
}

function defined(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

/** Scans the outbox and the inbox now and then every interval until stopped. */
export function watchDrafts(
  hub: EventHub,
  discord: DiscordApi,
  channels: Channels,
  intervalMs = 30_000,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    for (const [label, scan] of [
      ["draft", scanDrafts],
      ["activity", scanActivity],
    ] as const) {
      try {
        await scan(hub, discord, channels);
      } catch (error) {
        console.error(`[events] ${label} scan failed: ${(error as Error).message}`);
      }
    }
    running = false;
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
