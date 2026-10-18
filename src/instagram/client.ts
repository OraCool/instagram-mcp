// Thin fetch wrapper for graph.instagram.com (Instagram API with Instagram Login). Bearer auth with an
// Instagram User access token taken from the TokenStore on every call, because refreshing replaces the token.

import type { TokenStore } from "./token.js";

export const GRAPH_HOST = "https://graph.instagram.com";

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}

export type Params = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  params?: Params; // query string
  body?: unknown; // JSON body (POST only)
  versioned?: boolean; // default true: prefix the path with the API version
}

export interface Page<T> {
  data: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string; previous?: string };
}

export type FetchLike = typeof fetch;

export class InstagramClient {
  constructor(
    private readonly tokens: TokenStore,
    private readonly apiVersion: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = await this.tokens.getToken();
    const url = new URL(`${GRAPH_HOST}${options.versioned === false ? "" : `/${this.apiVersion}`}${path}`);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const response = await this.fetchImpl(url.toString(), {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const data = text ? safeJson(text) : undefined;
    const graphError = extractError(data);
    if (!response.ok || graphError) {
      throw new InstagramError(describeError(response.status, graphError, text), response.status, graphError?.code, data);
    }
    return data as T;
  }

  get<T = unknown>(path: string, params?: Params) {
    return this.request<T>(path, { params });
  }

  post<T = unknown>(path: string, params?: Params, body?: unknown) {
    return this.request<T>(path, { method: "POST", params, body });
  }

  delete<T = unknown>(path: string, params?: Params) {
    return this.request<T>(path, { method: "DELETE", params });
  }

  /** Follows `paging.cursors.after` until `limit` items are collected or there are no more pages. */
  async collect<T>(path: string, params: Params, limit: number): Promise<{ items: T[]; next_cursor?: string }> {
    const items: T[] = [];
    let after = typeof params.after === "string" ? params.after : undefined;
    for (;;) {
      const page = await this.get<Page<T>>(path, { ...params, limit: Math.min(limit - items.length, 100), after });
      items.push(...(page.data ?? []));
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!after || items.length >= limit) return { items: items.slice(0, limit), next_cursor: after };
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
}

// Graph errors look like {"error": {"message", "type", "code", "error_subcode", "error_user_msg", "fbtrace_id"}}.
function extractError(data: unknown): GraphError | undefined {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error: unknown }).error;
    if (error && typeof error === "object") return error as GraphError;
  }
  return undefined;
}

const HINTS: Record<number, string> = {
  4: "application rate limit reached, retry later",
  10: "permission not granted to the app or token",
  100: "invalid parameter",
  190: "access token is invalid or expired: refresh it (ig_refresh_token) or generate a new one",
  200: "permission not granted to the app or token",
  368: "the action was blocked by Instagram",
  9004: "media URL could not be fetched: it must be public and in a supported format",
  9007: "media is not ready to publish yet",
};

function describeError(status: number, error: GraphError | undefined, raw: string): string {
  if (error) {
    const code = error.code !== undefined ? ` (code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ""})` : "";
    const hint = error.code !== undefined && HINTS[error.code] ? ` — ${HINTS[error.code]}` : "";
    const user = error.error_user_msg ? ` ${error.error_user_msg}` : "";
    return `Instagram ${status}${code}: ${error.message ?? error.type ?? "error"}${user}${hint}`;
  }
  return `Instagram ${status}: ${raw.slice(0, 300) || "empty response"}`;
}
