import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { cleanCode, exchangeCode } from "../src/instagram/oauth.js";
import { login } from "../src/login.js";
import { handle } from "../worker/src/index.js";
import { fakeGraph } from "./fakeGraph.js";

const APP = { appId: "1234567890", appSecret: "app-secret" };

// api.instagram.com (short-lived) and graph.instagram.com (long-lived) share paths that don't collide.
const oauthApi = () =>
  fakeGraph({
    // Raw text: user_id is a JSON number beyond 2^53, as Instagram sends it.
    "POST /oauth/access_token": () =>
      new Response('{"data":[{"access_token":"short","user_id":17841400000000001,"permissions":"instagram_business_basic"}]}'),
    "GET /access_token": () => ({ access_token: "long", token_type: "bearer", expires_in: 5_184_000 }),
    "GET /me": () => ({ username: "demo.studio" }),
  });

async function cachePath() {
  return join(await mkdtemp(join(tmpdir(), "ig-login-")), "token.json");
}

/** Plays the browser: follows the flow and auto-submits the final form to the local login listener. */
async function postForm(html: string) {
  const action = /action="([^"]+)"/.exec(html)![1]!;
  const fields = Object.fromEntries([...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))]));
  return fetch(action, { method: "POST", body: new URLSearchParams(fields) });
}

describe("oauth", () => {
  it("strips the #_ suffix and accepts a full redirect URL", () => {
    expect(cleanCode("AQBx#_")).toBe("AQBx");
    expect(cleanCode("https://oracool.github.io/instagram-mcp/callback/?code=AQBx#_")).toBe("AQBx");
  });

  it("exchanges a code for a long-lived token", async () => {
    const api = oauthApi();
    const token = await exchangeCode(APP, "https://cb.example.com/", "AQBx#_", api.fetchImpl);
    expect(token).toEqual({ access_token: "long", user_id: "17841400000000001", expires_in: 5_184_000 });
    expect(api.requests[1]!.params).toEqual({ grant_type: "ig_exchange_token", client_secret: "app-secret", access_token: "short" });
  });
});

describe("login (option 1: own app)", () => {
  it("receives the code from the callback page, exchanges it locally and saves the token", async () => {
    const api = oauthApi();
    const path = await cachePath();
    const config = loadConfig({ IG_APP_ID: APP.appId, IG_APP_SECRET: APP.appSecret, IG_TOKEN_CACHE_PATH: path });
    const result = await login({
      config,
      fetchImpl: api.fetchImpl,
      log: () => {},
      allowPaste: false,
      openBrowser: (url) => {
        // What docs/callback/index.html does with Instagram's redirect.
        const authorize = new URL(url);
        expect(authorize.searchParams.get("redirect_uri")).toBe("https://oracool.github.io/instagram-mcp/callback/");
        expect(authorize.searchParams.get("force_reauth")).toBe("true");
        const state = JSON.parse(Buffer.from(authorize.searchParams.get("state")!, "base64url").toString());
        void fetch(`http://127.0.0.1:${state.p}/callback`, { method: "POST", body: new URLSearchParams({ nonce: state.n, code: "AQBx" }) });
      },
    });
    expect(result).toMatchObject({ mode: "app", user_id: "17841400000000001", username: "demo.studio", saved_to: path });
    expect(JSON.parse(await readFile(path, "utf8")).access_token).toBe("long");
  });

  it("ignores posts without the right nonce", async () => {
    const config = loadConfig({ IG_APP_ID: APP.appId, IG_APP_SECRET: APP.appSecret, IG_TOKEN_CACHE_PATH: await cachePath() });
    const attempt = login({
      config,
      log: () => {},
      allowPaste: false,
      timeoutMs: 300,
      openBrowser: async (url) => {
        const state = JSON.parse(Buffer.from(new URL(url).searchParams.get("state")!, "base64url").toString());
        const response = await fetch(`http://127.0.0.1:${state.p}/callback`, { method: "POST", body: new URLSearchParams({ nonce: "0".repeat(32), code: "x" }) });
        expect(response.status).toBe(403);
      },
    });
    await expect(attempt).rejects.toThrow(/timed out/);
  });

  it("explains what to configure when there is no app or server", async () => {
    await expect(login({ config: loadConfig({}), log: () => {} })).rejects.toThrow(/IG_APP_ID.*IG_AUTH_SERVER/);
  });
});

describe("several accounts", () => {
  it("keeps one token file per IG_ACCOUNT", () => {
    expect(loadConfig({ IG_ACCOUNT: "demo.studio" }).tokenCachePath).toMatch(/instagram-mcp\/demo\.studio\.token\.json$/);
    expect(loadConfig({}).tokenCachePath).toMatch(/instagram-mcp\/token\.json$/);
    expect(loadConfig({ IG_ACCOUNT: "x", IG_TOKEN_CACHE_PATH: "/tmp/own.json" }).tokenCachePath).toBe("/tmp/own.json");
    expect(() => loadConfig({ IG_ACCOUNT: "../escape" })).toThrow(/IG_ACCOUNT/);
  });
});

describe("login (option 2: hosted Worker)", () => {
  const env = { IG_APP_ID: APP.appId, IG_APP_SECRET: APP.appSecret };
  const worker = "https://auth.example.workers.dev";

  it("runs the full flow through the Worker and saves the token", async () => {
    const api = oauthApi();
    const path = await cachePath();
    const result = await login({
      config: loadConfig({ IG_AUTH_SERVER: worker, IG_TOKEN_CACHE_PATH: path }),
      log: () => {},
      openBrowser: async (url) => {
        const start = await handle(new Request(url), env, api.fetchImpl);
        expect(start.status).toBe(302);
        const authorize = new URL(start.headers.get("location")!);
        expect(authorize.searchParams.get("redirect_uri")).toBe(`${worker}/callback`);
        expect(authorize.searchParams.get("scope")).toContain("instagram_business_content_publish");
        // Instagram redirects back with the code and the signed state.
        const callback = `${worker}/callback?code=AQBx&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`;
        const page = await handle(new Request(callback), env, api.fetchImpl);
        expect(page.headers.get("cache-control")).toBe("no-store");
        await postForm(await page.text());
      },
    });
    expect(result).toMatchObject({ mode: "server", user_id: "17841400000000001" });
    expect(JSON.parse(await readFile(path, "utf8")).access_token).toBe("long");
  });

  it("rejects tampered or expired state", async () => {
    const start = await handle(new Request(`${worker}/start?port=50000&nonce=${"a".repeat(32)}`), env);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const tampered = state.replace(/^./, (c) => (c === "e" ? "f" : "e"));
    expect((await handle(new Request(`${worker}/callback?code=x&state=${tampered}`), env)).status).toBe(400);
    const later = () => Date.now() + 16 * 60_000;
    expect((await handle(new Request(`${worker}/callback?code=x&state=${state}`), env, fetch, later)).status).toBe(400);
  });

  it("validates /start input and its own configuration", async () => {
    expect((await handle(new Request(`${worker}/start?port=80&nonce=${"a".repeat(32)}`), env)).status).toBe(400);
    expect((await handle(new Request(`${worker}/start?port=50000&nonce=abc`), env)).status).toBe(400);
    expect((await handle(new Request(`${worker}/`), { IG_APP_ID: "", IG_APP_SECRET: "" })).status).toBe(500);
  });
});
