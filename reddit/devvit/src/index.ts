import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createServer, getServerPort } from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import { runProbe } from "./probe.js";

const app = new Hono();

app.post("/internal/menu/probe", async (c) => {
  return c.json<UiResponse>({ showToast: await runProbe() }, 200);
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
