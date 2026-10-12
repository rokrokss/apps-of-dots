import type { Outbox } from "./bridge.js";
import type { Webhook } from "./inbox.js";
import type { DiscordMessage, Framed } from "./protocol.js";

// Discord REST calls for the bridge bot (outbox) and the inbox webhook. Mentions are disabled on
// everything the bridge sends, so Reddit text cannot ping anyone.

const API = "https://discord.com/api/v10";
const NO_MENTIONS = { parse: [] };
// A Devvit request has 30 seconds; wait out short rate limits, give up on long ones.
const MAX_RETRY_WAIT_MS = 5_000;

async function call(url: string, init: RequestInit = {}, allow404 = false): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status === 429 && attempt === 0) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const waitMs = (body.retry_after ?? Number(res.headers.get("retry-after") ?? 60)) * 1000;
      if (waitMs <= MAX_RETRY_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
    }
    if (res.ok || (allow404 && res.status === 404)) return res;
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${init.method ?? "GET"} ${res.status}: ${text.slice(0, 200)}`);
  }
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

type ApiMessage = {
  id: string;
  content: string;
  author: { id: string };
  embeds?: { description?: string }[];
};

const toMessage = (m: ApiMessage): DiscordMessage => ({
  id: m.id,
  authorId: m.author.id,
  content: m.content,
  embeds: m.embeds ?? [],
});

export function botOutbox(token: string, channelId: string): Outbox {
  const auth = { Authorization: `Bot ${token}` };
  const channel = `${API}/channels/${channelId}/messages`;
  return {
    async newestMessageId() {
      const res = await call(`${channel}?limit=1`, { headers: auth });
      return ((await res.json()) as ApiMessage[])[0]?.id;
    },
    async messagesAfter(after) {
      const all: DiscordMessage[] = [];
      for (let cursor = after; ;) {
        const res = await call(`${channel}?after=${cursor}&limit=100`, { headers: auth });
        const page = ((await res.json()) as ApiMessage[]).map(toMessage);
        page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        all.push(...page);
        if (page.length < 100) return all;
        cursor = page[page.length - 1]!.id;
      }
    },
    async reply(to, content) {
      const body = {
        content,
        message_reference: { message_id: to, fail_if_not_exists: false },
        allowed_mentions: NO_MENTIONS,
      };
      const res = await call(channel, { method: "POST", ...json(body, auth) });
      return ((await res.json()) as ApiMessage).id;
    },
    async edit(messageId, content) {
      await call(`${channel}/${messageId}`, { method: "PATCH", ...json({ content }, auth) });
    },
  };
}

export function inboxWebhook(url: string): Webhook {
  const payload = (m: Framed) => ({ ...m, allowed_mentions: NO_MENTIONS });
  return {
    async send(message) {
      const res = await call(`${url}?wait=true`, { method: "POST", ...json(payload(message)) });
      return ((await res.json()) as ApiMessage).id;
    },
    async edit(messageId, message) {
      await call(`${url}/messages/${messageId}`, { method: "PATCH", ...json(payload(message)) });
    },
    async remove(messageId) {
      // Already gone (deleted by hand, or an earlier try that timed out) counts as done. Devvit's
      // fetch may throw on HTTP errors instead of returning the response, so check both.
      try {
        await call(`${url}/messages/${messageId}`, { method: "DELETE" }, true);
      } catch (error) {
        if (!/\b404\b/.test(String(error))) throw error;
      }
    },
  };
}
