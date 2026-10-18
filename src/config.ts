import { z } from "zod";

const optionalString = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string().optional());

const envSchema = z.object({
  IG_ACCESS_TOKEN: optionalString,
  IG_USER_ID: optionalString,
  IG_API_VERSION: z
    .string()
    .trim()
    .regex(/^v\d+\.\d+$/, 'Use a Graph API version such as "v25.0"')
    .default("v25.0"),
  IG_TOKEN_CACHE_PATH: optionalString,
  IG_ENABLE_WRITES: z
    .string()
    .optional()
    .transform((v) => /^(true|1|yes)$/i.test(v?.trim() ?? "")),
});

export interface Config {
  accessToken?: string;
  userId?: string;
  apiVersion: string;
  tokenCachePath?: string;
  writesEnabled: boolean;
}

// A missing token is not fatal at startup: tools report a clear error instead, so the server can still be inspected.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    accessToken: parsed.IG_ACCESS_TOKEN,
    userId: parsed.IG_USER_ID,
    apiVersion: parsed.IG_API_VERSION,
    tokenCachePath: parsed.IG_TOKEN_CACHE_PATH,
    writesEnabled: parsed.IG_ENABLE_WRITES,
  };
}
