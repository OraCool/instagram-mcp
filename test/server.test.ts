import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { createContext } from "../src/tools/context.js";
import { fakeGraph, ME, type Handler } from "./fakeGraph.js";

const IG = ME.user_id;
// Never read a real token cache from the home directory.
const NO_CACHE = { IG_TOKEN_CACHE_PATH: "/nonexistent/instagram-mcp/token.json" };

async function connect(routes: Record<string, Handler>, env: Record<string, string> = {}) {
  const graph = fakeGraph({ "GET /me": () => ME, ...routes });
  const ctx = createContext(loadConfig({ IG_ACCESS_TOKEN: "tok", ...NO_CACHE, ...env }), { fetchImpl: graph.fetchImpl, sleep: async () => {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(ctx).connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = result.content[0]!.text;
    return { isError: Boolean(result.isError), text, json: result.isError ? undefined : JSON.parse(text) };
  };
  return { client, call, requests: graph.requests };
}

const writes = { IG_ENABLE_WRITES: "true" };

describe("server", () => {
  it("registers all tools", async () => {
    const { client } = await connect({});
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "ig_account_insights", "ig_comment_on_media", "ig_delete_comment", "ig_get_container_status", "ig_get_media",
        "ig_get_messages", "ig_get_profile", "ig_hide_comment", "ig_list_comments", "ig_list_conversations", "ig_list_media",
        "ig_list_replies", "ig_list_stories", "ig_list_tagged_media", "ig_media_insights", "ig_publish_carousel",
        "ig_publish_container", "ig_publish_image", "ig_publish_reel", "ig_publish_story", "ig_publishing_limit",
        "ig_refresh_token", "ig_reply_comment", "ig_send_message", "ig_set_comments_enabled", "ig_token_status",
      ].sort(),
    );
  });

  it("lists media of the account resolved from /me", async () => {
    const { call, requests } = await connect({
      [`GET /${IG}/media`]: () => ({ data: [{ id: "1790000000000001", caption: "Hello", like_count: 3 }] }),
    });
    const { json } = await call("ig_list_media", { limit: 5 });
    expect(json).toEqual({ count: 1, media: [{ id: "1790000000000001", caption: "Hello", like_count: 3 }] });
    expect(requests.map((r) => r.path)).toEqual(["/me", `/${IG}/media`]);
  });

  it("returns a tool error instead of crashing when the token is missing", async () => {
    const graph = fakeGraph({});
    const ctx = createContext(loadConfig(NO_CACHE), { fetchImpl: graph.fetchImpl });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer(ctx).connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    const result = (await client.callTool({ name: "ig_get_profile", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/IG_ACCESS_TOKEN/);
  });

  it("picks default media insight metrics by product type", async () => {
    const { call, requests } = await connect({
      "GET /1790000000000002": () => ({ id: "1790000000000002", media_product_type: "REELS" }),
      "GET /1790000000000002/insights": () => ({ data: [{ name: "views", total_value: { value: 120 } }, { name: "reach", values: [{ value: 80 }] }] }),
    });
    const { json } = await call("ig_media_insights", { media_id: "1790000000000002" });
    expect(json.metrics).toEqual({ views: 120, reach: 80 });
    expect(requests.at(-1)!.params.metric).toContain("ig_reels_avg_watch_time");
  });

  describe("write guard", () => {
    it("refuses writes without IG_ENABLE_WRITES=true and makes no request", async () => {
      const { call, requests } = await connect({});
      for (const [name, args] of [
        ["ig_publish_image", { image_url: "https://cdn.example.com/a.jpg" }],
        ["ig_reply_comment", { comment_id: "1", message: "Thanks!" }],
        ["ig_delete_comment", { comment_id: "1" }],
        ["ig_send_message", { recipient_id: "2", text: "Hi" }],
      ] as const) {
        const result = await call(name, args);
        expect(result.isError, name).toBe(true);
        expect(result.text).toMatch(/IG_ENABLE_WRITES/);
      }
      expect(requests).toHaveLength(0);
    });
  });

  describe("publishing", () => {
    it("creates a container, waits until FINISHED and publishes", async () => {
      let polls = 0;
      const { call, requests } = await connect(
        {
          [`POST /${IG}/media`]: () => ({ id: "1800000000000001" }),
          "GET /1800000000000001": () => ({ id: "1800000000000001", status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" }),
          [`POST /${IG}/media_publish`]: () => ({ id: "1790000000000009" }),
          "GET /1790000000000009": () => ({ permalink: "https://www.instagram.com/p/demo/" }),
        },
        writes,
      );
      const { json } = await call("ig_publish_image", { image_url: "https://cdn.example.com/a.jpg", caption: "New post" });
      expect(json).toEqual({
        status: "published",
        media_id: "1790000000000009",
        container_id: "1800000000000001",
        permalink: "https://www.instagram.com/p/demo/",
      });
      expect(requests.find((r) => r.path === `/${IG}/media`)!.params).toEqual({ image_url: "https://cdn.example.com/a.jpg", caption: "New post" });
      expect(requests.find((r) => r.path === `/${IG}/media_publish`)!.params).toEqual({ creation_id: "1800000000000001" });
    });

    it("returns a pending container when processing outlasts the wait", async () => {
      const { call, requests } = await connect(
        {
          [`POST /${IG}/media`]: () => ({ id: "1800000000000002" }),
          "GET /1800000000000002": () => ({ id: "1800000000000002", status_code: "IN_PROGRESS" }),
        },
        writes,
      );
      const { json } = await call("ig_publish_reel", { video_url: "https://cdn.example.com/a.mp4", wait_seconds: 0 });
      expect(json).toMatchObject({ status: "pending", container_id: "1800000000000002", container_status: "IN_PROGRESS" });
      expect(requests.some((r) => r.path.endsWith("/media_publish"))).toBe(false);
    });

    it("reports container errors", async () => {
      const { call } = await connect(
        {
          [`POST /${IG}/media`]: () => ({ id: "1800000000000003" }),
          "GET /1800000000000003": () => ({ id: "1800000000000003", status_code: "ERROR", status: "Error: unsupported format" }),
        },
        writes,
      );
      const result = await call("ig_publish_image", { image_url: "https://cdn.example.com/a.png" });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/failed with ERROR: Error: unsupported format/);
    });

    it("builds a carousel from child containers", async () => {
      let next = 0;
      const { call, requests } = await connect(
        {
          [`POST /${IG}/media`]: () => ({ id: `18000000000001${next++}` }),
          "GET /180000000000010": () => ({ status_code: "FINISHED" }),
          "GET /180000000000011": () => ({ status_code: "FINISHED" }),
          "GET /180000000000012": () => ({ status_code: "FINISHED" }),
          [`POST /${IG}/media_publish`]: () => ({ id: "1790000000000010" }),
          "GET /1790000000000010": () => ({}),
        },
        writes,
      );
      const { json } = await call("ig_publish_carousel", {
        items: [{ image_url: "https://cdn.example.com/1.jpg" }, { video_url: "https://cdn.example.com/2.mp4" }],
        caption: "Album",
      });
      expect(json).toMatchObject({ status: "published", media_id: "1790000000000010", container_id: "180000000000012" });
      const creates = requests.filter((r) => r.path === `/${IG}/media`).map((r) => r.params);
      expect(creates).toEqual([
        { is_carousel_item: "true", image_url: "https://cdn.example.com/1.jpg" },
        { is_carousel_item: "true", media_type: "VIDEO", video_url: "https://cdn.example.com/2.mp4" },
        { media_type: "CAROUSEL", children: "180000000000010,180000000000011", caption: "Album" },
      ]);
    });
  });

  describe("comments and messages", () => {
    it("hides a comment", async () => {
      const { call, requests } = await connect({ "POST /1780000000000001": () => ({ success: true }) }, writes);
      const { json } = await call("ig_hide_comment", { comment_id: "1780000000000001" });
      expect(json).toEqual({ comment_id: "1780000000000001", hidden: true, success: true });
      expect(requests[0]!.params).toEqual({ hide: "true" });
    });

    it("sends a text DM with the documented body", async () => {
      const { call, requests } = await connect(
        { [`POST /${IG}/messages`]: () => ({ recipient_id: "2", message_id: "m_1" }) },
        writes,
      );
      const { json } = await call("ig_send_message", { recipient_id: "2", text: "Hi there" });
      expect(json).toEqual({ recipient_id: "2", message_id: "m_1" });
      expect(requests.at(-1)!.body).toEqual({ recipient: { id: "2" }, message: { text: "Hi there" } });
    });

    it("rejects DM text over 1000 bytes before calling Instagram", async () => {
      const { call, requests } = await connect({}, writes);
      const result = await call("ig_send_message", { recipient_id: "2", text: "я".repeat(501) });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/1002 bytes/);
      expect(requests).toHaveLength(0);
    });

    it("reads the latest messages of a conversation", async () => {
      const { call } = await connect({
        "GET /aWdfZAG06": () => ({ messages: { data: [{ id: "m_1" }, { id: "m_2" }] } }),
        "GET /m_1": () => ({ id: "m_1", message: "Hello", from: { username: "visitor.one" } }),
        "GET /m_2": () => ({ id: "m_2", message: "Hi!", from: { username: "demo.studio" } }),
      });
      const { json } = await call("ig_get_messages", { conversation_id: "aWdfZAG06" });
      expect(json.count).toBe(2);
      expect(json.messages.map((m: { message: string }) => m.message)).toEqual(["Hello", "Hi!"]);
    });
  });
});
