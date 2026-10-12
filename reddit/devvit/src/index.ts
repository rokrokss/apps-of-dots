import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { createServer, getServerPort } from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import { poll } from "./bridge.js";
import { bridgeDeps, inboxDeps } from "./devvit.js";
import { onCreated, onDeleted, onUpdated, sweep, type InboxDeps } from "./inbox.js";
import { openReview, submitReview } from "./review.js";

const app = new Hono();

// Scheduled jobs and triggers log failures and answer 200; the next run, or the inbox sweep,
// picks up what was missed.
async function run(c: Context, label: string, job: () => Promise<void>) {
  try {
    await job();
  } catch (error) {
    console.error(`${label} failed`, error);
  }
  return c.json({}, 200);
}

app.post("/internal/scheduler/poll", (c) =>
  run(c, "poll", async () => {
    const deps = await bridgeDeps();
    if (deps) await poll(deps);
  }),
);

app.post("/internal/scheduler/sweep", (c) =>
  run(c, "sweep", async () => {
    const deps = await inboxDeps();
    if (deps) await sweep(deps);
  }),
);

type Handler = (deps: InboxDeps, thing: string) => Promise<void>;
const triggers: [string, Handler, (body: Record<string, any>) => string | undefined][] = [
  ["post-create", onCreated, (b) => b.post?.id],
  ["comment-create", onCreated, (b) => b.comment?.id],
  ["post-update", onUpdated, (b) => b.post?.id],
  ["comment-update", onUpdated, (b) => b.comment?.id],
  ["post-delete", onDeleted, (b) => b.postId],
  ["comment-delete", onDeleted, (b) => b.commentId],
];
for (const [name, handler, thingOf] of triggers) {
  app.post(`/internal/triggers/${name}`, (c) =>
    run(c, name, async () => {
      const thing = thingOf(await c.req.json());
      const deps = await inboxDeps();
      if (deps && thing) await handler(deps, thing);
    }),
  );
}

app.post("/internal/menu/review", async (c) => c.json<UiResponse>(await openReview(), 200));
app.post("/internal/form/review", async (c) =>
  c.json<UiResponse>(await submitReview(await c.req.json()), 200),
);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
