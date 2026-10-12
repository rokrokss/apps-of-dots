import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { restDiscord, type ApiMessage, type DiscordApi } from "./discord.js";
import { frame, MAX_TEXT, MAX_TITLE, PARENT, readMessage, REF } from "./protocol.js";

// The Reddit MCP: five tools over the Discord channels of PROTOCOL.md. Nothing is stored
// locally; every read goes to Discord, so copies the bridge deletes are gone here too.

export const SERVER_VERSION = "0.1.0";
export const TOOL_COUNT = 5;
const SCAN_PAGES = 3;

export type Channels = { outboxChannelId: string; inboxChannelId: string; bridgeBotId: string };

type Draft = {
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

const reply = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const refField = z
  .string()
  .regex(REF, "1-64 characters of A-Z a-z 0-9 . _ -")
  .optional()
  .describe(
    "Your idempotency key. A ref the bridge has seen is never posted again. Generated if omitted.",
  );

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
async function drafts(discord: DiscordApi, channels: Channels): Promise<Draft[]> {
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

export function createServer(discord: DiscordApi, channels: Channels): McpServer {
  const server = new McpServer({ name: "apps-of-dots-reddit", version: SERVER_VERSION });
  const send = async (envelope: Record<string, unknown>, text: string) => {
    const messageId = await discord.send(channels.outboxChannelId, frame(envelope, text));
    return reply({
      ref: envelope.ref,
      state: "sent",
      messageId,
      next: "The bridge picks this up within a minute. Check it with reddit_get_draft.",
    });
  };

  server.registerTool(
    "reddit_submit_post",
    {
      title: "Submit a Reddit post",
      description:
        "Ask the bridge to publish a text post in its subreddit as the app account. In manual mode " +
        "it waits for a moderator's approval in Reddit; in auto mode it is posted within the " +
        "subreddit's daily cap and spacing. Returns at once; follow it with reddit_get_draft.",
      inputSchema: {
        title: z.string().trim().min(1).max(MAX_TITLE).describe("Post title, 1-300 characters."),
        text: z
          .string()
          .max(MAX_TEXT)
          .optional()
          .describe("Markdown body, up to 6,000 characters."),
        ref: refField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ title, text, ref }) =>
      send({ op: "post", ref: ref ?? `post-${randomUUID().slice(0, 8)}`, title }, text ?? ""),
  );

  server.registerTool(
    "reddit_reply",
    {
      title: "Reply on Reddit",
      description:
        "Ask the bridge to comment on a post (t3_…) or reply to a comment (t1_…) in its subreddit " +
        "as the app account, with the same approval as posts. Follow it with reddit_get_draft.",
      inputSchema: {
        parent: z
          .string()
          .regex(PARENT, "A t3_ post or t1_ comment ID")
          .describe("Post or comment ID."),
        text: z
          .string()
          .trim()
          .min(1)
          .max(MAX_TEXT)
          .describe("Markdown body, up to 6,000 characters."),
        ref: refField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ parent, text, ref }) =>
      send({ op: "reply", ref: ref ?? `reply-${randomUUID().slice(0, 8)}`, parent }, text),
  );

  server.registerTool(
    "reddit_get_draft",
    {
      title: "Get a draft's status",
      description:
        "State of a request by ref: sent (not picked up yet), queued (waiting for approval or " +
        "limits), posted (with url), rejected or failed (with reason), expired, or not_found " +
        "among the last 300 outbox messages.",
      inputSchema: { ref: z.string().regex(REF).describe("The ref returned when it was sent.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ ref }) =>
      reply(
        (await drafts(discord, channels)).find((d) => d.ref === ref) ?? { ref, state: "not_found" },
      ),
  );

  server.registerTool(
    "reddit_list_drafts",
    {
      title: "List recent drafts",
      description:
        "Recent requests and their states, newest first, from the last 300 outbox messages.",
      inputSchema: {
        state: z
          .enum(["sent", "queued", "posted", "rejected", "failed", "expired"])
          .optional()
          .describe("Only drafts in this state."),
        limit: z.int().min(1).max(100).default(20).describe("At most this many drafts."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ state, limit }) => {
      const list = (await drafts(discord, channels)).filter((d) => !state || d.state === state);
      return reply({ drafts: list.slice(0, limit) });
    },
  );

  server.registerTool(
    "reddit_list_activity",
    {
      title: "List subreddit activity",
      description:
        "New posts and comments in the bridge's subreddit, oldest first. Pass the returned cursor " +
        "as after to continue. Items deleted or removed on Reddit, and items older than 30 days, " +
        "are gone.",
      inputSchema: {
        after: z
          .string()
          .regex(/^\d{17,20}$/)
          .optional()
          .describe("Cursor from a previous call. Without it, the latest items are returned."),
        limit: z.int().min(1).max(100).default(25).describe("At most this many messages to read."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ after, limit }) => {
      const page = await discord.messages(channels.inboxChannelId, {
        limit,
        ...(after ? { after } : {}),
      });
      page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      const items = page.flatMap((message) => {
        // Only the bridge's webhook writes events; anything else in the channel is ignored.
        if (!message.webhook_id) return [];
        const read = readMessage(message);
        return read && typeof read.envelope.event === "string"
          ? [{ ...read.envelope, text: read.text }]
          : [];
      });
      return reply({ items, cursor: page.at(-1)?.id ?? after ?? null });
    },
  );
  return server;
}

/** Tool definitions, listed without contacting Discord. */
export async function inspectTools() {
  const offline: DiscordApi = {
    me: () => Promise.reject(new Error("offline")),
    send: () => Promise.reject(new Error("offline")),
    messages: () => Promise.reject(new Error("offline")),
  };
  const server = createServer(offline, {
    outboxChannelId: "0",
    inboxChannelId: "0",
    bridgeBotId: "0",
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "apps-of-dots-inspector", version: "0.1.0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

/** Serves the MCP on stdio until the client disconnects. */
export async function runServer(token: string, channels: Channels): Promise<number> {
  const server = createServer(restDiscord(token), channels);
  const transport = new StdioServerTransport();
  // The stdio transport only closes when asked; the tunnel ends a session by closing stdin.
  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.once("end", () => resolve());
  });
  await server.connect(transport);
  await closed;
  return 0;
}
