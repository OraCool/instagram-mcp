# instagram-mcp login server (Cloudflare Worker)

Lets people log in to **your** Meta app with `instagram-mcp login` without receiving its secret (option 2 in
[docs/credentials.md](../docs/credentials.md)). About 150 lines, no storage, no logging of tokens.

```
login command ──▶ /start ──▶ instagram.com/oauth/authorize ──▶ /callback ──(form POST)──▶ http://127.0.0.1:<port>
 (port + nonce)    signs state        user approves             exchanges code            token saved locally
```

- `state` is HMAC-signed with the app secret and expires after 15 minutes, so the Worker only exchanges codes for
  logins it started and only posts to `127.0.0.1`.
- The token is sent in a POST body (never in a URL), and pages are `Cache-Control: no-store`.
- Only Instagram accounts added to your app can complete the login (Standard Access).

## Deploy

Requires a free Cloudflare account.

```bash
cd worker
# 1. Your Instagram app ID (Meta dashboard → Instagram → API setup with Instagram login):
#    put it into wrangler.toml → [vars] IG_APP_ID
npx wrangler login
npx wrangler secret put IG_APP_SECRET     # paste the Instagram app secret
npx wrangler deploy                       # prints https://instagram-mcp-auth.<you>.workers.dev
```

Then in the Meta dashboard (*Business login settings*) add `https://instagram-mcp-auth.<you>.workers.dev/callback` to
the valid OAuth redirect URIs, and add each person as an **Instagram Tester** (*App roles → Roles*).

Give people the Worker URL:

```bash
IG_AUTH_SERVER=https://instagram-mcp-auth.<you>.workers.dev npx -y github:OraCool/instagram-mcp login
```

## Revoking access

Remove the person from the app's roles, or rotate the app secret (`npx wrangler secret put IG_APP_SECRET` with the new
value). Tokens already issued stay valid until they expire or the person removes the app in Instagram settings.
