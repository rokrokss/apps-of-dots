import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { restDiscord, type DiscordApi } from "./discord.js";
import { drafts, watchDrafts } from "./drafts.js";
import { EventHub, stateFile } from "./events.js";
import { isModern, modernHandler } from "./modern.js";
import { frame, MAX_TEXT, MAX_TITLE, PARENT, readMessage, REF } from "./protocol.js";

// The Reddit MCP: seven tools over the Discord channels of PROTOCOL.md. Reddit content is not
// stored locally; every read goes to Discord, so copies the bridge deletes are gone here too.
// Only the event inbox (draft states and links) is kept, by the tunnel's server.

export const SERVER_VERSION = "0.1.0";
export const TOOL_COUNT = 7;
export type Channels = { outboxChannelId: string; inboxChannelId: string; bridgeBotId: string };

const reply = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const noEvents = {
  isError: true,
  content: [
    {
      type: "text" as const,
      text: "MCP events are kept by the tunnel's server only (apps-of-dots reddit start).",
    },
  ],
};

const refField = z
  .string()
  .regex(REF, "1-64 characters of A-Z a-z 0-9 . _ -")
  .optional()
  .describe(
    "Your idempotency key. A ref the bridge has seen is never posted again. Generated if omitted.",
  );

export function createServer(
  discord: DiscordApi,
  channels: Channels,
  events?: EventHub,
): McpServer {
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

  server.registerTool(
    "reddit_get_pending_events",
    {
      title: "Get pending Reddit events",
      description:
        "Unacknowledged reddit.draft.finished events, oldest first, each with its draft's ref, " +
        "state and url or reason. Call it every time the event fires, with or without its data, " +
        "then call reddit_acknowledge_events with the eventIds you finished.",
      inputSchema: {
        limit: z.int().min(1).max(20).default(10).describe("At most this many events."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => (events ? reply({ events: events.pending(limit) }) : noEvents),
  );

  server.registerTool(
    "reddit_acknowledge_events",
    {
      title: "Acknowledge Reddit events",
      description:
        "Mark finished events, by their eventIds from reddit_get_pending_events, so " +
        "reddit_get_pending_events stops returning them.",
      inputSchema: {
        eventIds: z.array(z.string().min(1)).min(1).max(20).describe("Event IDs to acknowledge."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ eventIds }) => (events ? reply(await events.acknowledge(eventIds)) : noEvents),
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

/**
 * Serves the MCP on stdio until the client disconnects. With a data directory (the tunnel's
 * server) it also runs MCP Events.
 */
export async function runServer(token: string, channels: Channels, home?: string): Promise<number> {
  const discord = restDiscord(token);
  const hub = home ? await EventHub.open({ file: stateFile(home) }) : undefined;
  let stopWatching = () => {};
  if (hub) {
    hub.start();
    stopWatching = watchDrafts(hub, discord, channels);
  }
  await serve(discord, channels, hub, process.stdin, process.stdout);
  stopWatching();
  hub?.stop();
  return 0;
}

/**
 * Answers JSON-RPC lines from input until it ends. With an event hub, MCP 2026-07-28 requests
 * go to the handler and every other line goes on to the SDK server unchanged.
 */
export async function serve(
  discord: DiscordApi,
  channels: Channels,
  hub: EventHub | undefined,
  input: Readable,
  output: Writable,
): Promise<void> {
  const server = createServer(discord, channels, hub);
  const legacy = new PassThrough();
  const transport = new StdioServerTransport(hub ? legacy : input, output);
  if (hub) {
    const tools = createServer(discord, channels, hub);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "apps-of-dots-reddit-modern", version: SERVER_VERSION });
    await tools.connect(serverSide);
    await client.connect(clientSide);
    const respond = modernHandler(client, hub, SERVER_VERSION);
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        message = undefined;
      }
      if (isModern(message))
        void respond(message).then((response) => output.write(JSON.stringify(response) + "\n"));
      else legacy.write(line + "\n");
    });
    lines.on("close", () => legacy.end());
  }
  // The stdio transport only closes when asked; the tunnel ends a session by closing stdin.
  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    input.once("end", () => resolve());
  });
  await server.connect(transport);
  await closed;
}
