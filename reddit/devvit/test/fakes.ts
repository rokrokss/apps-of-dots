import type { BridgeConfig, Deps, Outbox, Poster } from "../src/bridge.js";
import type { InboxDeps, InboxItem, Webhook } from "../src/inbox.js";
import type { DiscordMessage, Framed } from "../src/protocol.js";
import type { Kv } from "../src/store.js";

export const AGENT = "111";

export class FakeKv implements Kv {
  strings = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  zsets = new Map<string, Map<string, number>>();

  private z(key: string) {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key)!;
  }
  async get(key: string) {
    return this.strings.get(key);
  }
  async set(key: string, value: string) {
    this.strings.set(key, value);
    return "OK";
  }
  async del(...keys: string[]) {
    for (const key of keys) {
      this.strings.delete(key);
      this.hashes.delete(key);
      this.zsets.delete(key);
    }
  }
  async hGet(key: string, field: string) {
    return this.hashes.get(key)?.get(field);
  }
  async hSetNX(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    if (hash.has(field)) return 0;
    hash.set(field, value);
    this.hashes.set(key, hash);
    return 1;
  }
  async expire() {}
  async zAdd(key: string, ...members: { member: string; score: number }[]) {
    for (const { member, score } of members) this.z(key).set(member, score);
    return members.length;
  }
  async zRange(key: string, start: number, stop: number, options: { by: "rank" | "score" }) {
    const sorted = [...this.z(key)]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score);
    if (options.by === "score") return sorted.filter((x) => x.score >= start && x.score <= stop);
    return sorted.slice(start, (stop < 0 ? sorted.length + stop : stop) + 1);
  }
  async zRem(key: string, members: string[]) {
    for (const member of members) this.z(key).delete(member);
    return members.length;
  }
  async zRemRangeByScore(key: string, min: number, max: number) {
    for (const [member, score] of this.z(key))
      if (score >= min && score <= max) this.z(key).delete(member);
    return 0;
  }
  async zScore(key: string, member: string) {
    return this.z(key).get(member);
  }
}

export class FakeOutbox implements Outbox {
  messages: DiscordMessage[] = [];
  replies = new Map<string, { to: string; content: string }>();
  failRead = false;
  private nextId = 1000n;

  send(content: string, authorId = AGENT, embeds: { description?: string }[] = []): string {
    const id = String(this.nextId++);
    this.messages.push({ id, authorId, content, embeds });
    return id;
  }
  request(body: Record<string, unknown>): string {
    return this.send(JSON.stringify({ v: 1, ...body }));
  }
  /** The parsed status replies to a message, oldest first. */
  statuses(messageId: string): Record<string, unknown>[] {
    return [...this.replies.values()]
      .filter((r) => r.to === messageId)
      .map((r) => JSON.parse(r.content));
  }
  async newestMessageId() {
    return this.messages.at(-1)?.id;
  }
  async messagesAfter(after: string) {
    if (this.failRead) throw new Error("Discord GET 503");
    return this.messages.filter((m) => BigInt(m.id) > BigInt(after));
  }
  async reply(to: string, content: string) {
    const id = String(this.nextId++);
    this.replies.set(id, { to, content });
    return id;
  }
  async edit(messageId: string, content: string) {
    this.replies.get(messageId)!.content = content;
  }
}

export class FakePoster implements Poster {
  posts: { title: string; text: string }[] = [];
  comments: { parent: string; text: string }[] = [];
  subreddits = new Map<string, string>();
  fail = false;

  async submitPost(title: string, text: string) {
    if (this.fail) throw new Error("SUBMIT_VALIDATION_ERROR");
    this.posts.push({ title, text });
    return {
      id: `t3_p${this.posts.length}`,
      url: `https://www.reddit.com/r/home/comments/p${this.posts.length}/`,
    };
  }
  async submitComment(parent: string, text: string) {
    if (this.fail) throw new Error("SUBMIT_VALIDATION_ERROR");
    this.comments.push({ parent, text });
    return {
      id: `t1_c${this.comments.length}`,
      url: `https://www.reddit.com/r/home/comments/x/c${this.comments.length}/`,
    };
  }
  async subredditOf(thing: string) {
    const subreddit = this.subreddits.get(thing);
    if (!subreddit) throw new Error("not found");
    return subreddit;
  }
}

export function bridgeDeps(config: Partial<BridgeConfig> = {}) {
  const clock = { now: Date.parse("2026-10-12T00:00:00Z") };
  const deps: Deps = {
    kv: new FakeKv(),
    outbox: new FakeOutbox(),
    reddit: new FakePoster(),
    config: {
      subredditName: "home",
      agentAuthorId: AGENT,
      approvalMode: "manual",
      maxPostsPerDay: 10,
      minMinutesBetweenPosts: 30,
      ...config,
    },
    now: () => clock.now,
  };
  return { deps, clock, outbox: deps.outbox as FakeOutbox, poster: deps.reddit as FakePoster };
}

export class FakeWebhook implements Webhook {
  messages = new Map<string, Framed>();
  failRemove = false;
  private nextId = 5000;

  async send(message: Framed) {
    const id = String(this.nextId++);
    this.messages.set(id, message);
    return id;
  }
  async edit(messageId: string, message: Framed) {
    this.messages.set(messageId, message);
  }
  async remove(messageId: string) {
    if (this.failRemove) throw new Error("Discord DELETE 503");
    this.messages.delete(messageId);
  }
}

export function inboxDeps() {
  const clock = { now: Date.parse("2026-10-12T00:00:00Z") };
  const items = new Map<string, InboxItem>();
  const webhook = new FakeWebhook();
  const deps: InboxDeps = {
    kv: new FakeKv(),
    webhook,
    fetchItem: async (thing) => items.get(thing),
    appName: "rokrokssss",
    now: () => clock.now,
  };
  return { deps, clock, items, webhook };
}
