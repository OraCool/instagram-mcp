import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthTools } from "./tools/authTools.js";
import { registerCommentTools } from "./tools/commentTools.js";
import type { ToolContext } from "./tools/context.js";
import { registerInsightsTools } from "./tools/insightsTools.js";
import { registerMessagingTools } from "./tools/messagingTools.js";
import { registerProfileTools } from "./tools/profileTools.js";
import { registerPublishTools } from "./tools/publishTools.js";

// dist/server.js -> package root, both in the repo and in an installed package.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "instagram-mcp", version });
  registerAuthTools(server, ctx);
  registerProfileTools(server, ctx);
  registerInsightsTools(server, ctx);
  registerCommentTools(server, ctx);
  registerPublishTools(server, ctx);
  registerMessagingTools(server, ctx);
  return server;
}
