import type { ApiMessage, DiscordApi } from "./discord.js";
import type { EventHub } from "./events.js";
import { readMessage } from "./protocol.js";
import type { Channels } from "./server.js";

// Draft states read from the outbox, and the watcher that turns finished drafts into
// reddit.draft.finished events.

const SCAN_PAGES = 3;
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
      await hub.emit(
        keys[i]!,
        Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
      );
    }
  }
  await hub.setWatched(keys);
}

/** Scans the outbox now and then every interval until stopped. */
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
    try {
      await scanDrafts(hub, discord, channels);
    } catch (error) {
      console.error(`[events] draft scan failed: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
