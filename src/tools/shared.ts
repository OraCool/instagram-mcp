import { z } from "zod";
import type { ToolContext } from "./context.js";

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
export const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

// Graph object ids are numeric strings; reject anything that could change the request path.
export const idInput = z.string().regex(/^\d+$/, "Expected a numeric Instagram id");

export const pagingShape = {
  limit: z.number().int().min(1).max(500).default(25).describe("Maximum items returned"),
  after: z.string().optional().describe("Cursor from a previous call's next_cursor"),
};

/** Publishing, comment moderation and messaging act on a real account: they need IG_ENABLE_WRITES=true. */
export function requireWrites(ctx: ToolContext): void {
  if (!ctx.config.writesEnabled) {
    throw new Error("Write actions are disabled: the server runs without IG_ENABLE_WRITES=true");
  }
}
