import type { Reason, Request, Status } from "./protocol.js";

// The subset of Devvit's Redis client the bridge uses, so tests can pass an in-memory fake.
// Devvit scopes these keys to the installation.
export type Kv = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  zAdd(key: string, ...members: { member: string; score: number }[]): Promise<number>;
  zRange(
    key: string,
    start: number,
    stop: number,
    options: { by: "rank" | "score" },
  ): Promise<{ member: string; score: number }[]>;
  zRem(key: string, members: string[]): Promise<number>;
  zRemRangeByScore(key: string, min: number, max: number): Promise<number>;
  zScore(key: string, member: string): Promise<number | undefined>;
};

export const keys = {
  lock: "bridge:lock",
  cursor: "bridge:cursor",
  request: (ref: string) => `bridge:request:${ref}`,
  queue: "bridge:queue",
  executed: "bridge:executed",
  titles: "bridge:titles",
  inbox: (thing: string) => `bridge:inbox:${thing}`,
  inboxSent: "bridge:inbox-sent",
  review: (userId: string) => `bridge:review:${userId}`,
};

export type Draft = Request & {
  messageId: string;
  createdAt: number;
  status: Status;
  statusMessageId?: string;
  thing?: string;
  url?: string;
  edited?: boolean;
  reason?: Reason;
  detail?: string;
};

export async function getDraft(kv: Kv, ref: string): Promise<Draft | undefined> {
  const raw = await kv.get(keys.request(ref));
  return raw ? (JSON.parse(raw) as Draft) : undefined;
}

// A finished draft keeps its metadata for idempotency but drops the text it no longer needs.
export async function saveDraft(kv: Kv, draft: Draft): Promise<void> {
  const stored = draft.status === "queued" ? draft : { ...draft, text: "" };
  await kv.set(keys.request(draft.ref), JSON.stringify(stored));
}

const LOCK_SECONDS = 50;

// One poll at a time. A lock older than its expiry (a crash between hSetNX and expire) is
// taken over.
export async function acquireLock(kv: Kv, now: number): Promise<boolean> {
  if (await kv.hSetNX(keys.lock, "at", String(now))) {
    await kv.expire(keys.lock, LOCK_SECONDS);
    return true;
  }
  const at = Number(await kv.hGet(keys.lock, "at"));
  if (now - at < LOCK_SECONDS * 1000) return false;
  await kv.del(keys.lock);
  return acquireLock(kv, now);
}

export async function releaseLock(kv: Kv): Promise<void> {
  await kv.del(keys.lock);
}
