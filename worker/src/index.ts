// Hosted token exchange for `instagram-mcp login` (option 2: people use YOUR Meta app without its secret).
//
// GET /start?port&nonce&scope  → signed state, redirect to Instagram's consent page
// GET /callback?code&state     → exchange code for a long-lived token with the app secret, then auto-POST it to the
//                                 user's local login command at http://127.0.0.1:<port>/callback together with the nonce.
// Nothing is stored or logged. Only accounts added to your app (Standard Access) can complete the login.

import { IG_SCOPES, authorizeUrl, exchangeCode } from "../../src/instagram/oauth.js";

export interface Env {
  IG_APP_ID: string;
  IG_APP_SECRET: string; // `wrangler secret put IG_APP_SECRET`
}

const STATE_TTL_SECONDS = 15 * 60;

interface StatePayload {
  p: number; // local port of the login command
  n: string; // nonce of the login command
  e: number; // expiry, unix seconds
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};

export async function handle(request: Request, env: Env, fetchImpl: typeof fetch = fetch, now = () => Date.now()): Promise<Response> {
  if (!env.IG_APP_ID || !env.IG_APP_SECRET) return text(500, "Login server is not configured: set IG_APP_ID and IG_APP_SECRET");
  if (request.method !== "GET") return text(405, "Method not allowed");
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/callback`;

  if (url.pathname === "/") {
    return text(200, `instagram-mcp login server.\nRun: IG_AUTH_SERVER=${url.origin} npx -y github:OraCool/instagram-mcp login`);
  }

  if (url.pathname === "/start") {
    const port = Number(url.searchParams.get("port"));
    const nonce = url.searchParams.get("nonce") ?? "";
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[0-9a-f]{32}$/.test(nonce)) {
      return text(400, "Invalid login request: start it with the instagram-mcp login command");
    }
    const requested = (url.searchParams.get("scope") ?? "").split(",");
    const scopes = IG_SCOPES.filter((s) => s === "instagram_business_basic" || requested.includes(s));
    const state = await sign({ p: port, n: nonce, e: Math.floor(now() / 1000) + STATE_TTL_SECONDS }, env.IG_APP_SECRET);
    return Response.redirect(authorizeUrl(env.IG_APP_ID, redirectUri, scopes, state), 302);
  }

  if (url.pathname === "/callback") {
    const state = await verify(url.searchParams.get("state") ?? "", env.IG_APP_SECRET, now);
    if (!state) return html(400, "<p>This login link is invalid or has expired. Run the login command again.</p>");

    let fields: Record<string, string>;
    const error = url.searchParams.get("error");
    if (error) {
      fields = { error, error_description: url.searchParams.get("error_description") ?? error };
    } else {
      try {
        const token = await exchangeCode(
          { appId: env.IG_APP_ID, appSecret: env.IG_APP_SECRET },
          redirectUri,
          url.searchParams.get("code") ?? "",
          fetchImpl,
        );
        fields = { access_token: token.access_token, user_id: token.user_id ?? "", expires_in: String(token.expires_in ?? "") };
      } catch (e) {
        fields = { error: "exchange_failed", error_description: e instanceof Error ? e.message : String(e) };
      }
    }
    return postToCli(state.p, { ...fields, nonce: state.n });
  }

  return text(404, "Not found");
}

// The token travels in a POST body to 127.0.0.1 (a secure context for browsers): never in a URL or browser history.
function postToCli(port: number, fields: Record<string, string>): Response {
  const action = `http://127.0.0.1:${port}/callback`;
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join("");
  const body =
    `<form id="f" method="post" action="${action}">${inputs}` +
    `<p>Finishing login… If nothing happens, <button type="submit">continue</button>.</p></form>` +
    `<script>document.getElementById("f").submit()</script>`;
  return html(200, body, { "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; form-action ${action}` });
}

async function key(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(payload: StatePayload, secret: string): Promise<string> {
  const data = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(data));
  return `${data}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verify(state: string, secret: string, now: () => number): Promise<StatePayload | undefined> {
  const [data, signature] = state.split(".");
  if (!data || !signature) return undefined;
  try {
    const valid = await crypto.subtle.verify("HMAC", await key(secret), fromBase64Url(signature), new TextEncoder().encode(data));
    if (!valid) return undefined;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(data))) as StatePayload;
    return payload.e > now() / 1000 ? payload : undefined;
  } catch {
    return undefined;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const SECURITY_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

function html(status: number, body: string, headers: Record<string, string> = {}): Response {
  const doc = `<!doctype html><meta charset="utf-8"><title>instagram-mcp login</title><body style="font:16px system-ui;padding:3rem">${body}</body>`;
  return new Response(doc, { status, headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", ...headers } });
}
