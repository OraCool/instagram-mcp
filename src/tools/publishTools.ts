import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Params } from "../instagram/client.js";
import { createContainer, getContainer, waitAndPublish, waitForContainer } from "../instagram/publish.js";
import { jsonResult, safe, type ToolContext } from "./context.js";
import { READ_ONLY, WRITES, idInput, requireWrites } from "./shared.js";

// Meta downloads media from the URL, so it must be publicly reachable (no auth, no localhost). Images: JPEG only.
const imageUrl = z.url({ protocol: /^https?$/ }).describe("Public URL of a JPEG image");
const videoUrl = z.url({ protocol: /^https?$/ }).describe("Public URL of an MP4/MOV video");
const caption = z.string().max(2200).optional().describe("Caption, up to 2200 characters, 30 hashtags and 20 @mentions");
const waitSeconds = z
  .number()
  .int()
  .min(0)
  .max(300)
  .default(60)
  .describe("How long to wait for Meta to process the media before returning a pending container_id");

const carouselItem = z.union([
  z.object({ image_url: imageUrl }),
  z.object({ video_url: videoUrl }),
  z.object({ container_id: idInput.describe("A child container from a previous pending ig_publish_carousel call") }),
]);

export function registerPublishTools(server: McpServer, ctx: ToolContext) {
  const wait = (seconds: number) => ({ waitSeconds: seconds, sleep: ctx.sleep });

  async function createAndPublish(params: Params, seconds: number) {
    requireWrites(ctx);
    const igId = await ctx.getUserId();
    const containerId = await createContainer(ctx.client, igId, params);
    return jsonResult(await waitAndPublish(ctx.client, igId, containerId, wait(seconds)));
  }

  server.registerTool(
    "ig_publish_image",
    {
      title: "Publish an image post",
      description: "Publishes a single-image feed post from a public JPEG URL. Requires IG_ENABLE_WRITES=true.",
      inputSchema: {
        image_url: imageUrl,
        caption,
        alt_text: z.string().max(1000).optional().describe("Accessibility text for the image"),
        wait_seconds: waitSeconds,
      },
      annotations: WRITES,
    },
    safe(async ({ image_url, caption, alt_text, wait_seconds }) => createAndPublish({ image_url, caption, alt_text }, wait_seconds)),
  );

  server.registerTool(
    "ig_publish_reel",
    {
      title: "Publish a reel",
      description:
        "Publishes a reel from a public video URL. Video processing can take minutes: if it is not ready within " +
        "wait_seconds, a pending container_id is returned for ig_publish_container. Requires IG_ENABLE_WRITES=true.",
      inputSchema: {
        video_url: videoUrl,
        caption,
        cover_url: imageUrl.optional().describe("Public URL of a cover image"),
        thumb_offset: z.number().int().min(0).optional().describe("Cover frame offset in milliseconds (when no cover_url)"),
        share_to_feed: z.boolean().default(true).describe("Also show the reel in the main feed grid"),
        wait_seconds: waitSeconds,
      },
      annotations: WRITES,
    },
    safe(async ({ video_url, caption, cover_url, thumb_offset, share_to_feed, wait_seconds }) =>
      createAndPublish({ media_type: "REELS", video_url, caption, cover_url, thumb_offset, share_to_feed }, wait_seconds),
    ),
  );

  server.registerTool(
    "ig_publish_story",
    {
      title: "Publish a story",
      description: "Publishes a story from a public image (JPEG) or video URL. Captions are not supported on stories. Requires IG_ENABLE_WRITES=true.",
      inputSchema: { image_url: imageUrl.optional(), video_url: videoUrl.optional(), wait_seconds: waitSeconds },
      annotations: WRITES,
    },
    safe(async ({ image_url, video_url, wait_seconds }) => {
      if (Boolean(image_url) === Boolean(video_url)) throw new Error("Provide exactly one of image_url or video_url");
      return createAndPublish({ media_type: "STORIES", image_url, video_url }, wait_seconds);
    }),
  );

  server.registerTool(
    "ig_publish_carousel",
    {
      title: "Publish a carousel",
      description:
        "Publishes a carousel of 2–10 images and/or videos (counts as one post against the daily limit). " +
        "If some videos are still processing, returns pending child container_ids: call again with those as items. " +
        "Requires IG_ENABLE_WRITES=true.",
      inputSchema: { items: z.array(carouselItem).min(2).max(10), caption, wait_seconds: waitSeconds },
      annotations: WRITES,
    },
    safe(async ({ items, caption, wait_seconds }) => {
      requireWrites(ctx);
      const igId = await ctx.getUserId();
      const deadline = Date.now() + wait_seconds * 1000;
      const children: string[] = [];
      for (const item of items) {
        if ("container_id" in item) children.push(item.container_id);
        else if ("image_url" in item) children.push(await createContainer(ctx.client, igId, { is_carousel_item: true, image_url: item.image_url }));
        else children.push(await createContainer(ctx.client, igId, { is_carousel_item: true, media_type: "VIDEO", video_url: item.video_url }));
      }
      // Every child must be FINISHED before the carousel container can be created; all share one wait budget.
      const pending: string[] = [];
      for (const child of children) {
        const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        const { ready } = await waitForContainer(ctx.client, child, wait(remaining));
        if (!ready) pending.push(child);
      }
      if (pending.length > 0) {
        return jsonResult({
          status: "pending",
          children,
          pending_children: pending,
          hint: "Some items are still processing. Call ig_publish_carousel again with items [{container_id}, ...] in this order.",
        });
      }
      const parent = await createContainer(ctx.client, igId, { media_type: "CAROUSEL", children: children.join(","), caption });
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      return jsonResult(await waitAndPublish(ctx.client, igId, parent, wait(Math.max(remaining, 10))));
    }),
  );

  server.registerTool(
    "ig_get_container_status",
    {
      title: "Get media container status",
      description: "Processing status of a media container: IN_PROGRESS, FINISHED, PUBLISHED, ERROR or EXPIRED.",
      inputSchema: { container_id: idInput },
      annotations: READ_ONLY,
    },
    safe(async ({ container_id }) => jsonResult(await getContainer(ctx.client, container_id))),
  );

  server.registerTool(
    "ig_publish_container",
    {
      title: "Publish a pending container",
      description: "Finishes publishing a container returned as pending by an ig_publish_* tool. Requires IG_ENABLE_WRITES=true.",
      inputSchema: { container_id: idInput, wait_seconds: waitSeconds },
      annotations: WRITES,
    },
    safe(async ({ container_id, wait_seconds }) => {
      requireWrites(ctx);
      const igId = await ctx.getUserId();
      return jsonResult(await waitAndPublish(ctx.client, igId, container_id, wait(wait_seconds)));
    }),
  );

  server.registerTool(
    "ig_publishing_limit",
    {
      title: "Publishing quota",
      description: "How many posts the account has published via the API in the last 24 hours (limit: 100; a carousel counts as one).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const igId = await ctx.getUserId();
      const { data } = await ctx.client.get<{ data: unknown[] }>(`/${igId}/content_publishing_limit`, { fields: "config,quota_usage" });
      return jsonResult(data[0] ?? {});
    }),
  );

}
