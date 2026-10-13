import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { privateWrite, readOptional } from "@apps-of-dots/runtime";

// OpenAI MCP Events for the tunnel's Reddit server: subscriptions, an inbox of events for the
// pending/acknowledge tools, and webhook delivery as Standard Webhooks
// (https://www.standardwebhooks.com/). The tunnel's server is the only writer of the state file.

export const DRAFT_FINISHED = "reddit.draft.finished";
export const ACTIVITY_CREATED = "reddit.activity.created";
const EVENT_NAMES = [DRAFT_FINISHED, ACTIVITY_CREATED];
export const CALLBACK_HOSTS = ["connectors.api.openai.com"];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ACKED_KEEP = 7 * DAY;
const PENDING_KEEP = 30 * DAY;
const GIVE_UP_AFTER = DAY;
const ROTATION_OVERLAP = 5 * MINUTE;
const DELIVERY_TICK = 5_000;

export class EventError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Subscription = {
  id: string;
  name: string;
  url: string;
  secret: string;
  previousSecret?: string;
  rotationUntil?: number;
  createdAt: number;
  refreshedAt: number;
};
type InboxEvent = {
  eventId: string;
  name: string;
  timestamp: number;
  data: Record<string, unknown>;
  ackedAt?: number;
};
type OutboxItem = {
  eventId: string;
  subscriptionId: string;
  firstAt: number;
  nextAt: number;
  attempts: number;
};
type State = {
  version: 1;
  subscriptions: Record<string, Subscription>;
  inbox: InboxEvent[];
  outbox: OutboxItem[];
  /** Finished drafts the watcher has already seen; absent until its first scan. */
  watched?: string[];
  /** The newest inbox message the watcher has seen; absent until its first scan. */
  inboxCursor?: string;
  /** The last delivery attempt, for status. */
  lastDelivery?: { at: number; eventId: string; name: string; status: number; error?: string };
  /** When each event's last subscription ended, until a new one starts. */
  ended?: Record<string, number>;
};

export type EventStatus = {
  events: { name: string; subscriptions: number; pending: number; endedAt?: string }[];
  /** Deliveries waiting to be sent or retried. */
  queued: number;
  lastDelivery?: { at: string; event: string; status: number; error?: string };
};

export interface StateFile {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
}

export function stateFile(home: string): StateFile {
  const path = join(home, "reddit", "events.json");
  return { read: () => readOptional(path), write: (value) => privateWrite(path, value) };
}

export type Post = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<{ status: number; body: string; retryAfterMs: number }>;

export const httpPost: Post = async (url, headers, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const seconds = Number(res.headers.get("retry-after"));
  return {
    status: res.status,
    body: await res.text(),
    retryAfterMs: Number.isInteger(seconds) && seconds > 0 ? seconds * 1000 : 0,
  };
};

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The HMAC key of a `whsec_` secret; Standard Webhooks allows 24 to 64 bytes. */
export function signingKey(secret: string): Buffer {
  if (!secret.startsWith("whsec_")) throw new Error("signing secret must start with whsec_");
  const raw = secret.slice("whsec_".length);
  if (!BASE64.test(raw)) throw new Error("signing secret is not base64");
  const key = Buffer.from(raw, "base64");
  if (key.length < 24 || key.length > 64) throw new Error("signing secret must be 24 to 64 bytes");
  return key;
}

/** The `webhook-signature` value; during a rotation both secrets sign, space separated. */
export function sign(secrets: string[], msgId: string, unix: number, body: string): string {
  return secrets
    .map(
      (secret) =>
        "v1," +
        createHmac("sha256", signingKey(secret))
          .update(`${msgId}.${unix}.${body}`)
          .digest("base64"),
    )
    .join(" ");
}

function checkCallback(raw: string, hosts: readonly string[]): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("callback is not a URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("callback must be a plain https URL on port 443");
  if (!hosts.includes(url.hostname.toLowerCase()))
    throw new Error(`callback host ${url.hostname} is not allowed`);
}

/** Stable per event and callback URL; the events take no arguments. */
function subscriptionId(name: string, url: string): string {
  return "sub_" + createHash("sha256").update(`${name}\0${url}`).digest("hex").slice(0, 32);
}

const params = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).nullish(),
  delivery: z.object({
    mode: z.string().optional(),
    url: z.string(),
    secret: z.string().optional(),
  }),
  cursor: z.string().nullish(),
});

function parseParams(raw: unknown) {
  const parsed = params.safeParse(raw);
  if (!parsed.success) throw new EventError(-32602, "invalid params");
  const p = parsed.data;
  if (!EVENT_NAMES.includes(p.name)) throw new EventError(-32602, `unknown event ${p.name}`);
  if (p.arguments && Object.keys(p.arguments).length > 0)
    throw new EventError(-32602, "this event takes no arguments");
  return p;
}

const retryable = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

/** Doubles from 5 s to an hour; a longer Retry-After wins, still capped at an hour. */
const backoff = (attempts: number, retryAfterMs: number) =>
  Math.min(Math.max(5_000 * 2 ** Math.min(attempts - 1, 10), retryAfterMs), HOUR);

function parseState(raw: string): State {
  try {
    const state = JSON.parse(raw) as State;
    if (
      state?.version === 1 &&
      typeof state.subscriptions === "object" &&
      Array.isArray(state.inbox) &&
      Array.isArray(state.outbox)
    ) {
      // Subscriptions saved before there were two events are for finished drafts.
      for (const subscription of Object.values(state.subscriptions))
        subscription.name ??= DRAFT_FINISHED;
      return state;
    }
  } catch {
    // Reported below.
  }
  throw new Error("Unreadable Reddit events state (reddit/events.json). Delete it to start over.");
}

export type HubOptions = {
  file: StateFile;
  post?: Post;
  now?: () => number;
  hosts?: readonly string[];
  log?: (line: string) => void;
};

export class EventHub {
  private saving: Promise<void> = Promise.resolve();
  private delivering = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly post: Post;
  private readonly now: () => number;
  private readonly hosts: readonly string[];
  private readonly log: (line: string) => void;

  private constructor(
    private readonly options: HubOptions,
    private state: State,
  ) {
    this.post = options.post ?? httpPost;
    this.now = options.now ?? Date.now;
    this.hosts = options.hosts ?? CALLBACK_HOSTS;
    this.log = options.log ?? ((line) => console.error(`[events] ${line}`));
  }

  static async open(options: HubOptions): Promise<EventHub> {
    const raw = await options.file.read();
    const empty: State = { version: 1, subscriptions: {}, inbox: [], outbox: [] };
    return new EventHub(options, raw === undefined ? empty : parseState(raw));
  }

  /** Delivers queued events every few seconds until stopped. */
  start(): void {
    this.timer ??= setInterval(() => void this.deliverDue(), DELIVERY_TICK);
    this.timer.unref();
    void this.deliverDue();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Verifies the callback with a signed challenge and stores the subscription. It does not
   * expire: it ends on events/unsubscribe or when the callback answers 410.
   */
  async subscribe(raw: unknown) {
    const p = parseParams(raw);
    if (p.delivery.mode !== "webhook") throw new EventError(-32602, "webhook delivery required");
    if (p.cursor != null) throw new EventError(-32602, "this event does not support a cursor");
    const secret = p.delivery.secret ?? "";
    try {
      signingKey(secret);
    } catch (error) {
      throw new EventError(-32602, `invalid signing secret: ${(error as Error).message}`);
    }
    try {
      checkCallback(p.delivery.url, this.hosts);
    } catch (error) {
      this.log(`subscribe refused: ${(error as Error).message}`);
      throw new EventError(-32015, `callback URL not allowed: ${(error as Error).message}`, {
        reason: "invalid_url",
      });
    }
    const id = subscriptionId(p.name, p.delivery.url);
    const existing = this.state.subscriptions[id];
    // A refresh with the secret already verified skips the challenge.
    if (existing?.secret !== secret) {
      try {
        await this.verify(id, p.delivery.url, secret);
      } catch (error) {
        this.log(`subscribe ${id} failed verification: ${(error as Error).message}`);
        throw new EventError(-32015, "callback challenge failed", {
          reason: "challenge_failed",
        });
      }
    }
    const now = this.now();
    const subscription: Subscription = {
      id,
      name: p.name,
      url: p.delivery.url,
      secret,
      createdAt: existing?.createdAt ?? now,
      refreshedAt: now,
    };
    if (existing && existing.secret !== secret) {
      subscription.previousSecret = existing.secret;
      subscription.rotationUntil = now + ROTATION_OVERLAP;
    } else if (existing?.previousSecret && now < (existing.rotationUntil ?? 0)) {
      subscription.previousSecret = existing.previousSecret;
      subscription.rotationUntil = existing.rotationUntil;
    }
    this.state.subscriptions[id] = subscription;
    if (this.state.ended) delete this.state.ended[p.name];
    await this.save();
    this.log(`subscribed ${id}${existing ? " (refresh)" : ""}`);
    return { id, refreshBefore: null, cursor: null, truncated: false };
  }

  async unsubscribe(raw: unknown): Promise<void> {
    const p = parseParams(raw);
    const id = subscriptionId(p.name, p.delivery.url);
    if (!this.state.subscriptions[id]) return;
    this.end(id, this.now());
    await this.save();
    this.log(`unsubscribed ${id}`);
  }

  private end(id: string, now: number): void {
    const { name } = this.state.subscriptions[id]!;
    delete this.state.subscriptions[id];
    this.state.outbox = this.state.outbox.filter((o) => o.subscriptionId !== id);
    if (!Object.values(this.state.subscriptions).some((s) => s.name === name))
      (this.state.ended ??= {})[name] = now;
  }

  /**
   * Adds an event to the inbox and queues it for every subscription to its name; the next
   * delivery tick sends it. An ID already in the inbox is ignored.
   */
  async emit(name: string, eventId: string, data: Record<string, unknown>): Promise<boolean> {
    const now = this.now();
    this.prune(now);
    if (this.state.inbox.some((e) => e.eventId === eventId)) return false;
    this.state.inbox.push({ eventId, name, timestamp: now, data });
    for (const { id, name: subscribed } of Object.values(this.state.subscriptions))
      if (subscribed === name)
        this.state.outbox.push({
          eventId,
          subscriptionId: id,
          firstAt: now,
          nextAt: now,
          attempts: 0,
        });
    await this.save();
    this.log(`emitted ${eventId}`);
    return true;
  }

  /** Unacknowledged events, oldest first, optionally of one name. */
  pending(limit: number, name?: string) {
    return this.state.inbox
      .filter((e) => e.ackedAt === undefined && (!name || e.name === name))
      .slice(0, limit)
      .map((e) => ({
        eventId: e.eventId,
        name: e.name,
        timestamp: new Date(e.timestamp).toISOString(),
        data: e.data,
      }));
  }

  async acknowledge(ids: string[]): Promise<{ acknowledged: number; pending: number }> {
    const now = this.now();
    let acknowledged = 0;
    for (const event of this.state.inbox) {
      if (event.ackedAt === undefined && ids.includes(event.eventId)) {
        event.ackedAt = now;
        acknowledged++;
      }
    }
    this.prune(now);
    await this.save();
    const pending = this.state.inbox.filter((e) => e.ackedAt === undefined).length;
    return { acknowledged, pending };
  }

  watched(): string[] | undefined {
    return this.state.watched;
  }

  async setWatched(keys: string[]): Promise<void> {
    this.state.watched = keys;
    await this.save();
  }

  inboxCursor(): string | undefined {
    return this.state.inboxCursor;
  }

  async setInboxCursor(messageId: string): Promise<void> {
    this.state.inboxCursor = messageId;
    await this.save();
  }

  async deliverDue(): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    try {
      const now = this.now();
      const due = this.state.outbox.filter((o) => o.nextAt <= now);
      for (const item of due) await this.deliver(item);
    } finally {
      this.delivering = false;
    }
  }

  private async deliver(item: OutboxItem): Promise<void> {
    const same = (o: OutboxItem) =>
      o.eventId === item.eventId && o.subscriptionId === item.subscriptionId;
    const subscription = this.state.subscriptions[item.subscriptionId];
    const event = this.state.inbox.find((e) => e.eventId === item.eventId);
    if (!subscription || !event) {
      this.state.outbox = this.state.outbox.filter((o) => !same(o));
      return this.save();
    }
    const now = this.now();
    const body = JSON.stringify({
      eventId: event.eventId,
      name: event.name,
      timestamp: new Date(event.timestamp).toISOString(),
      data: event.data,
      cursor: null,
    });
    const secrets = [subscription.secret];
    if (subscription.previousSecret && now < (subscription.rotationUntil ?? 0))
      secrets.push(subscription.previousSecret);
    let result: { status: number; retryAfterMs: number } = { status: 0, retryAfterMs: 0 };
    let failure = "";
    try {
      result = await this.send(subscription.url, secrets, event.eventId, subscription.id, body);
    } catch (error) {
      failure = (error as Error).message;
    }
    const { status } = result;
    const label = `${event.eventId} to ${subscription.id}`;
    this.state.lastDelivery = {
      at: now,
      eventId: event.eventId,
      name: event.name,
      status,
      ...(failure ? { error: failure } : {}),
    };
    if (!failure && status >= 200 && status <= 299) {
      this.state.outbox = this.state.outbox.filter((o) => !same(o));
      this.log(`delivered ${label}`);
    } else if (!failure && status === 410) {
      this.end(subscription.id, now);
      this.log(`subscription ${subscription.id} ended: the callback answered 410`);
    } else if (!failure && !retryable(status)) {
      this.state.outbox = this.state.outbox.filter((o) => !same(o));
      this.log(`dropped ${label}: HTTP ${status}`);
    } else {
      const queued = this.state.outbox.find(same);
      if (!queued) return;
      queued.attempts++;
      if (now - queued.firstAt > GIVE_UP_AFTER) {
        this.state.outbox = this.state.outbox.filter((o) => !same(o));
        this.log(`gave up on ${label} after ${queued.attempts} attempts`);
      } else {
        queued.nextAt = now + backoff(queued.attempts, result.retryAfterMs);
        this.log(`retrying ${label}: ${failure || `HTTP ${status}`}`);
      }
    }
    await this.save();
  }

  /** Posts a challenge that the callback must echo, signed like every delivery. */
  private async verify(id: string, url: string, secret: string): Promise<void> {
    const challenge = randomBytes(32).toString("base64url");
    const body = JSON.stringify({ type: "verification", challenge });
    const res = await this.send(
      url,
      [secret],
      `msg_verification_${challenge.slice(0, 16)}`,
      id,
      body,
    );
    if (res.status < 200 || res.status > 299)
      throw new Error(`challenge answered HTTP ${res.status}`);
    let echoed: unknown;
    try {
      echoed = (JSON.parse(res.body) as { challenge?: unknown }).challenge;
    } catch {
      echoed = undefined;
    }
    const expected = Buffer.from(challenge);
    const actual = Buffer.from(typeof echoed === "string" ? echoed : "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("challenge not echoed");
  }

  // OpenAI's callback answers 400 without X-MCP-Subscription-Id, the challenge included.
  private send(
    url: string,
    secrets: string[],
    msgId: string,
    subscriptionId: string,
    body: string,
  ) {
    checkCallback(url, this.hosts);
    const unix = Math.floor(this.now() / 1000);
    return this.post(
      url,
      {
        "Content-Type": "application/json",
        "User-Agent": "apps-of-dots-reddit",
        "webhook-id": msgId,
        "webhook-timestamp": String(unix),
        "webhook-signature": sign(secrets, msgId, unix, body),
        "X-MCP-Subscription-Id": subscriptionId,
      },
      body,
    );
  }

  private prune(now: number): void {
    this.state.inbox = this.state.inbox.filter((e) =>
      e.ackedAt === undefined ? now - e.timestamp <= PENDING_KEEP : now - e.ackedAt <= ACKED_KEEP,
    );
  }

  private save(): Promise<void> {
    const value = JSON.stringify(this.state, null, 2) + "\n";
    this.saving = this.saving.catch(() => undefined).then(() => this.options.file.write(value));
    return this.saving;
  }
}

/** A summary for status pages, read without writing. It has no callback URLs or secrets. */
export async function eventStatus(file: StateFile): Promise<EventStatus> {
  const raw = await file.read();
  const state = raw === undefined ? undefined : parseState(raw);
  const subscriptions = Object.values(state?.subscriptions ?? {});
  const last = state?.lastDelivery;
  return {
    events: EVENT_NAMES.map((name) => {
      const endedAt = state?.ended?.[name];
      return {
        name,
        subscriptions: subscriptions.filter((s) => s.name === name).length,
        pending: (state?.inbox ?? []).filter((e) => e.name === name && e.ackedAt === undefined)
          .length,
        ...(endedAt ? { endedAt: new Date(endedAt).toISOString() } : {}),
      };
    }),
    queued: state?.outbox.length ?? 0,
    ...(last
      ? {
          lastDelivery: {
            at: new Date(last.at).toISOString(),
            event: last.name,
            status: last.status,
            ...(last.error ? { error: last.error } : {}),
          },
        }
      : {}),
  };
}

/** Events, then the last delivery, on one line for terminals. */
export function describeEvents(status: EventStatus): string {
  const parts = status.events.map(({ name, subscriptions, pending, endedAt }) => {
    const state = subscriptions
      ? `subscribed (${subscriptions})`
      : endedAt
        ? `subscription ended ${endedAt} (ask your dot to subscribe again)`
        : "not subscribed";
    return `${name} ${state}, ${pending} pending`;
  });
  const last = status.lastDelivery;
  if (last)
    parts.push(
      `last delivery ${last.at} ${last.event}: ${last.error ?? `HTTP ${last.status}`}, ${status.queued} queued`,
    );
  return parts.join(" | ");
}
