import { frame, type Framed } from "./protocol.js";
import { keys, type Kv } from "./store.js";

// The inbox side of reddit/PROTOCOL.md: mirror visible posts and comments to a Discord webhook,
// follow edits and deletions, and drop every copy after 30 days.

export type Webhook = {
  /** Sends a message and returns its ID. */
  send(message: Framed): Promise<string>;
  edit(messageId: string, message: Framed): Promise<void>;
  remove(messageId: string): Promise<void>;
};

export type InboxItem = {
  kind: "post" | "comment";
  thing: string;
  post?: string;
  parent?: string;
  author: string;
  title?: string;
  link?: string;
  url: string;
  created: Date;
  text: string;
  /** False when the item is removed, deleted, spam or filtered. */
  visible: boolean;
};

export type InboxDeps = {
  kv: Kv;
  webhook: Webhook;
  fetchItem(thing: string): Promise<InboxItem | undefined>;
  appName: string;
  now: () => number;
};

const RETENTION = 30 * 24 * 60 * 60 * 1000;

export function inboxMessage(item: InboxItem, appName: string, edited?: Date): Framed {
  return frame(
    {
      event: item.kind,
      thing: item.thing,
      ...(item.kind === "comment" ? { post: item.post, parent: item.parent } : {}),
      author: item.author,
      byApp: item.author.toLowerCase() === appName.toLowerCase(),
      ...(item.kind === "post"
        ? { title: item.title, ...(item.link ? { link: item.link } : {}) }
        : {}),
      url: item.url,
      created: item.created.toISOString(),
      ...(edited ? { edited: edited.toISOString() } : {}),
    },
    item.text,
  );
}

export async function onCreated(d: InboxDeps, thing: string): Promise<void> {
  // A trigger is a snapshot; fetch again so removed or filtered content never leaves Reddit.
  const item = await d.fetchItem(thing);
  if (!item?.visible) return;
  const message = inboxMessage(item, d.appName);
  const existing = await d.kv.get(keys.inbox(thing));
  if (existing) {
    // Triggers can arrive twice; edit instead of sending a second copy.
    await d.webhook.edit(existing, message);
    return;
  }
  const messageId = await d.webhook.send(message);
  await d.kv.set(keys.inbox(thing), messageId);
  await d.kv.zAdd(keys.inboxSent, { member: thing, score: d.now() });
}

export async function onUpdated(d: InboxDeps, thing: string): Promise<void> {
  const messageId = await d.kv.get(keys.inbox(thing));
  if (!messageId) return;
  const item = await d.fetchItem(thing);
  if (!item?.visible) {
    await onDeleted(d, thing);
    return;
  }
  await d.webhook.edit(messageId, inboxMessage(item, d.appName, new Date(d.now())));
}

export async function onDeleted(d: InboxDeps, thing: string): Promise<void> {
  const messageId = await d.kv.get(keys.inbox(thing));
  if (!messageId) return;
  try {
    await d.webhook.remove(messageId);
  } catch (error) {
    // Leave it for the next sweep, which treats score 0 as already due.
    console.error(`inbox: deleting the copy of ${thing} failed`, error);
    await d.kv.zAdd(keys.inboxSent, { member: thing, score: 0 });
    return;
  }
  await d.kv.del(keys.inbox(thing));
  await d.kv.zRem(keys.inboxSent, [thing]);
}

export async function sweep(d: InboxDeps): Promise<void> {
  const due = await d.kv.zRange(keys.inboxSent, 0, d.now() - RETENTION, { by: "score" });
  for (const { member } of due) await onDeleted(d, member);
}
