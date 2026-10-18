import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { COMMENT_FIELDS } from "../instagram/types.js";
import { jsonResult, safe, type ToolContext } from "./context.js";
import { DESTRUCTIVE, READ_ONLY, WRITES, idInput, pagingShape, requireWrites } from "./shared.js";

const messageInput = z.string().trim().min(1).max(2200).describe("Comment text (Instagram captions/comments max 2200 chars)");

export function registerCommentTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "ig_list_comments",
    {
      title: "List comments on media",
      description: "Top-level comments on one of the account's posts or reels, with author, likes and hidden flag.",
      inputSchema: { media_id: idInput, ...pagingShape },
      annotations: READ_ONLY,
    },
    safe(async ({ media_id, limit, after }) => {
      const { items, next_cursor } = await ctx.client.collect(`/${media_id}/comments`, { fields: COMMENT_FIELDS, after }, limit);
      return jsonResult({ count: items.length, next_cursor, comments: items });
    }),
  );

  server.registerTool(
    "ig_list_replies",
    {
      title: "List replies to a comment",
      description: "Replies to a comment on the account's media.",
      inputSchema: { comment_id: idInput, ...pagingShape },
      annotations: READ_ONLY,
    },
    safe(async ({ comment_id, limit, after }) => {
      const { items, next_cursor } = await ctx.client.collect(`/${comment_id}/replies`, { fields: COMMENT_FIELDS, after }, limit);
      return jsonResult({ count: items.length, next_cursor, replies: items });
    }),
  );

  server.registerTool(
    "ig_reply_comment",
    {
      title: "Reply to a comment",
      description: "Posts a public reply to a comment. Requires IG_ENABLE_WRITES=true.",
      inputSchema: { comment_id: idInput, message: messageInput },
      annotations: WRITES,
    },
    safe(async ({ comment_id, message }) => {
      requireWrites(ctx);
      return jsonResult(await ctx.client.post(`/${comment_id}/replies`, { message }));
    }),
  );

  server.registerTool(
    "ig_comment_on_media",
    {
      title: "Comment on own media",
      description: "Adds a top-level comment to one of the account's posts or reels. Requires IG_ENABLE_WRITES=true.",
      inputSchema: { media_id: idInput, message: messageInput },
      annotations: WRITES,
    },
    safe(async ({ media_id, message }) => {
      requireWrites(ctx);
      return jsonResult(await ctx.client.post(`/${media_id}/comments`, { message }));
    }),
  );

  server.registerTool(
    "ig_hide_comment",
    {
      title: "Hide or unhide a comment",
      description: "Hides a comment from the public (or shows it again with hide=false). Requires IG_ENABLE_WRITES=true.",
      inputSchema: { comment_id: idInput, hide: z.boolean().default(true) },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ comment_id, hide }) => {
      requireWrites(ctx);
      return jsonResult({ comment_id, hidden: hide, ...(await ctx.client.post<object>(`/${comment_id}`, { hide })) });
    }),
  );

  server.registerTool(
    "ig_delete_comment",
    {
      title: "Delete a comment",
      description: "Permanently deletes a comment on the account's media. Cannot be undone. Requires IG_ENABLE_WRITES=true.",
      inputSchema: { comment_id: idInput },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ comment_id }) => {
      requireWrites(ctx);
      return jsonResult({ comment_id, deleted: true, ...(await ctx.client.delete<object>(`/${comment_id}`)) });
    }),
  );

  server.registerTool(
    "ig_set_comments_enabled",
    {
      title: "Enable or disable comments",
      description: "Turns comments on or off for one of the account's posts. Requires IG_ENABLE_WRITES=true.",
      inputSchema: { media_id: idInput, enabled: z.boolean() },
      annotations: { ...WRITES, idempotentHint: true },
    },
    safe(async ({ media_id, enabled }) => {
      requireWrites(ctx);
      return jsonResult({ media_id, comment_enabled: enabled, ...(await ctx.client.post<object>(`/${media_id}`, { comment_enabled: enabled })) });
    }),
  );
}
