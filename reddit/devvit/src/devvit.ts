import { context, reddit, redis, settings } from "@devvit/web/server";
import type { BridgeConfig, Deps, Poster } from "./bridge.js";
import { botOutbox, inboxWebhook } from "./discord.js";
import type { InboxDeps, InboxItem } from "./inbox.js";

// Wires the bridge to Devvit's Redis, Reddit client, settings and context.

const permalink = (path: string) => `https://www.reddit.com${path}`;

async function text(name: string): Promise<string> {
  return ((await settings.get<string>(name)) ?? "").trim();
}

async function number(name: string, fallback: number): Promise<number> {
  const value = Number(await settings.get<number | string>(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function config(): Promise<BridgeConfig> {
  // A select setting may come back as a one-element array.
  const mode = await settings.get<string | string[]>("approvalMode");
  return {
    subredditName: context.subredditName,
    agentAuthorId: await text("agentAuthorId"),
    approvalMode: (Array.isArray(mode) ? mode[0] : mode) === "auto" ? "auto" : "manual",
    maxPostsPerDay: await number("maxPostsPerDay", 10),
    minMinutesBetweenPosts: await number("minMinutesBetweenPosts", 30),
  };
}

const poster: Poster = {
  async submitPost(title, text) {
    const post = await reddit.submitPost({ subredditName: context.subredditName, title, text });
    return { id: post.id, url: permalink(post.permalink) };
  },
  async submitComment(parent, text) {
    const id = parent as `t1_${string}` | `t3_${string}`;
    const comment = await reddit.submitComment({ id, text });
    return { id: comment.id, url: permalink(comment.permalink) };
  },
  async subredditOf(thing) {
    return thing.startsWith("t3_")
      ? (await reddit.getPostById(thing as `t3_${string}`)).subredditName
      : (await reddit.getCommentById(thing as `t1_${string}`)).subredditName;
  },
};

/** Undefined (with the reason logged) until the bot token, channel and agent ID are set. */
export async function bridgeDeps(): Promise<Deps | undefined> {
  const [token, channelId, cfg] = await Promise.all([
    text("discordBotToken"),
    text("outboxChannelId"),
    config(),
  ]);
  if (!token || !channelId || !cfg.agentAuthorId) {
    console.log("bridge: set discordBotToken, outboxChannelId and agentAuthorId to start polling");
    return undefined;
  }
  return {
    kv: redis,
    outbox: botOutbox(token, channelId),
    reddit: poster,
    config: cfg,
    now: Date.now,
  };
}

async function fetchItem(thing: string): Promise<InboxItem | undefined> {
  if (thing.startsWith("t3_")) {
    const post = await reddit.getPostById(thing as `t3_${string}`);
    const url = permalink(post.permalink);
    return {
      kind: "post",
      thing: post.id,
      author: post.authorName,
      title: post.title,
      ...(post.url && post.url !== url ? { link: post.url } : {}),
      url,
      created: post.createdAt,
      text: post.body ?? "",
      visible: !post.removed && !post.spam && !post.removedByCategory,
    };
  }
  if (thing.startsWith("t1_")) {
    const comment = await reddit.getCommentById(thing as `t1_${string}`);
    return {
      kind: "comment",
      thing: comment.id,
      post: comment.postId,
      parent: comment.parentId,
      author: comment.authorName,
      url: permalink(comment.permalink),
      created: comment.createdAt,
      text: comment.body,
      visible:
        !comment.removed && !comment.spam && !["[deleted]", "[removed]"].includes(comment.body),
    };
  }
  return undefined;
}

/** Undefined until the inbox webhook is set. */
export async function inboxDeps(): Promise<InboxDeps | undefined> {
  const url = await text("inboxWebhookUrl");
  if (!url) return undefined;
  return {
    kv: redis,
    webhook: inboxWebhook(url),
    fetchItem,
    appName: context.appSlug,
    now: Date.now,
  };
}

export async function isModerator(): Promise<boolean> {
  const { username, subredditName } = context;
  if (!username) return false;
  const found = await reddit.getModerators({ subredditName, username }).all();
  return found.some((user) => user.username.toLowerCase() === username.toLowerCase());
}
