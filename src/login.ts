import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import type { Config } from "./config.js";
import { IG_SCOPES, authorizeUrl, cleanCode, exchangeCode, type LongLivedToken } from "./instagram/oauth.js";
import { TokenStore } from "./instagram/token.js";

// `instagram-mcp login`: gets a long-lived token through Business Login and saves it to the token cache file.
//
// Both modes hand the result back to a one-off listener on 127.0.0.1 via an auto-submitted form POST that carries a
// random nonce (only the browser tab started by this command knows it):
// - app mode (IG_APP_ID + IG_APP_SECRET, your own Meta app): the static callback page posts the `code`; it is
//   exchanged here, so the secret never leaves this machine.
// - server mode (IG_AUTH_SERVER): the hosted Worker in worker/ holds the app secret, exchanges the code and posts the
//   finished token.

export interface LoginOptions {
  config: Config;
  scopes?: string[];
  openBrowser?: (url: string) => void;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  timeoutMs?: number;
  allowPaste?: boolean; // app mode: also accept the code pasted into the terminal
}

export interface LoginResult {
  mode: "app" | "server";
  user_id?: string;
  expires_at?: string;
  saved_to: string;
}

const MAX_BODY_BYTES = 16 * 1024;

export async function login(options: LoginOptions): Promise<LoginResult> {
  const { config, fetchImpl = fetch, log = (m) => console.error(m), timeoutMs = 5 * 60_000 } = options;
  const scopes = options.scopes ?? [...IG_SCOPES];
  const mode = config.authServer ? "server" : config.app ? "app" : undefined;
  if (!mode) {
    throw new Error(
      "Nothing to log in with: set IG_APP_ID and IG_APP_SECRET (your own Meta app) or IG_AUTH_SERVER (a hosted login server). " +
        "See docs/credentials.md.",
    );
  }

  const nonce = randomBytes(16).toString("hex");
  const listener = await listen(nonce);
  let url: string;
  if (mode === "server") {
    url = new URL("/start", config.authServer).toString();
    url += `?${new URLSearchParams({ port: String(listener.port), nonce, scope: scopes.join(",") })}`;
  } else {
    const state = Buffer.from(JSON.stringify({ p: listener.port, n: nonce })).toString("base64url");
    url = authorizeUrl(config.app!.appId, config.redirectUri, scopes, state);
  }

  log(`Opening Instagram login in your browser. If it does not open, visit:\n\n  ${url}\n`);
  (options.openBrowser ?? openInBrowser)(url);

  const sources: Promise<URLSearchParams>[] = [listener.result];
  const paste = mode === "app" && (options.allowPaste ?? process.stdin.isTTY) ? pasteCode(log) : undefined;
  if (paste) sources.push(paste.result);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Login timed out after 5 minutes")), timeoutMs);
  });

  let params: URLSearchParams;
  try {
    params = await Promise.race([...sources, timeout]);
  } finally {
    clearTimeout(timer);
    listener.close();
    paste?.close();
  }

  const error = params.get("error");
  if (error) throw new Error(`Instagram login was not completed: ${params.get("error_description") ?? error}`);

  let token: LongLivedToken;
  if (mode === "app") {
    const code = params.get("code");
    if (!code) throw new Error("No authorization code received");
    token = await exchangeCode(config.app!, config.redirectUri, code, fetchImpl);
  } else {
    const accessToken = params.get("access_token");
    if (!accessToken) throw new Error("The login server did not return a token");
    const expiresIn = Number(params.get("expires_in"));
    token = { access_token: accessToken, user_id: params.get("user_id") ?? undefined, expires_in: expiresIn || undefined };
  }

  const now = new Date();
  const expiresAt = token.expires_in ? new Date(now.getTime() + token.expires_in * 1000).toISOString() : undefined;
  await new TokenStore(undefined, config.tokenCachePath).save({
    access_token: token.access_token,
    obtained_at: now.toISOString(),
    expires_at: expiresAt,
  });
  return { mode, user_id: token.user_id, expires_at: expiresAt, saved_to: config.tokenCachePath };
}

/** One-off HTTP listener on 127.0.0.1 (random port) that accepts a single form POST carrying the expected nonce. */
async function listen(nonce: string) {
  let resolve!: (params: URLSearchParams) => void;
  const result = new Promise<URLSearchParams>((r) => (resolve = r));
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on("end", () => {
      const params = new URLSearchParams(body);
      if (params.get("nonce") !== nonce) {
        res.writeHead(403, { "Content-Type": "text/plain" }).end("This login link is not from the running instagram-mcp login.");
        return;
      }
      const ok = !params.get("error");
      res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
        .end(page(ok ? "Instagram connected — return to the terminal. You can close this tab." : "Login was cancelled."));
      resolve(params);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { port, result, close: () => server.close() };
}

function pasteCode(log: (m: string) => void) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  log("…or paste the code shown on the callback page here and press Enter:");
  const result = new Promise<URLSearchParams>((resolve) => {
    rl.on("line", (line) => {
      const code = cleanCode(line);
      if (code) resolve(new URLSearchParams({ code }));
    });
  });
  return { result, close: () => rl.close() };
}

function openInBrowser(url: string) {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

function page(message: string) {
  return `<!doctype html><meta charset="utf-8"><title>instagram-mcp</title><body style="font:16px system-ui;padding:3rem">${message}</body>`;
}
