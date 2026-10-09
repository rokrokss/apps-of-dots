import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createSetupService, RequestError, type AppId } from "./service.js";

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    throw new RequestError("Use application/json.", 415);
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 24 * 1024) throw new RequestError("Request too large.", 413);
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError("Invalid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new RequestError("Expected a JSON object.");
  return body as Record<string, unknown>;
}

export async function startWebUi(options: {
  home: string;
  port?: number;
  service?: ReturnType<typeof createSetupService>;
}) {
  const token = randomBytes(32).toString("hex");
  const service = options.service ?? createSetupService(options.home);
  let origin = "";
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(body));
    };
    void handle(request, response, json).catch((error: unknown) => {
      if (!response.headersSent)
        json(error instanceof RequestError ? error.status : 500, {
          error:
            error instanceof RequestError
              ? error.message
              : "Could not complete this request. Try again.",
        });
      else response.end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.once("close", () => {
    void service.close();
  });

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    json: (status: number, body: unknown) => void,
  ) {
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      throw new RequestError("Open the setup link printed in your terminal.", 403);
    const path = request.url ?? "/";
    const asset = assets.get(path);
    if (asset && request.method === "GET") {
      const contents = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      response.writeHead(200, { "Content-Type": asset[1]! });
      response.end(contents);
      return;
    }
    if (!path.startsWith("/api/")) throw new RequestError("Not found.", 404);
    const supplied = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new RequestError(
        "Open the setup link printed in your terminal to unlock this page.",
        401,
      );
    if (path === "/api/state" && request.method === "GET") {
      json(200, await service.snapshot());
      return;
    }
    const endpoint = new URL(path, origin);
    const qr = /^\/api\/(telegram|whatsapp)\/qr$/.exec(endpoint.pathname);
    if (qr && request.method === "GET") {
      json(
        200,
        service.qr(
          qr[1] as AppId,
          endpoint.searchParams.get("jobId"),
          endpoint.searchParams.get("version"),
        ),
      );
      return;
    }
    const match =
      /^\/api\/(discord|telegram|whatsapp)\/(setup|login|start|stop|restart|password|cancel)$/.exec(
        path,
      );
    if (match && request.method === "POST") {
      const app = match[1] as AppId;
      const action = match[2]!;
      const body = await jsonBody(request);
      json(
        202,
        action === "password"
          ? await service.password(app, body)
          : action === "cancel"
            ? service.cancel(app, body)
            : service.mutateFor(app, action, body),
      );
      return;
    }
    throw new RequestError("Not found.", 404);
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 3210, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not open local setup."));
        return;
      }
      origin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  return { server, url: `${origin}/#token=${token}`, origin, token };
}

export function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  return new Promise((resolve, reject) =>
    execFile(command, [url], { timeout: 5000 }, (error) => (error ? reject(error) : resolve())),
  );
}
