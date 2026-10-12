// A draft is a Discord message whose content is JSON: {"title": "...", "text": "..."}.
// A ```json fenced block is accepted too, since that is how people (and agents) paste JSON.

export type Draft = { title: string; text: string };
export type ParseResult = { ok: true; draft: Draft } | { ok: false; error: string };

const MAX_TITLE = 300;
const MAX_TEXT = 40_000;

export function parseDraft(content: string): ParseResult {
  const fenced = content.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  const raw = (fenced?.[1] ?? content).trim();
  if (!raw) return { ok: false, error: "message content is empty (is Message Content intent on?)" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "message is not JSON" };
  }
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "JSON is not an object" };
  }

  const { title, text } = value as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim()) return { ok: false, error: 'missing "title"' };
  if (title.length > MAX_TITLE) {
    return { ok: false, error: `title is over ${MAX_TITLE} characters` };
  }
  if (text !== undefined && typeof text !== "string") {
    return { ok: false, error: '"text" must be a string' };
  }
  if ((text ?? "").length > MAX_TEXT) {
    return { ok: false, error: `text is over ${MAX_TEXT} characters` };
  }

  return { ok: true, draft: { title: title.trim(), text: text ?? "" } };
}
