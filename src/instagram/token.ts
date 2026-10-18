import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { GRAPH_HOST, InstagramError, type FetchLike } from "./client.js";

// Long-lived Instagram User tokens live 60 days. A refresh (token at least 24h old, not expired) returns a NEW
// token valid for 60 days from the refresh, so refreshed tokens are persisted to IG_TOKEN_CACHE_PATH.

export const MIN_REFRESH_AGE_MS = 24 * 3_600_000;

const tokenStateSchema = z.object({
  access_token: z.string().min(1),
  expires_at: z.string().optional(), // ISO time; unknown for a token pasted into IG_ACCESS_TOKEN
  obtained_at: z.string().optional(), // ISO time the token was issued or refreshed, if known
});
export type TokenState = z.infer<typeof tokenStateSchema>;

export interface TokenInfo {
  source: "cache" | "env";
  state: TokenState;
}

/**
 * Decides whether getToken() refreshes the token automatically before a request.
 * `state.expires_at` / `state.obtained_at` may be undefined (token pasted from the App Dashboard).
 * Meta's constraints: the token must be at least 24h old (MIN_REFRESH_AGE_MS) and not expired.
 */
export function shouldRefresh(state: TokenState, now: Date): boolean {
  // TODO(user): implement the auto-refresh policy. Returning false means refresh only via ig_refresh_token.
  void state;
  void now;
  return false;
}

export class TokenStore {
  private current?: TokenInfo;

  constructor(
    private readonly envToken: string | undefined,
    private readonly cachePath: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The cache file (when present) wins over IG_ACCESS_TOKEN: it holds the latest refreshed token. */
  async info(): Promise<TokenInfo> {
    if (this.current) return this.current;
    const cached = this.cachePath ? await readCache(this.cachePath) : undefined;
    if (cached) this.current = { source: "cache", state: cached };
    else if (this.envToken) this.current = { source: "env", state: { access_token: this.envToken } };
    else {
      throw new InstagramError(
        "Instagram access token is not configured: set IG_ACCESS_TOKEN (see docs/credentials.md)",
        0,
      );
    }
    return this.current;
  }

  async getToken(): Promise<string> {
    const { state } = await this.info();
    if (shouldRefresh(state, this.now())) {
      try {
        return (await this.refresh()).access_token;
      } catch (error) {
        // The old token is still valid; report and carry on.
        console.error(`instagram-mcp: automatic token refresh failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    return state.access_token;
  }

  async refresh(): Promise<TokenState> {
    const { state } = await this.info();
    const url = new URL(`${GRAPH_HOST}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", state.access_token);
    const response = await this.fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string; code?: number };
    };
    if (!response.ok || !data.access_token) {
      const reason = data.error?.message ?? `HTTP ${response.status}`;
      throw new InstagramError(
        `Token refresh failed: ${reason}. Only long-lived tokens at least 24 hours old and not expired can be refreshed.`,
        response.status,
        data.error?.code,
        data,
      );
    }
    const now = this.now();
    const next: TokenState = {
      access_token: data.access_token,
      obtained_at: now.toISOString(),
      expires_at: data.expires_in ? new Date(now.getTime() + data.expires_in * 1000).toISOString() : undefined,
    };
    if (this.cachePath) await writeCache(this.cachePath, next);
    this.current = { source: this.cachePath ? "cache" : "env", state: next };
    return next;
  }
}

async function readCache(path: string): Promise<TokenState | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = tokenStateSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`Token cache ${path} is not valid: delete it or fix its contents`);
  return parsed.data;
}

// Write-then-rename so a crash never leaves a half-written token file; 0600 because it holds a credential.
async function writeCache(path: string, state: TokenState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}
