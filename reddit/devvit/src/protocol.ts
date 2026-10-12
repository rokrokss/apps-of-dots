// Message formats from reddit/PROTOCOL.md (v1). Everything here is pure so it can be tested
// without Devvit.

export const MAX_TEXT = 6_000;
export const MAX_TITLE = 300;
const MAX_CONTENT = 2_000;
const MAX_EMBED_DESCRIPTION = 4_096;
const REF = /^[A-Za-z0-9._-]{1,64}$/;
const PARENT = /^t[13]_[a-z0-9]+$/;

export type DiscordMessage = {
  id: string;
  authorId: string;
  content: string;
  embeds: { description?: string }[];
};

export type Request =
  | { op: "post"; ref: string; title: string; text: string }
  | { op: "reply"; ref: string; parent: string; text: string };

export type Reason =
  | "bad_request"
  | "unsupported_version"
  | "too_long"
  | "wrong_subreddit"
  | "duplicate"
  | "moderator"
  | "reddit_error";

export type ParseResult =
  { ok: true; request: Request } | { ok: false; reason: Reason; ref?: string; detail?: string };

export function parseRequest(message: Pick<DiscordMessage, "content" | "embeds">): ParseResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(message.content);
  } catch {
    return { ok: false, reason: "bad_request", detail: "content is not JSON" };
  }
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    return { ok: false, reason: "bad_request", detail: "content is not a JSON object" };
  }
  const e = envelope as Record<string, unknown>;
  const ref = typeof e.ref === "string" && REF.test(e.ref) ? e.ref : undefined;
  const fail = (reason: Reason, detail?: string): ParseResult => ({
    ok: false,
    reason,
    ...(ref ? { ref } : {}),
    ...(detail ? { detail } : {}),
  });

  if (e.v !== 1) return fail("unsupported_version");
  if (!ref) return fail("bad_request", "ref must be 1-64 characters of A-Z a-z 0-9 . _ -");
  if (e.text !== undefined && typeof e.text !== "string") return fail("bad_request", "bad text");
  const text =
    ((e.text as string | undefined) ?? "") +
    message.embeds.map((x) => x.description ?? "").join("");
  if (text.length > MAX_TEXT) return fail("too_long");

  if (e.op === "post") {
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title || title.length > MAX_TITLE)
      return fail("bad_request", "title must be 1-300 characters");
    return { ok: true, request: { op: "post", ref, title, text } };
  }
  if (e.op === "reply") {
    if (typeof e.parent !== "string" || !PARENT.test(e.parent)) {
      return fail("bad_request", "parent must be a t1_ or t3_ ID");
    }
    if (!text.trim()) return fail("bad_request", "text is required");
    return { ok: true, request: { op: "reply", ref, parent: e.parent, text } };
  }
  return fail("bad_request", "op must be post or reply");
}

export type Status = "queued" | "posted" | "rejected" | "failed" | "expired";

export type StatusFields = {
  ref?: string | undefined;
  status: Status;
  thing?: string | undefined;
  url?: string | undefined;
  edited?: boolean | undefined;
  reason?: Reason | undefined;
  detail?: string | undefined;
};

export function statusContent(s: StatusFields): string {
  return JSON.stringify({
    v: 1,
    ...(s.ref ? { ref: s.ref } : {}),
    status: s.status,
    ...(s.thing ? { thing: s.thing, url: s.url, edited: Boolean(s.edited) } : {}),
    ...(s.reason ? { reason: s.reason } : {}),
    ...(s.detail ? { detail: s.detail.slice(0, 300) } : {}),
  });
}

export type Framed = { content: string; embeds: { description: string }[] };

// Puts the text in `content` when it fits, otherwise in embed descriptions. Text over the cap
// is cut and the envelope gets `truncated: true`.
export function frame(envelope: Record<string, unknown>, text: string): Framed {
  const truncated = text.length > MAX_TEXT;
  const body = truncated ? sliceSafe(text, MAX_TEXT) : text;
  const head = { v: 1, ...envelope, truncated };
  const inline = JSON.stringify({ ...head, text: body });
  if (inline.length <= MAX_CONTENT) return { content: inline, embeds: [] };
  return {
    content: JSON.stringify(head),
    embeds: chunks(body, MAX_EMBED_DESCRIPTION).map((description) => ({ description })),
  };
}

// Never split a UTF-16 surrogate pair, so an emoji is not cut in half at a boundary.
function sliceSafe(text: string, end: number): string {
  const code = text.charCodeAt(end - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end);
}

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let rest = text; rest;) {
    const part = sliceSafe(rest, Math.min(size, rest.length));
    out.push(part);
    rest = rest.slice(part.length);
  }
  return out;
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

// Auto mode: at most `maxPerDay` executions in any 24 hours, `minMinutes` apart.
export function autoModeAllows(
  executedAt: number[],
  now: number,
  maxPerDay: number,
  minMinutes: number,
): boolean {
  const recent = executedAt.filter((t) => now - t < 24 * 60 * 60 * 1000);
  if (recent.length >= maxPerDay) return false;
  const last = Math.max(0, ...recent);
  return now - last >= minMinutes * 60 * 1000;
}
