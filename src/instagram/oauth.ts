// Business Login for Instagram. Web-standard APIs only (fetch, URL): also bundled into the Cloudflare Worker in worker/.
//
// 1. https://www.instagram.com/oauth/authorize → redirect_uri?code=...&state=... (code: 1 hour, single use)
// 2. POST https://api.instagram.com/oauth/access_token (client secret) → short-lived token
// 3. GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token (client secret) → long-lived, 60 days

export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_insights",
  "instagram_business_manage_comments",
  "instagram_business_content_publish",
  "instagram_business_manage_messages",
] as const;

export interface AppCredentials {
  appId: string;
  appSecret: string;
}

export interface LongLivedToken {
  access_token: string;
  user_id?: string;
  expires_in?: number; // seconds
}

export function authorizeUrl(appId: string, redirectUri: string, scopes: readonly string[], state: string): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("state", state);
  // Always ask which account to connect: otherwise a second login silently reuses the browser's Instagram session.
  url.searchParams.set("force_reauth", "true");
  return url.toString();
}

/** Instagram may append "#_" to the redirect; it is not part of the code. Accepts a bare code or the full redirect URL. */
export function cleanCode(input: string): string {
  let code = input.trim();
  if (/^https?:\/\//.test(code)) code = new URL(code).searchParams.get("code") ?? "";
  return code.replace(/#_?$/, "");
}

export async function exchangeCode(
  app: AppCredentials,
  redirectUri: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LongLivedToken> {
  const shortResponse = await fetchImpl("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: app.appId,
      client_secret: app.appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: cleanCode(code),
    }),
  });
  // user_id comes as a JSON number larger than 2^53: quote it before parsing so no digits are lost.
  const shortText = (await shortResponse.text()).replace(/("user_id"\s*:\s*)(\d+)/g, '$1"$2"');
  const shortData = parseJson(shortText);
  // Documented as {data: [{access_token, user_id, permissions}]}; older responses are flat.
  const short = Array.isArray(shortData.data) ? shortData.data[0] : shortData;
  if (!shortResponse.ok || !short?.access_token) {
    throw new Error(`Code exchange failed: ${describe(shortData, shortResponse.status)}`);
  }

  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", app.appSecret);
  longUrl.searchParams.set("access_token", short.access_token);
  const longResponse = await fetchImpl(longUrl.toString(), { headers: { Accept: "application/json" } });
  const long = (await longResponse.json().catch(() => ({}))) as Record<string, any>;
  if (!longResponse.ok || !long.access_token) {
    throw new Error(`Long-lived token exchange failed: ${describe(long, longResponse.status)}`);
  }
  return { access_token: long.access_token, expires_in: long.expires_in, user_id: short.user_id ? String(short.user_id) : undefined };
}

function parseJson(text: string): Record<string, any> {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function describe(data: Record<string, any>, status: number): string {
  return data.error_message ?? data.error?.message ?? data.error_description ?? `HTTP ${status}`;
}
