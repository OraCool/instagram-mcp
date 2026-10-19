import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Shared by the server and `instagram-mcp login`, so a login is picked up without extra configuration.
export const DEFAULT_TOKEN_CACHE_PATH = join(homedir(), ".config", "instagram-mcp", "token.json");
// Static page (GitHub Pages of this repo) that hands the login code back to the local CLI; register it in your app.
export const DEFAULT_REDIRECT_URI = "https://oracool.github.io/instagram-mcp/callback/";

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
  // Option 1 — login with your own Meta app (secret stays on this machine).
  IG_APP_ID: optionalString,
  IG_APP_SECRET: optionalString,
  IG_REDIRECT_URI: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.url().optional()),
  // Option 2 — login through a hosted token-exchange Worker (worker/) that holds the app secret.
  IG_AUTH_SERVER: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.url().optional()),
  IG_ENABLE_WRITES: z
    .string()
    .optional()
    .transform((v) => /^(true|1|yes)$/i.test(v?.trim() ?? "")),
});

export interface Config {
  accessToken?: string;
  userId?: string;
  apiVersion: string;
  tokenCachePath: string;
  writesEnabled: boolean;
  app?: { appId: string; appSecret: string };
  redirectUri: string;
  authServer?: string;
}

// A missing token is not fatal at startup: tools report a clear error instead, so the server can still be inspected.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    accessToken: parsed.IG_ACCESS_TOKEN,
    userId: parsed.IG_USER_ID,
    apiVersion: parsed.IG_API_VERSION,
    tokenCachePath: parsed.IG_TOKEN_CACHE_PATH ?? DEFAULT_TOKEN_CACHE_PATH,
    writesEnabled: parsed.IG_ENABLE_WRITES,
    app: parsed.IG_APP_ID && parsed.IG_APP_SECRET ? { appId: parsed.IG_APP_ID, appSecret: parsed.IG_APP_SECRET } : undefined,
    redirectUri: parsed.IG_REDIRECT_URI ?? DEFAULT_REDIRECT_URI,
    authServer: parsed.IG_AUTH_SERVER,
  };
}
