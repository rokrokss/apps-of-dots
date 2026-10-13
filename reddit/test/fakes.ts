import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type Channels } from "../src/server.js";
import type { ApiMessage, DiscordApi } from "../src/discord.js";
import type { EventHub } from "../src/events.js";
import type { Framed } from "../src/protocol.js";

export const AGENT = "900000000000000001";
export const BRIDGE = "900000000000000002";
export const channels: Channels = {
  outboxChannelId: "800000000000000001",
  inboxChannelId: "800000000000000002",
  bridgeBotId: BRIDGE,
};

/** Discord channels in memory, returning pages newest first like the REST API. */
export class FakeDiscord implements DiscordApi {
  stored = new Map<string, ApiMessage[]>();
  private nextId = 100000000000000000n;

  add(channelId: string, message: Omit<ApiMessage, "id">): string {
    const id = String(this.nextId++);
    this.stored.set(channelId, [...(this.stored.get(channelId) ?? []), { id, ...message }]);
    return id;
  }
  async me() {
    return AGENT;
  }
  async send(channelId: string, message: Framed) {
    return this.add(channelId, { author: { id: AGENT }, ...message });
  }
  async messages(channelId: string, page: { before?: string; after?: string; limit: number }) {
    let list = [...(this.stored.get(channelId) ?? [])];
    if (page.before) list = list.filter((m) => BigInt(m.id) < BigInt(page.before!));
    if (page.after) {
      // Discord returns the messages right after the cursor, still newest first.
      list = list.filter((m) => BigInt(m.id) > BigInt(page.after!)).slice(0, page.limit);
      return list.reverse();
    }
    return list.reverse().slice(0, page.limit);
  }
  async message(channelId: string, messageId: string) {
    return this.stored.get(channelId)?.find((m) => m.id === messageId);
  }
}

export async function connect(discord: DiscordApi, events?: EventHub) {
  const server = createServer(discord, channels, events);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    return result.isError ? { error: text } : JSON.parse(text);
  };
}
