import { describe, expect, it } from "vitest";
import { InstagramClient, InstagramError } from "../src/instagram/client.js";
import { TokenStore } from "../src/instagram/token.js";
import { fakeGraph } from "./fakeGraph.js";

const client = (fetchImpl: typeof fetch) => new InstagramClient(new TokenStore("tok", undefined, fetchImpl), "v25.0", fetchImpl);

describe("InstagramClient", () => {
  it("sends a bearer token and the API version, skipping undefined params", async () => {
    const graph = fakeGraph({ "GET /me": () => ({ id: "1" }) });
    await client(graph.fetchImpl).get("/me", { fields: "id", after: undefined });
    expect(graph.requests[0]).toMatchObject({ path: "/me", params: { fields: "id" }, authorization: "Bearer tok" });
  });

  it("turns Graph errors into readable messages with hints", async () => {
    const graph = fakeGraph({
      "GET /me": () =>
        new Response(JSON.stringify({ error: { message: "Error validating access token", type: "OAuthException", code: 190 } }), {
          status: 400,
        }),
    });
    const error = await client(graph.fetchImpl).get("/me").catch((e) => e);
    expect(error).toBeInstanceOf(InstagramError);
    expect(error.code).toBe(190);
    expect(error.message).toMatch(/Instagram 400 \(code 190\): Error validating access token.*ig_refresh_token/);
  });

  it("follows cursors until the limit is reached", async () => {
    const graph = fakeGraph({
      "GET /1/media": (req) =>
        req.params.after === "c1"
          ? { data: [{ id: "3" }], paging: { cursors: { after: "c2" } } }
          : { data: [{ id: "1" }, { id: "2" }], paging: { cursors: { after: "c1" }, next: "https://next" } },
    });
    const all = await client(graph.fetchImpl).collect("/1/media", {}, 10);
    expect(all).toEqual({ items: [{ id: "1" }, { id: "2" }, { id: "3" }], next_cursor: undefined });

    const capped = await client(graph.fetchImpl).collect("/1/media", {}, 2);
    expect(capped).toEqual({ items: [{ id: "1" }, { id: "2" }], next_cursor: "c1" });
  });

  it("reports a missing token per call", async () => {
    const graph = fakeGraph({});
    const c = new InstagramClient(new TokenStore(undefined, undefined, graph.fetchImpl), "v25.0", graph.fetchImpl);
    await expect(c.get("/me")).rejects.toThrow(/IG_ACCESS_TOKEN/);
    expect(graph.requests).toHaveLength(0);
  });
});
