import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, safe, type ToolContext } from "./context.js";
import { READ_ONLY, WRITES } from "./shared.js";

export function registerAuthTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "ig_token_status",
    {
      title: "Instagram token status",
      description:
        "Checks the configured access token: which account it belongs to, where it comes from (env or refreshed cache), " +
        "and its expiry when known. Also reports whether write actions are enabled.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const { source, state } = await ctx.tokens.info();
      const me = await ctx.client.get<Record<string, unknown>>("/me", { fields: "user_id,username,account_type" });
      const daysLeft = state.expires_at
        ? Math.floor((Date.parse(state.expires_at) - Date.now()) / 86_400_000)
        : undefined;
      return jsonResult({
        valid: true,
        account: me,
        source,
        obtained_at: state.obtained_at,
        expires_at: state.expires_at ?? "unknown (token from IG_ACCESS_TOKEN; long-lived tokens last 60 days from issue)",
        days_left: daysLeft,
        token_cache: ctx.config.tokenCachePath,
        writes_enabled: ctx.config.writesEnabled,
      });
    }),
  );

  server.registerTool(
    "ig_refresh_token",
    {
      title: "Refresh Instagram token",
      description:
        "Refreshes the long-lived access token for another 60 days (the token must be at least 24 hours old and not expired). " +
        "The new token is saved to the token cache file (IG_TOKEN_CACHE_PATH, default ~/.config/instagram-mcp/token.json).",
      inputSchema: {},
      annotations: WRITES,
    },
    safe(async () => {
      const next = await ctx.tokens.refresh();
      return jsonResult({
        refreshed: true,
        expires_at: next.expires_at,
        saved_to: ctx.config.tokenCachePath,
      });
    }),
  );
}
