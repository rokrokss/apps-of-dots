import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import {
  configureDiscord,
  controlDiscord,
  discordRuntime,
  loadDiscordConfig,
  readDiscordSecrets,
  verifyBot,
  type SetupStage,
} from "@apps-of-dots/discord";
import { executable, quoteCommand, type RuntimeStatus } from "@apps-of-dots/runtime";
import {
  loadConfig,
  readSecrets,
  managedRuntime,
  requireStopped,
  requireInstallation,
  withAppLock,
  type ManagedIntegration,
  type LoginEvent,
} from "@apps-of-dots/managed-mcp";
import { telegram } from "@apps-of-dots/telegram";
import { whatsapp } from "@apps-of-dots/whatsapp";
import { integrations } from "../catalog.js";

export type AppId = "discord" | "telegram" | "whatsapp";
export interface AppView {
  id: string;
  name: string;
  kind: string;
  tools?: number;
  guide: string;
  configured: boolean;
  tunnelId?: string;
  guilds?: string;
  apiId?: string;
  bridgePort?: string;
  credentialsSaved?: boolean;
  sessionSaved?: boolean;
  processRunning?: boolean;
  healthy?: boolean;
  ready?: boolean;
  issue?: string;
  commands?: string[];
}
export interface Job {
  id: string;
  app: AppId;
  action: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  stage: SetupStage | "install" | "login" | "qr" | "password" | "connect" | "stop";
  message: string;
  qr?: { version: number; expiresAt: number };
  passwordRequestId?: string;
}
export interface Dashboard {
  apps: AppView[];
  tunnelClientInstalled: boolean;
  job: Job | null;
  jobs: Partial<Record<AppId, Job>>;
}
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
interface Operation {
  job: Job;
  abort: AbortController;
  send?: (requestId: string, password: string) => Promise<void>;
  image?: string;
  version: number;
  done?: Promise<void>;
  timedOut?: boolean;
}
function publicStatus(status: RuntimeStatus) {
  return { processRunning: status.processRunning, healthy: status.healthy, ready: status.ready };
}

export function createSetupService(
  home: string,
  options: {
    verify?: typeof verifyBot;
    // Injected only by offline tests; HTTP clients cannot change launchers or verification.
    managed?: Partial<Record<"telegram" | "whatsapp", ManagedIntegration>>;
    loginTimeoutMs?: number;
  } = {},
) {
  const managed = { telegram, whatsapp, ...options.managed };
  const operations = new Map<AppId, Operation>();
  let latest: Operation | undefined;
  let pendingSnapshot: Promise<Dashboard> | undefined;
  let closed = false;
  const cli = (app: string, action: string) =>
    `pnpm apps-of-dots --home ${quoteCommand([home])} ${app} ${action}`;
  const appName = (id: AppId) => (id === "discord" ? "Discord" : managed[id].name);
  const publicJob = (op: Operation): Job => ({
    ...op.job,
    qr: op.job.qr && op.job.qr.expiresAt > Date.now() ? { ...op.job.qr } : undefined,
  });

  async function appView(app: (typeof integrations)[number]): Promise<AppView> {
    const view: AppView = { ...app, configured: false };
    if (app.kind === "external") return view;
    view.commands = [
      "setup",
      ...(app.id === "discord" ? [] : ["login"]),
      "start",
      "status",
      "doctor",
    ].map((action) => cli(app.id, action));
    try {
      if (app.id === "discord") {
        const config = await loadDiscordConfig(home);
        if (!config) return view;
        Object.assign(view, {
          configured: true,
          tunnelId: config.tunnelId,
          guilds: config.allowedGuilds.join(", ") || "all",
        });
        view.credentialsSaved = await readDiscordSecrets(home, config).then(
          () => true,
          () => false,
        );
        Object.assign(view, publicStatus(await (await discordRuntime(home, config)).status()));
      } else {
        const config = await loadConfig(home, app.id);
        if (!config) return view;
        Object.assign(view, {
          configured: true,
          tunnelId: config.tunnelId,
          apiId: config.settings.apiId,
          bridgePort: config.settings.bridgePort,
        });
        view.credentialsSaved = await readSecrets(home, app.id, config).then(
          () => true,
          () => false,
        );
        view.sessionSaved = await managed[app.id].preflight(home).then(
          () => true,
          () => false,
        );
        Object.assign(
          view,
          publicStatus(await (await managedRuntime(home, managed[app.id], config)).status()),
        );
      }
      if (!view.credentialsSaved)
        view.issue =
          "Saved credentials are missing. Stop the tunnel if running, then enter your keys again.";
    } catch {
      view.issue = `Could not check this app. Run ${cli(app.id, "doctor")} for details.`;
    }
    return view;
  }
  async function snapshot(): Promise<Dashboard> {
    if (!pendingSnapshot) {
      pendingSnapshot = (async () => {
        const apps = await Promise.all(integrations.map(appView));
        const configs = await Promise.all([
          loadDiscordConfig(home).catch(() => undefined),
          loadConfig(home, "telegram").catch(() => undefined),
          loadConfig(home, "whatsapp").catch(() => undefined),
        ]);
        // Resolve each app's tunnel-client the way its setup does: saved path, else PATH.
        const paths = new Set(configs.map((config) => config?.tunnelClient || "tunnel-client"));
        const tunnelClientInstalled = (
          await Promise.all(
            [...paths].map((path) =>
              executable(path).then(
                () => true,
                () => false,
              ),
            ),
          )
        ).includes(true);
        return {
          apps,
          tunnelClientInstalled,
          job: latest ? publicJob(latest) : null,
          jobs: Object.fromEntries([...operations].map(([id, op]) => [id, publicJob(op)])),
        };
      })().finally(() => {
        pendingSnapshot = undefined;
      });
    }
    return pendingSnapshot;
  }
  function clearLogin(op: Operation) {
    delete op.image;
    delete op.job.qr;
    delete op.job.passwordRequestId;
    op.version++;
  }
  function launch(app: AppId, action: string, work: (op: Operation) => Promise<void>): Job {
    if (closed) throw new RequestError("The setup center is closing.", 503);
    if (operations.get(app)?.job.status === "running")
      throw new RequestError(
        `A ${appName(app)} operation is already running. Wait for it to finish.`,
        409,
      );
    const op: Operation = {
      job: {
        id: randomUUID(),
        app,
        action,
        status: "running",
        stage: action === "stop" ? "stop" : "runtime",
        message: "Preparing your connection…",
      },
      abort: new AbortController(),
      version: 0,
    };
    operations.set(app, op);
    latest = op;
    op.done = work(op)
      .then(() => {
        op.abort.signal.throwIfAborted();
        op.job.status = "succeeded";
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        if (op.abort.signal.aborted) {
          op.job.status = op.timedOut ? "failed" : "cancelled";
          op.job.message = op.timedOut
            ? "Login timed out. Start a new login to get a fresh QR code."
            : "Login cancelled. Your saved settings are kept.";
          return;
        }
        op.job.status = "failed";
        op.job.message = /Stop .*first|Stop Discord/.test(message)
          ? `${appName(app)} is running. Stop it below before changing its settings or signing in.`
          : /is in use/.test(message)
            ? `Another ${appName(app)} operation is running. Finish it and try again.`
            : {
                runtime:
                  "Could not prepare tunnel-client. Install or update it, then try again. Use the diagnostic command for details.",
                credentials:
                  "Check the tunnel ID and account credentials. For a new setup, all required fields must be filled in.",
                bot: "Could not verify the Discord bot. Check its bot token and your internet connection, then try again.",
                install: `Could not prepare ${appName(app)}. Install uv${app === "whatsapp" ? ", Go 1.26+ and a C compiler" : ""}, then try again. The diagnostic command can help.`,
                save: "Could not save settings. Check access to the private data folder and try again.",
                login:
                  "Login did not complete. Check your internet connection and account settings, then start a new login.",
                qr: "Login did not complete. Start a new login for a fresh QR code and approve it on your phone.",
                password:
                  "Telegram did not accept the login. Start a new login and check your two-step password.",
                connect:
                  "Settings are saved, but the tunnel could not start. Check your login, tunnel ID and runtime key, then retry.",
                stop: "Could not stop the tunnel. Use the diagnostic command, then try again.",
              }[op.job.stage];
      })
      .finally(() => {
        clearLogin(op);
        delete op.send;
      });
    return publicJob(op);
  }
  function loginEvent(op: Operation, event: LoginEvent) {
    if (op.abort.signal.aborted || op.job.status !== "running") return;
    clearLogin(op);
    if (event.type === "qr") {
      const version = op.version;
      op.job.stage = "qr";
      op.job.message =
        "Scan the QR code with the app on your phone. New codes appear here automatically.";
      const expiresAt = Math.min(event.expiresAt, Date.now() + 120_000);
      void QRCode.toDataURL(event.code, { errorCorrectionLevel: "M", margin: 4, width: 320 })
        .then((image) => {
          if (
            op.version !== version ||
            op.abort.signal.aborted ||
            op.job.status !== "running" ||
            expiresAt <= Date.now()
          )
            return;
          op.image = image;
          op.job.qr = { version, expiresAt };
        })
        .catch(() => op.abort.abort());
    } else if (event.type === "password") {
      op.job.stage = "password";
      op.job.passwordRequestId = event.requestId;
      op.job.message = event.retry
        ? "That password was not accepted. Enter your Telegram two-step password again."
        : "Your Telegram account uses a two-step password. Enter it below to finish signing in.";
    } else {
      op.job.stage = "login";
      op.job.message =
        event.type === "expired"
          ? "That QR code expired. Waiting for a fresh one…"
          : "Phone approval received. Checking the account connection…";
    }
  }
  async function pair(app: "telegram" | "whatsapp", op: Operation) {
    op.abort.signal.throwIfAborted();
    op.job.stage = "login";
    op.job.message = "Connecting to your account and preparing a QR code…";
    const timer = setTimeout(() => {
      op.timedOut = true;
      op.abort.abort();
    }, options.loginTimeoutMs ?? 360_000);
    try {
      await withAppLock(home, app, async () => {
        await requireStopped(home, managed[app]);
        await managed[app].webLogin!(home, {
          signal: op.abort.signal,
          event: (event) => loginEvent(op, event),
          input: (send) => {
            op.send = send;
          },
        });
      });
      op.abort.signal.throwIfAborted();
    } finally {
      clearTimeout(timer);
      clearLogin(op);
      delete op.send;
    }
  }
  async function control(app: AppId, action: "start" | "stop" | "restart") {
    if (app === "discord") return controlDiscord(home, action);
    const runner = await managedRuntime(home, managed[app]);
    if (action === "restart") await runner.stop();
    if (action !== "stop") {
      await requireInstallation(home, managed[app].source);
      await managed[app].preflight(home);
    }
    return action === "stop" ? runner.stop() : runner.start();
  }
  async function connect(app: AppId, op: Operation) {
    op.abort.signal.throwIfAborted();
    op.job.stage = "connect";
    op.job.message = "Starting the private tunnel…";
    const status = await control(app, "start");
    if (!status.processRunning || !status.healthy) throw new Error("Tunnel did not start.");
    op.job.message = status.ready
      ? "Your tunnel is ready. Finish connecting in your AI app."
      : "Tunnel started. Waiting for it to become ready…";
  }
  function mutateFor(app: AppId, action: string, body: Record<string, unknown>) {
    if (
      !["discord", "telegram", "whatsapp"].includes(app) ||
      !["setup", "login", "start", "stop", "restart"].includes(action) ||
      (app === "discord" && action === "login")
    )
      throw new RequestError("Unknown operation.", 404);
    const fields =
      action === "setup"
        ? [
            "tunnelId",
            "tunnelKey",
            ...(app === "discord"
              ? ["botToken", "guilds"]
              : app === "telegram"
                ? ["apiId", "apiHash"]
                : ["bridgePort"]),
          ]
        : [];
    if (Object.keys(body).some((key) => !fields.includes(key)))
      throw new RequestError("Unknown setting.");
    for (const value of Object.values(body))
      if (typeof value !== "string" || value.length > 4096)
        throw new RequestError("Settings must be text of at most 4096 characters.");
    const input = body as Record<string, string>;
    if (action === "setup") {
      if (!/^tunnel_[a-zA-Z0-9_-]+$/.test(input.tunnelId ?? ""))
        throw new RequestError("Enter a tunnel ID beginning with tunnel_.");
      if (
        input.guilds &&
        input.guilds !== "all" &&
        !/^\d{17,20}(\s*,\s*\d{17,20})*$/.test(input.guilds)
      )
        throw new RequestError("Use comma-separated Discord server IDs, or all.");
      if (
        app === "telegram" &&
        (!/^[1-9][0-9]*$/.test(input.apiId ?? "") ||
          (input.apiHash && !/^[a-fA-F0-9]{32}$/.test(input.apiHash)))
      )
        throw new RequestError(
          "Telegram needs a positive API ID and a 32-character hexadecimal API hash.",
        );
      if (
        input.bridgePort &&
        (!/^\d+$/.test(input.bridgePort) ||
          Number(input.bridgePort) < 1024 ||
          Number(input.bridgePort) > 65535)
      )
        throw new RequestError("Bridge port must be between 1024 and 65535.");
      for (const key of ["botToken", "tunnelKey", "apiHash"])
        if (input[key] && /[\s\x00-\x1f\x7f]/.test(input[key]!))
          throw new RequestError("Keys must be a single line without spaces.");
      return launch(app, action, async (op) => {
        const progress = (stage: Job["stage"]) => {
          op.abort.signal.throwIfAborted();
          op.job.stage = stage;
          op.job.message = (
            {
              runtime: "Checking tunnel-client…",
              credentials: "Checking your settings…",
              bot: "Verifying your Discord bot…",
              install:
                "Preparing this app on your computer. The first setup may take a few minutes…",
              save: "Saving settings on this computer…",
            } as Record<string, string>
          )[stage]!;
        };
        if (app === "discord")
          await configureDiscord(home, input, { verify: options.verify, progress });
        else {
          await withAppLock(home, app, async () => {
            await requireStopped(home, managed[app]);
            await managed[app].setup(home, { ...input, json: true, progress });
          });
          await pair(app, op);
        }
        await connect(app, op);
      });
    }
    if (action === "login")
      return launch(app, action, async (op) => {
        await pair(app as "telegram" | "whatsapp", op);
        await connect(app, op);
      });
    return launch(app, action, async (op) => {
      op.job.stage = action === "stop" ? "stop" : "connect";
      op.job.message = action === "stop" ? "Stopping the tunnel…" : "Starting the private tunnel…";
      const status = await control(app, action as "start" | "stop" | "restart");
      if (action === "stop" ? status.processRunning : !status.processRunning || !status.healthy)
        throw new Error("Tunnel operation failed.");
      op.job.message =
        action === "stop"
          ? "Tunnel stopped. Your settings are saved."
          : status.ready
            ? "Your tunnel is ready. Finish connecting in your AI app."
            : "Tunnel started. Waiting for it to become ready…";
    });
  }
  function active(app: AppId, jobId: unknown) {
    const op = operations.get(app);
    if (!op || op.job.id !== jobId || op.job.status !== "running")
      throw new RequestError("This login has ended. Start a new login.", 409);
    return op;
  }
  async function password(app: AppId, body: Record<string, unknown>) {
    if (
      app !== "telegram" ||
      Object.keys(body).some((key) => !["jobId", "requestId", "password"].includes(key)) ||
      typeof body.password !== "string" ||
      !body.password ||
      body.password.length > 1024
    )
      throw new RequestError("Enter your Telegram two-step password.");
    const op = active(app, body.jobId);
    if (
      op.job.stage !== "password" ||
      op.job.passwordRequestId !== body.requestId ||
      !op.send ||
      op.abort.signal.aborted
    )
      throw new RequestError("The password prompt changed. Use the current prompt.", 409);
    clearLogin(op);
    op.job.stage = "login";
    op.job.message = "Checking your two-step password…";
    await op.send(body.requestId as string, body.password).catch(() => {
      throw new RequestError("Login ended. Start a new login.", 409);
    });
    return { accepted: true };
  }
  function cancel(app: AppId, body: Record<string, unknown>) {
    if (Object.keys(body).some((key) => key !== "jobId"))
      throw new RequestError("Unknown setting.");
    const op = active(app, body.jobId);
    if (!["login", "qr", "password"].includes(op.job.stage))
      throw new RequestError("Wait until account login begins before cancelling.", 409);
    clearLogin(op);
    op.job.message = "Cancelling login…";
    op.abort.abort();
    return { accepted: true };
  }
  function qr(app: AppId, jobId: string | null, version: string | null) {
    const op = active(app, jobId);
    if (
      !op.image ||
      !op.job.qr ||
      String(op.job.qr.version) !== version ||
      op.job.qr.expiresAt <= Date.now() ||
      op.abort.signal.aborted
    )
      throw new RequestError("This QR code expired. Waiting for a fresh code.", 410);
    return { image: op.image };
  }
  async function close() {
    closed = true;
    for (const op of operations.values())
      if (op.job.status === "running") {
        clearLogin(op);
        op.abort.abort();
      }
    await Promise.all([...operations.values()].map((op) => op.done));
  }
  return {
    snapshot,
    mutate: (action: string, body: Record<string, unknown>) => mutateFor("discord", action, body),
    mutateFor,
    password,
    cancel,
    qr,
    close,
  };
}
