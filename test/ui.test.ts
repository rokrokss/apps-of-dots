import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once } from "node:events";
import { request } from "node:http";
import { readFile, stat, writeFile, copyFile, chmod } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./helpers.js";
import { createSetupService } from "../src/ui/service.js";
import { startWebUi } from "../src/ui/server.js";
import { loadConfig, secretPaths } from "../discord/src/config.js";
import { controlDiscord } from "../discord/src/service.js";
import { telegram } from "../telegram/src/index.js";
import { whatsapp } from "../whatsapp/src/index.js";
import { fakeInstallation, unusedPort } from "../packages/managed-mcp/test/helpers.js";
import { withAppLock } from "../packages/managed-mcp/src/process.js";

async function webFixture(
  t: TestContext,
  verify = async (_token: string) => ({ id: "123", username: "fixture-bot" }),
  options: Parameters<typeof createSetupService>[1] = {},
) {
  const { home, binary } = await fixture(t);
  const oldPath = process.env.PATH;
  process.env.PATH = home + delimiter + oldPath;
  t.after(() => {
    process.env.PATH = oldPath;
  });
  const service = createSetupService(home, { verify, ...options });
  const ui = await startWebUi({ home, port: 0, service });
  t.after(async () => {
    await service.close();
    if (!ui.server.listening) return;
    const closed = once(ui.server, "close");
    ui.server.close();
    ui.server.closeAllConnections();
    await closed;
  });
  const api = async (path = "/api/state", body?: unknown, extra: Record<string, string> = {}) => {
    const response = await fetch(ui.origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${ui.token}`,
        Origin: ui.origin,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const finished = async () => {
    for (let i = 0; i < 100; i++) {
      const result = await api();
      if (result.body.job?.status !== "running") return result.body;
      await delay(30);
    }
    throw new Error("UI job did not finish.");
  };
  return { ...ui, home, binary, api, finished, service };
}
const input = {
  tunnelId: "tunnel_web",
  botToken: "private-bot-fixture",
  tunnelKey: "private-key-fixture",
  guilds: "all",
};

test("local UI serves assets, gates its API, and rejects foreign origins and hosts", async (t) => {
  const ui = await webFixture(t);
  assert.equal((ui.server.address() as { address: string }).address, "127.0.0.1");
  const html = await fetch(ui.origin + "/");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Connected to your dot/);
  assert.match(html.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(ui.origin + "/app.js")).status, 200);
  assert.equal((await fetch(ui.origin + "/api/state")).status, 401);
  assert.equal(
    (await ui.api("/api/state", undefined, { Origin: "https://evil.example" })).status,
    403,
  );
  assert.equal(
    (await ui.api("/api/state", undefined, { "Sec-Fetch-Site": "cross-site" })).status,
    403,
  );
  const badHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      ui.origin + "/api/state",
      { headers: { Host: "evil.example", Authorization: `Bearer ${ui.token}` } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.once("error", reject);
    req.end();
  });
  assert.equal(badHost, 403);
  assert.equal((await ui.api("/api/unknown/start", {})).status, 404);
  assert.equal(
    (await ui.api("/api/discord/setup", { ...input, skipValidation: true })).status,
    400,
  );
  assert.equal(
    (await ui.api("/api/discord/setup", { ...input, tunnelClient: "/bin/sh" })).status,
    400,
  );
  assert.equal(
    (await ui.api("/api/discord/setup", { ...input, botToken: "x".repeat(25000) })).status,
    413,
  );
  assert.equal(
    (await ui.api("/api/discord/setup", input, { "Content-Type": "text/plain" })).status,
    415,
  );
  const state = (await ui.api()).body;
  assert.deepEqual(
    state.apps
      .filter((app: { kind: string }) => app.kind === "built-in")
      .map((app: { configured: boolean }) => app.configured),
    [false, false, false],
  );
  assert.equal(state.tunnelClientInstalled, true);
  assert.match(state.apps[1].commands.join("\n"), /telegram login/);
  assert.match(state.apps[2].commands.join("\n"), /whatsapp login/);
});

test(
  "web setup verifies, stores privately, starts, reuses saved keys, and shares CLI lifecycle",
  { timeout: 20_000 },
  async (t) => {
    const tokens: string[] = [];
    const ui = await webFixture(t, async (token) => {
      tokens.push(token);
      return { id: "123", username: "fixture" };
    });
    assert.equal((await ui.api("/api/discord/setup", input)).status, 202);
    let state = await ui.finished();
    assert.equal(state.job.status, "succeeded");
    assert.equal(state.apps[0].ready, true);
    assert.equal(state.apps[0].credentialsSaved, true);
    assert.deepEqual(tokens, [input.botToken]);
    for (const secret of [input.botToken, input.tunnelKey])
      assert.ok(!JSON.stringify(state).includes(secret));
    assert.equal(state.apps[0].logPath, undefined);
    const config = (await loadConfig(ui.home))!;
    assert.equal((await stat(join(ui.home, "discord", "config.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(secretPaths(ui.home, config).bot)).mode & 0o777, 0o600);
    assert.ok(
      !(await readFile(join(ui.home, "discord", "config.json"), "utf8")).includes(input.botToken),
    );
    assert.equal((await ui.api("/api/discord/setup", input)).status, 202);
    state = await ui.finished();
    assert.equal(state.job.status, "failed");
    assert.match(state.job.message, /Stop it/);
    assert.equal((await ui.api("/api/discord/stop", {})).status, 202);
    state = await ui.finished();
    assert.equal(state.apps[0].processRunning, false);
    assert.equal(
      (
        await ui.api("/api/discord/setup", {
          tunnelId: input.tunnelId,
          botToken: "",
          tunnelKey: "",
          guilds: "all",
        })
      ).status,
      202,
    );
    state = await ui.finished();
    assert.equal(state.job.status, "succeeded");
    assert.deepEqual(tokens, [input.botToken, input.botToken]);
    const calls = await readFile(join(ui.home, "tunnel-state", "calls.jsonl"), "utf8");
    assert.match(calls, /file:/);
    assert.ok(!calls.includes(input.botToken));
    assert.ok(!calls.includes(input.tunnelKey));
    await controlDiscord(ui.home, "stop");
    assert.equal((await ui.api()).body.apps[0].processRunning, false);
    await controlDiscord(ui.home, "start");
    // Closing the management server must not stop the independently managed MCP.
    const closed = once(ui.server, "close");
    ui.server.close();
    ui.server.closeAllConnections();
    await closed;
    const saved = JSON.parse(
      await readFile(join(ui.home, "tunnel-state", "fixture-apps-of-dots-discord.json"), "utf8"),
    );
    assert.equal(saved.process_running, true);
  },
);

test("jobs survive client refresh and prevent concurrent writes; errors never echo credentials", async (t) => {
  let release!: () => void;
  let entered!: () => void;
  const verifying = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ui = await webFixture(t, async () => {
    entered();
    await gate;
    throw new Error(`untrusted error ${input.botToken} ${input.tunnelKey}`);
  });
  const first = await ui.api("/api/discord/setup", input);
  await verifying;
  const fresh = await ui.api();
  assert.equal(fresh.body.job.id, first.body.id);
  assert.equal(fresh.body.job.stage, "bot");
  assert.equal(fresh.body.job.status, "running");
  assert.equal((await ui.api("/api/discord/stop", {})).status, 409);
  await assert.rejects(controlDiscord(ui.home, "start"), /in use/);
  release();
  const state = await ui.finished();
  assert.equal(state.job.status, "failed");
  assert.match(state.job.message, /verify the Discord bot/);
  assert.equal(state.apps[0].configured, false);
  assert.ok(!JSON.stringify(state).includes(input.botToken));
  assert.ok(!JSON.stringify(state).includes(input.tunnelKey));
});

test("a running but pending tunnel stays distinct from readiness and can recover", async (t) => {
  const ui = await webFixture(t);
  process.env.FIXTURE_READY = "false";
  t.after(() => {
    delete process.env.FIXTURE_READY;
  });
  await ui.api("/api/discord/setup", input);
  const state = await ui.finished();
  assert.equal(state.job.status, "succeeded");
  assert.equal(state.apps[0].processRunning, true);
  assert.equal(state.apps[0].ready, false);
  assert.match(state.job.message, /Waiting/);
  await writeFile(
    join(ui.home, "tunnel-state", "fixture-apps-of-dots-discord.json"),
    JSON.stringify({ runtime_state: "ready", process_running: true, healthy: true, ready: true }),
  );
  assert.equal((await ui.api()).body.apps[0].ready, true);
});

async function personalFixture(
  t: TestContext,
  app: "telegram" | "whatsapp",
  options: { expiresMs?: number; loginTimeoutMs?: number } = {},
) {
  const ui = await webFixture(t, undefined, { loginTimeoutMs: options.loginTimeoutMs });
  const integration = app === "telegram" ? telegram : whatsapp;
  const paths = await fakeInstallation(ui.home, integration.source);
  await copyFile(
    new URL("./fixtures/web-login.mjs", import.meta.url),
    app === "telegram" ? paths.python : paths.bridge,
  );
  await chmod(app === "telegram" ? paths.python : paths.bridge, 0o700);
  const directory = join(ui.home, app, ...(app === "whatsapp" ? ["data"] : []));
  await writeFile(join(directory, "login-fixture.json"), JSON.stringify(options));
  let actionId = 0;
  const action = (type: string) =>
    writeFile(join(directory, "login-action.json"), JSON.stringify({ id: ++actionId, type }));
  const waitJob = async (match: (job: any) => boolean) => {
    for (let i = 0; i < 150; i++) {
      const state = (await ui.api()).body;
      if (state.jobs[app] && match(state.jobs[app])) return state.jobs[app];
      await delay(25);
    }
    throw new Error(`Timed out: ${JSON.stringify((await ui.api()).body.jobs[app])}`);
  };
  const setup = await ui.api(`/api/${app}/setup`, {
    tunnelId: `tunnel_${app}`,
    tunnelKey: "private-personal-key",
    ...(app === "telegram"
      ? { apiId: "12345", apiHash: "a".repeat(32) }
      : { bridgePort: String(await unusedPort()) }),
  });
  assert.equal(setup.status, 202);
  const qr = await waitJob((job) => Boolean(job.qr));
  const pid = Number(await readFile(join(directory, "login.pid"), "utf8"));
  const qrPath = (job: any) => `/api/${app}/qr?jobId=${job.id}&version=${job.qr.version}`;
  return { ...ui, directory, action, waitJob, qr, pid, qrPath };
}
function assertExited(pid: number) {
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

test(
  "Telegram web login rotates private QR codes, retries two-step passwords and starts only after authentication",
  { timeout: 20_000 },
  async (t) => {
    const ui = await personalFixture(t, "telegram");
    const first = ui.qr;
    assert.equal((await fetch(ui.origin + ui.qrPath(first))).status, 401);
    const image = await ui.api(ui.qrPath(first));
    assert.match(image.body.image, /^data:image\/png;base64,/);
    let state = (await ui.api()).body;
    assert.ok(!JSON.stringify(state).includes("private-fixture-qr"));
    assert.ok(!JSON.stringify(state).includes("data:image"));
    assert.equal(state.apps[1].processRunning, false);
    await assert.rejects(
      withAppLock(ui.home, "telegram", async () => {}),
      /in use/,
    );
    assert.equal((await ui.api("/api/telegram/start", {})).status, 409);
    // A different app can be configured while Telegram is waiting for the phone.
    assert.equal((await ui.api("/api/discord/setup", input)).status, 202);
    await ui.action("rotate");
    const second = await ui.waitJob((job) => job.qr?.version > first.qr.version);
    assert.equal((await ui.api(ui.qrPath(first))).status, 410);
    assert.notEqual((await ui.api(ui.qrPath(second))).body.image, image.body.image);
    await ui.action("password");
    const challenge = await ui.waitJob((job) => job.stage === "password");
    assert.equal((await ui.api(ui.qrPath(second))).status, 410);
    assert.equal(
      (
        await ui.api("/api/telegram/password", {
          jobId: "stale",
          requestId: challenge.passwordRequestId,
          password: "wrong",
        })
      ).status,
      409,
    );
    const answer = {
      jobId: challenge.id,
      requestId: challenge.passwordRequestId,
      password: "wrong",
    };
    assert.equal((await ui.api("/api/telegram/password", answer)).status, 202);
    const retry = await ui.waitJob(
      (job) => job.stage === "password" && job.passwordRequestId !== challenge.passwordRequestId,
    );
    assert.match(retry.message, /not accepted/);
    assert.equal((await ui.api("/api/telegram/password", answer)).status, 409);
    assert.equal(
      (
        await ui.api("/api/telegram/password", {
          jobId: retry.id,
          requestId: retry.passwordRequestId,
          password: "fixture-two-step-secret",
        })
      ).status,
      202,
    );
    await ui.waitJob((job) => job.status === "succeeded");
    assertExited(ui.pid);
    state = (await ui.api()).body;
    assert.equal(state.apps[1].ready, true);
    assert.equal(state.apps[1].sessionSaved, true);
    assert.ok(!JSON.stringify(state).includes("fixture-two-step-secret"));
    const calls = await readFile(join(ui.home, "tunnel-state", "calls.jsonl"), "utf8");
    assert.ok(!calls.includes("fixture-two-step-secret"));
    assert.ok(!calls.includes("private-personal-key"));
    assert.ok(!calls.includes("a".repeat(32)));
    assert.equal((await ui.api(ui.qrPath(second))).status, 409);
    await withAppLock(ui.home, "telegram", async () => {});
  },
);

test(
  "expired QR is unavailable; cancellation kills the login process and preserves setup for retry",
  { timeout: 15_000 },
  async (t) => {
    const ui = await personalFixture(t, "telegram", { expiresMs: 600 });
    await delay(650);
    assert.equal((await ui.api(ui.qrPath(ui.qr))).status, 410);
    assert.equal((await ui.api()).body.jobs.telegram.qr, undefined);
    assert.equal((await ui.api("/api/telegram/cancel", { jobId: ui.qr.id })).status, 202);
    await ui.waitJob((job) => job.status === "cancelled");
    assertExited(ui.pid);
    const state = (await ui.api()).body;
    assert.equal(state.apps[1].configured, true);
    assert.equal(state.apps[1].sessionSaved, false);
    assert.equal(state.apps[1].processRunning, false);
    await withAppLock(ui.home, "telegram", async () => {});
    assert.equal((await ui.api("/api/telegram/login", {})).status, 202);
    const next = await ui.waitJob((job) => job.id !== ui.qr.id && Boolean(job.qr));
    assert.equal((await ui.api("/api/telegram/cancel", { jobId: ui.qr.id })).status, 409);
    await ui.api("/api/telegram/cancel", { jobId: next.id });
    await ui.waitJob((job) => job.status === "cancelled");
  },
);

test(
  "WhatsApp QR scan waits for authenticated bridge health before saving pairing and starting",
  { timeout: 15_000 },
  async (t) => {
    const ui = await personalFixture(t, "whatsapp");
    await ui.action("rotate");
    const next = await ui.waitJob((job) => job.qr?.version > ui.qr.qr.version);
    assert.equal((await ui.api(ui.qrPath(ui.qr))).status, 410);
    await ui.action("scanned");
    await ui.waitJob((job) => job.stage === "login");
    await delay(400);
    const pending = (await ui.api()).body;
    assert.equal(pending.jobs.whatsapp.status, "running");
    assert.equal(pending.apps[2].sessionSaved, false);
    assert.equal(pending.apps[2].processRunning, false);
    assert.equal((await ui.api(ui.qrPath(next))).status, 410);
    await ui.action("approve");
    await ui.waitJob((job) => job.status === "succeeded");
    assertExited(ui.pid);
    const state = (await ui.api()).body;
    assert.equal(state.apps[2].ready, true);
    assert.equal(state.apps[2].sessionSaved, true);
    assert.equal((await stat(join(ui.directory, "paired.json"))).mode & 0o777, 0o600);
  },
);

test(
  "login deadline and setup-center shutdown clean up children and never start a tunnel",
  { timeout: 15_000 },
  async (t) => {
    const timed = await personalFixture(t, "telegram", { loginTimeoutMs: 1500 });
    const failed = await timed.waitJob((job) => job.status === "failed");
    assert.match(failed.message, /timed out/);
    assertExited(timed.pid);
    assert.equal((await timed.api()).body.apps[1].processRunning, false);
    const closing = await personalFixture(t, "whatsapp");
    const closed = once(closing.server, "close");
    closing.server.close();
    closing.server.closeAllConnections();
    await closed;
    for (let i = 0; i < 100; i++) {
      if ((await closing.service.snapshot()).jobs.whatsapp!.status !== "running") break;
      await delay(25);
    }
    assertExited(closing.pid);
    const state = await closing.service.snapshot();
    assert.equal(state.jobs.whatsapp!.status, "cancelled");
    assert.equal(state.apps[2]!.processRunning, false);
    await withAppLock(closing.home, "whatsapp", async () => {});
  },
);
