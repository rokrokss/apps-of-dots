import { context, reddit, settings } from "@devvit/web/server";
import { parseDraft } from "./draft.js";

// One manual run of the bridge's risky steps, each reported separately so a failure says which
// question it answers: (1) can this app fetch discord.com, (2) does the bot see message content,
// (3) can the app account post here.
//
// Deliberately reads only the newest message (limit=1). The real bridge must page with an
// `after=` cursor, or messages arriving between polls are lost.

type DiscordMessage = { id: string; content: string; author: { id: string } };

export async function runProbe(): Promise<string> {
  const [token, channelId, allowedAuthorId] = await Promise.all([
    settings.get<string>("discordBotToken"),
    settings.get<string>("discordChannelId"),
    settings.get<string>("allowedAuthorId"),
  ]);
  if (!token) return "Setup: discordBotToken is not set (npx devvit settings set discordBotToken)";
  if (!channelId) return "Setup: set discordChannelId in the app install settings";

  let message: DiscordMessage | undefined;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=1`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`probe 1/3 Discord HTTP ${res.status}: ${body}`);
      return `1/3 Discord fetch: HTTP ${res.status}`;
    }
    message = ((await res.json()) as DiscordMessage[])[0];
  } catch (error) {
    // Devvit's fetch throws on blocked domains and HTTP errors instead of returning ok=false.
    console.error("probe 1/3 Discord fetch threw", error);
    return `1/3 Discord fetch: ${(error as Error).message}`;
  }
  if (!message) return "1/3 Discord fetch OK, but the channel has no messages";

  if (allowedAuthorId && message.author.id !== allowedAuthorId) {
    return `2/3 parse: newest message is from ${message.author.id}, not the allowed author`;
  }
  const parsed = parseDraft(message.content);
  if (!parsed.ok) {
    console.error(`probe 2/3 message ${message.id}: ${parsed.error}`);
    return `2/3 parse: ${parsed.error}`;
  }

  const { subredditName } = context;
  if (!subredditName) return "3/3 context has no subredditName";
  try {
    const post = await reddit.submitPost({
      subredditName,
      title: parsed.draft.title,
      text: parsed.draft.text,
    });
    console.log(`probe 3/3 posted ${post.id} from Discord message ${message.id}`);
    return `3/3 posted as the app account: ${post.url}`;
  } catch (error) {
    console.error("probe 3/3 submitPost threw", error);
    return `3/3 submitPost: ${(error as Error).message}`;
  }
}
