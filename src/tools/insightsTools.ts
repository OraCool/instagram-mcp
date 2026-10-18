import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_ACCOUNT_METRICS, DEFAULT_MEDIA_METRICS, type InsightValue, type Media } from "../instagram/types.js";
import { jsonResult, safe, type ToolContext } from "./context.js";
import { READ_ONLY, idInput } from "./shared.js";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use "YYYY-MM-DD"');

export function registerInsightsTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "ig_account_insights",
    {
      title: "Instagram account insights",
      description:
        "Account-level metrics (views, reach, engagement, followers, demographics). Instagram keeps about 90 days of data; " +
        "some metrics need 100+ followers. Metrics without data come back empty, not as 0. " +
        "Demographic metrics (follower_demographics, engaged_audience_demographics) need period=lifetime, " +
        "metric_type=total_value, a timeframe and a breakdown (age, city, country, gender).",
      inputSchema: {
        metrics: z
          .array(z.string().regex(/^[a-z_]+$/))
          .min(1)
          .default(DEFAULT_ACCOUNT_METRICS)
          .describe(
            "e.g. views, reach, accounts_engaged, total_interactions, likes, comments, saves, shares, replies, " +
              "follows_and_unfollows, profile_links_taps, follower_count, follower_demographics",
          ),
        period: z.enum(["day", "lifetime"]).default("day"),
        metric_type: z.enum(["total_value", "time_series"]).default("total_value"),
        breakdown: z.string().optional().describe("e.g. media_product_type, follow_type, contact_button_type, age, city, country, gender"),
        timeframe: z.string().optional().describe("Demographics only, e.g. this_week, this_month"),
        since: dateInput.optional().describe("Start date (UTC)"),
        until: dateInput.optional().describe("End date (UTC)"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ metrics, period, metric_type, breakdown, timeframe, since, until }) => {
      const igId = await ctx.getUserId();
      const response = await ctx.client.get<{ data: InsightValue[] }>(`/${igId}/insights`, {
        metric: metrics.join(","),
        period,
        metric_type,
        breakdown,
        timeframe,
        since: since ? toUnix(since) : undefined,
        until: until ? toUnix(until, true) : undefined,
      });
      return jsonResult(response.data);
    }),
  );

  server.registerTool(
    "ig_media_insights",
    {
      title: "Instagram media insights",
      description:
        "Metrics for one post, reel or story. Without `metrics`, a default set for the media type is used " +
        "(FEED / REELS / STORY). Only media of the connected account is supported.",
      inputSchema: {
        media_id: idInput,
        metrics: z.array(z.string().regex(/^[a-z_]+$/)).min(1).optional(),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ media_id, metrics }) => {
      let chosen = metrics;
      let productType: string | undefined;
      if (!chosen) {
        const media = await ctx.client.get<Media>(`/${media_id}`, { fields: "media_product_type,media_type" });
        productType = media.media_product_type;
        chosen = DEFAULT_MEDIA_METRICS[productType === "REELS" || productType === "STORY" ? productType : "FEED"];
      }
      const response = await ctx.client.get<{ data: InsightValue[] }>(`/${media_id}/insights`, { metric: chosen.join(",") });
      return jsonResult({
        media_id,
        media_product_type: productType,
        metrics: Object.fromEntries(response.data.map((m) => [m.name, m.total_value?.value ?? m.values?.[0]?.value ?? null])),
        raw: response.data,
      });
    }),
  );
}

function toUnix(date: string, endOfDay = false): number {
  return Math.floor(Date.parse(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`) / 1000);
}
