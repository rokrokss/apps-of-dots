import { context, reddit, redis } from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import { decide, oldestQueued } from "./bridge.js";
import { bridgeDeps, isModerator } from "./devvit.js";
import { acquireLock, keys, releaseLock, type Draft } from "./store.js";

// Manual approval: a moderator menu action opens the oldest queued draft in a form.

type Form = NonNullable<UiResponse["showForm"]>["form"];
type ReviewValues = { title?: string; text?: string; decision?: string | string[]; note?: string };

const toast = (text: string): UiResponse => ({ showToast: text });

async function parentPreview(parent: string): Promise<string> {
  try {
    const item = parent.startsWith("t3_")
      ? await reddit.getPostById(parent as `t3_${string}`)
      : await reddit.getCommentById(parent as `t1_${string}`);
    const body = "title" in item ? `${item.title}\n${item.body ?? ""}` : item.body;
    return `https://www.reddit.com${item.permalink}\n\n${body.slice(0, 500)}`;
  } catch {
    return `${parent} (could not load it)`;
  }
}

async function reviewForm(draft: Draft, waiting: number): Promise<Form> {
  const content =
    draft.op === "post"
      ? [
          {
            type: "string",
            name: "title",
            label: "Title",
            defaultValue: draft.title,
            required: true,
          },
          { type: "paragraph", name: "text", label: "Text", defaultValue: draft.text },
        ]
      : [
          {
            type: "paragraph",
            name: "parent",
            label: "Replying to",
            defaultValue: await parentPreview(draft.parent),
            disabled: true,
          },
          {
            type: "paragraph",
            name: "text",
            label: "Reply",
            defaultValue: draft.text,
            required: true,
          },
        ];
  return {
    title: `Draft "${draft.ref}" (${waiting} waiting)`,
    fields: [
      ...content,
      {
        type: "select",
        name: "decision",
        label: "Decision",
        options: [
          { label: "Approve and post as the app", value: "approve" },
          { label: "Reject", value: "reject" },
        ],
        defaultValue: ["approve"],
        required: true,
      },
      { type: "string", name: "note", label: "Note for the agent (when rejecting)" },
    ],
    acceptLabel: "Submit",
    cancelLabel: "Cancel",
  } as Form;
}

export async function openReview(): Promise<UiResponse> {
  // The menu's moderator flag hides the item but is not a security boundary.
  if (!(await isModerator())) return toast("Only moderators can review drafts.");
  const deps = await bridgeDeps();
  if (!deps) return toast("The bridge is not configured yet.");
  const next = await oldestQueued(deps);
  if (!next) return toast("No drafts waiting.");
  await redis.set(keys.review(context.userId ?? ""), next.draft.ref);
  await redis.expire(keys.review(context.userId ?? ""), 60 * 60);
  return { showForm: { name: "reviewDraft", form: await reviewForm(next.draft, next.waiting) } };
}

export async function submitReview(values: ReviewValues): Promise<UiResponse> {
  if (!(await isModerator())) return toast("Only moderators can review drafts.");
  const deps = await bridgeDeps();
  if (!deps) return toast("The bridge is not configured yet.");
  const reviewKey = keys.review(context.userId ?? "");
  const ref = await redis.get(reviewKey);
  if (!ref) return toast("This review expired. Open Review bridge drafts again.");

  // Hold the poll lock so an auto-mode run cannot post the same draft at the same time.
  if (!(await acquireLock(deps.kv, deps.now())))
    return toast("The bridge is busy. Try again shortly.");
  try {
    const decision = Array.isArray(values.decision) ? values.decision[0] : values.decision;
    const result =
      decision === "reject"
        ? await decide(deps, ref, { approve: false, ...(values.note ? { note: values.note } : {}) })
        : await decide(deps, ref, {
            approve: true,
            ...(values.title !== undefined ? { title: values.title } : {}),
            text: values.text ?? "",
          });
    await redis.del(reviewKey);
    return toast(result);
  } finally {
    await releaseLock(deps.kv);
  }
}
