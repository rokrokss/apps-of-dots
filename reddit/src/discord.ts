import type { Framed } from "./protocol.js";

// The Discord REST calls the agent needs. Mentions are disabled on everything it sends.

export type ApiMessage = {
  id: string;
  content: string;
  author: { id: string };
  webhook_id?: string;
  embeds?: { description?: string }[];
  message_reference?: { message_id?: string };
};

export interface DiscordApi {
  /** The bot's own user ID. */
  me(): Promise<string>;
  send(channelId: string, message: Framed): Promise<string>;
  /** Up to 100 messages, newest first, optionally before or after a message ID. */
  messages(
    channelId: string,
    page: { before?: string; after?: string; limit: number },
  ): Promise<ApiMessage[]>;
}

const API = "https://discord.com/api/v10";
const MAX_RETRY_WAIT_MS = 5_000;

export function restDiscord(token: string): DiscordApi {
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 && attempt === 0) {
        const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
        const waitMs = (body.retry_after ?? Number(res.headers.get("retry-after") ?? 60)) * 1000;
        if (waitMs <= MAX_RETRY_WAIT_MS) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Discord ${init.method ?? "GET"} ${path.split("?")[0]} failed (HTTP ${res.status}). ${text.slice(0, 200)}`,
        );
      }
      return res.json();
    }
  }
  let self: Promise<string> | undefined;
  return {
    me() {
      self ??= call("/users/@me").then((user) => (user as { id: string }).id);
      return self;
    },
    async send(channelId, message) {
      const body = { ...message, allowed_mentions: { parse: [] } };
      const sent = (await call(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      })) as ApiMessage;
      return sent.id;
    },
    async messages(channelId, page) {
      const query = new URLSearchParams({ limit: String(page.limit) });
      if (page.before) query.set("before", page.before);
      if (page.after) query.set("after", page.after);
      return (await call(`/channels/${channelId}/messages?${query}`)) as ApiMessage[];
    },
  };
}
