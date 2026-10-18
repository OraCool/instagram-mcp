import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { InstagramClient, type FetchLike } from "../instagram/client.js";
import { TokenStore } from "../instagram/token.js";

export interface ToolContext {
  config: Config;
  client: InstagramClient;
  tokens: TokenStore;
  /** IG_USER_ID, or the professional account id resolved once from GET /me. */
  getUserId(): Promise<string>;
  sleep(ms: number): Promise<void>;
}

export interface ContextOptions {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export function createContext(config: Config, options: ContextOptions = {}): ToolContext {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokens = new TokenStore(config.accessToken, config.tokenCachePath, fetchImpl, options.now);
  const client = new InstagramClient(tokens, config.apiVersion, fetchImpl);
  let userId: Promise<string> | undefined = config.userId ? Promise.resolve(config.userId) : undefined;
  return {
    config,
    client,
    tokens,
    getUserId() {
      userId ??= client.get<{ user_id?: string; id: string }>("/me", { fields: "user_id,id" }).then((me) => me.user_id ?? me.id);
      // Do not cache a failure (e.g. missing token): the next call should retry.
      userId.catch(() => (userId = undefined));
      return userId;
    },
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Wraps a handler so thrown errors come back as tool errors the model can read and act on. */
export function safe<A>(handler: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  };
}
