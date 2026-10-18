import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, safe, type ToolContext } from "./context.js";
import { READ_ONLY, WRITES, idInput, requireWrites } from "./shared.js";

const MESSAGE_FIELDS = "id,created_time,from,to,message";
const MAX_TEXT_BYTES = 1000; // Meta: message text must be UTF-8 and at most 1000 bytes

export function registerMessagingTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "ig_list_conversations",
    {
      title: "List DM conversations",
      description:
        "Direct-message conversations of the account, most recently updated first. With user_id (an Instagram-scoped id) " +
        "returns only the conversation with that person. Request-folder threads inactive for 30 days are not returned.",
      inputSchema: {
        user_id: idInput.optional().describe("Instagram-scoped user id (IGSID) of the other participant"),
        limit: z.number().int().min(1).max(100).default(20),
        after: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ user_id, limit, after }) => {
      const { items, next_cursor } = await ctx.client.collect(
        "/me/conversations",
        { platform: "instagram", user_id, fields: "id,updated_time", after },
        limit,
      );
      return jsonResult({ count: items.length, next_cursor, conversations: items });
    }),
  );

  server.registerTool(
    "ig_get_messages",
    {
      title: "Get DM messages",
      description: "Messages of one conversation with sender, recipient and text. Instagram only returns the 20 most recent messages.",
      inputSchema: { conversation_id: z.string().regex(/^[\w-]+$/, "Invalid conversation id") },
      annotations: READ_ONLY,
    },
    safe(async ({ conversation_id }) => {
      const conversation = await ctx.client.get<{ messages?: { data: { id: string }[] } }>(`/${conversation_id}`, { fields: "messages" });
      const ids = (conversation.messages?.data ?? []).map((m) => m.id);
      const messages = await Promise.all(ids.map((id) => ctx.client.get(`/${encodeURIComponent(id)}`, { fields: MESSAGE_FIELDS })));
      return jsonResult({ conversation_id, count: messages.length, messages });
    }),
  );

  server.registerTool(
    "ig_send_message",
    {
      title: "Send a direct message",
      description:
        "Sends a DM with text or one image. Instagram only allows it within 24 hours of the person's last message. " +
        "recipient_comment_id sends a private reply to a commenter instead (one per comment). Requires IG_ENABLE_WRITES=true.",
      inputSchema: {
        recipient_id: idInput.optional().describe("Instagram-scoped id (IGSID) of the recipient"),
        recipient_comment_id: idInput.optional().describe("Comment id for a private reply to its author"),
        text: z.string().min(1).optional(),
        image_url: z.url({ protocol: /^https?$/ }).optional().describe("Public PNG/JPEG URL, up to 8 MB"),
      },
      annotations: WRITES,
    },
    safe(async ({ recipient_id, recipient_comment_id, text, image_url }) => {
      requireWrites(ctx);
      if (Boolean(recipient_id) === Boolean(recipient_comment_id)) {
        throw new Error("Provide exactly one of recipient_id or recipient_comment_id");
      }
      if (Boolean(text) === Boolean(image_url)) throw new Error("Provide exactly one of text or image_url");
      if (text && Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
        throw new Error(`Message text is ${Buffer.byteLength(text, "utf8")} bytes; Instagram allows at most ${MAX_TEXT_BYTES}`);
      }
      const igId = await ctx.getUserId();
      const body = {
        recipient: recipient_id ? { id: recipient_id } : { comment_id: recipient_comment_id },
        message: text ? { text } : { attachment: { type: "image", payload: { url: image_url } } },
      };
      return jsonResult(await ctx.client.request(`/${igId}/messages`, { method: "POST", body }));
    }),
  );
}
