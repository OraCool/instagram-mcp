import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CHILD_FIELDS, MEDIA_FIELDS, PROFILE_FIELDS, type Media } from "../instagram/types.js";
import { jsonResult, safe, type ToolContext } from "./context.js";
import { READ_ONLY, idInput, pagingShape } from "./shared.js";

export function registerProfileTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "ig_get_profile",
    {
      title: "Get Instagram profile",
      description: "Profile of the connected professional account: username, name, bio, followers, follows and media counts.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => jsonResult(await ctx.client.get("/me", { fields: PROFILE_FIELDS }))),
  );

  server.registerTool(
    "ig_list_media",
    {
      title: "List Instagram media",
      description:
        "Posts and reels of the connected account, newest first, with likes and comment counts. " +
        "Pass next_cursor back as `after` for the next page.",
      inputSchema: pagingShape,
      annotations: READ_ONLY,
    },
    safe(async ({ limit, after }) => {
      const igId = await ctx.getUserId();
      const { items, next_cursor } = await ctx.client.collect<Media>(`/${igId}/media`, { fields: MEDIA_FIELDS, after }, limit);
      return jsonResult({ count: items.length, next_cursor, media: items });
    }),
  );

  server.registerTool(
    "ig_get_media",
    {
      title: "Get Instagram media",
      description: "One post, reel or story by media id, including carousel children.",
      inputSchema: { media_id: idInput },
      annotations: READ_ONLY,
    },
    safe(async ({ media_id }) => {
      const media = await ctx.client.get<Media>(`/${media_id}`, { fields: MEDIA_FIELDS });
      const children =
        media.media_type === "CAROUSEL_ALBUM"
          ? (await ctx.client.get<{ data: unknown[] }>(`/${media_id}/children`, { fields: CHILD_FIELDS })).data
          : undefined;
      return jsonResult({ ...media, ...(children && { children }) });
    }),
  );

  server.registerTool(
    "ig_list_stories",
    {
      title: "List Instagram stories",
      description: "Currently live stories of the connected account (stories disappear from the API after 24 hours).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const igId = await ctx.getUserId();
      const { items } = await ctx.client.collect<Media>(`/${igId}/stories`, { fields: MEDIA_FIELDS }, 100);
      return jsonResult({ count: items.length, stories: items });
    }),
  );

  server.registerTool(
    "ig_list_tagged_media",
    {
      title: "List media the account is tagged in",
      description: "Media from other accounts in which the connected account has been tagged.",
      inputSchema: pagingShape,
      annotations: READ_ONLY,
    },
    safe(async ({ limit, after }) => {
      const igId = await ctx.getUserId();
      const fields = "id,caption,media_type,media_url,permalink,timestamp,username,like_count,comments_count";
      const { items, next_cursor } = await ctx.client.collect(`/${igId}/tags`, { fields, after }, limit);
      return jsonResult({ count: items.length, next_cursor, media: items });
    }),
  );
}
