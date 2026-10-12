// The agent's side of PROTOCOL.md (v1). `frame` and its helpers are copied from the bridge
// (devvit/src/protocol.ts) rather than shared, because the Devvit CLI installs that package
// with npm on its own; test/protocol.test.ts fails if the copies drift apart.

export const MAX_TEXT = 6_000;
export const MAX_TITLE = 300;
const MAX_CONTENT = 2_000;
const MAX_EMBED_DESCRIPTION = 4_096;
export const REF = /^[A-Za-z0-9._-]{1,64}$/;
export const PARENT = /^t[13]_[a-z0-9]+$/;

export type Framed = { content: string; embeds: { description: string }[] };

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

/** The JSON envelope and full text of a protocol message, or undefined if it is not one. */
export function readMessage(message: {
  content: string;
  embeds?: { description?: string }[];
}): { envelope: Record<string, unknown>; text: string } | undefined {
  let envelope: unknown;
  try {
    envelope = JSON.parse(message.content);
  } catch {
    return undefined;
  }
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope))
    return undefined;
  const e = envelope as Record<string, unknown>;
  if (e.v !== 1) return undefined;
  const inline = typeof e.text === "string" ? e.text : "";
  const text = inline + (message.embeds ?? []).map((x) => x.description ?? "").join("");
  return { envelope: e, text };
}
