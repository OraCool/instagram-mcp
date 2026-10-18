import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TokenStore } from "../src/instagram/token.js";
import { fakeGraph } from "./fakeGraph.js";

const NOW = new Date("2026-03-01T12:00:00Z");

async function tempPath() {
  return join(await mkdtemp(join(tmpdir(), "ig-token-")), "ig.token.json");
}

describe("TokenStore", () => {
  it("prefers the refreshed token in the cache file over IG_ACCESS_TOKEN", async () => {
    const path = await tempPath();
    await writeFile(path, JSON.stringify({ access_token: "cached", expires_at: "2026-04-01T00:00:00Z" }));
    const store = new TokenStore("env", path);
    expect(await store.info()).toMatchObject({ source: "cache", state: { access_token: "cached" } });
  });

  it("falls back to IG_ACCESS_TOKEN when the cache file does not exist yet", async () => {
    const store = new TokenStore("env", await tempPath());
    expect(await store.info()).toEqual({ source: "env", state: { access_token: "env" } });
  });

  it("refreshes, computes the expiry and saves the new token with owner-only permissions", async () => {
    const path = await tempPath();
    const graph = fakeGraph({
      "GET /refresh_access_token": () => ({ access_token: "new", token_type: "bearer", expires_in: 5_184_000 }),
    });
    const store = new TokenStore("old", path, graph.fetchImpl, () => NOW);
    const next = await store.refresh();

    expect(graph.requests[0]!.params).toEqual({ grant_type: "ig_refresh_token", access_token: "old" });
    expect(next).toEqual({ access_token: "new", obtained_at: NOW.toISOString(), expires_at: "2026-04-30T12:00:00.000Z" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(next);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await store.getToken()).toBe("new");
  });

  it("explains refresh failures", async () => {
    const graph = fakeGraph({
      "GET /refresh_access_token": () => new Response(JSON.stringify({ error: { message: "Invalid token", code: 190 } }), { status: 400 }),
    });
    await expect(new TokenStore("old", undefined, graph.fetchImpl).refresh()).rejects.toThrow(/Invalid token.*24 hours/);
  });
});
