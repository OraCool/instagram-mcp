# Getting an Instagram access token

instagram-mcp uses the **Instagram API with Instagram Login** (`graph.instagram.com`). In every case you need an
Instagram **professional account** (Business or Creator — in the Instagram app: *Settings → Account type and tools →
Switch to professional account*). A linked Facebook Page is *not* required.

Then pick one way to get a token:

| | Who it is for | You need |
|---|---|---|
| **A. Paste a token** | Quickest, your own account | Your own Meta app |
| **B. `login` with your own app** (option 1) | Your own account, token saved automatically | Your own Meta app + its secret |
| **C. `login` through someone's login server** (option 2) | Team members / clients of an app owner | The owner adds your account to their app |

All of them end with a long-lived token (60 days) that the server uses. B and C save it to
`~/.config/instagram-mcp/token.json` (or `IG_TOKEN_CACHE_PATH`), which takes precedence over `IG_ACCESS_TOKEN`.

## Create a Meta app (A and B)

1. Go to <https://developers.facebook.com/apps> and create an app. It's free; for your own account you don't need
   App Review or Business Verification.
2. Choose the use case **"Manage messaging & content on Instagram"** (Instagram API with Instagram Login).
3. Open **Instagram → API setup with Instagram login**.

## A. Paste a token

1. In *Generate access tokens*, click **Add account** and log in with your Instagram professional account.
2. Click **Generate token** and copy it.
3. Set it as `IG_ACCESS_TOKEN` in `.env` or in your MCP client config.

## B. `login` with your own app (option 1)

1. In *API setup with Instagram login → Set up Instagram business login → Business login settings*, add
   `https://oracool.github.io/instagram-mcp/callback/` to the valid OAuth redirect URIs.
   (Or host [`docs/callback/index.html`](callback/index.html) yourself and set `IG_REDIRECT_URI`.)
2. Copy the **Instagram app ID** and **Instagram app secret** from the same page.
3. Run:

   ```bash
   IG_APP_ID=... IG_APP_SECRET=... npx -y github:OraCool/instagram-mcp login
   ```

4. Approve in the browser. The callback page hands the one-time code to the command on your computer, which exchanges
   it with your secret — the secret never leaves your machine. If the browser can't reach the command, paste the code
   shown on the page into the terminal.

## C. `login` through a login server (option 2)

For app owners who want other people (team, clients) to connect **without** creating their own app.

- **App owner:** deploy the login server once — see [`worker/README.md`](../worker/README.md) — and add each person's
  Instagram account to the app as an **Instagram Tester** (*App roles → Roles → Add people*).
- **Person connecting:** accept the tester invite (Instagram → *Settings → Website permissions / Apps and websites →
  Tester invites*, or <https://www.instagram.com/accounts/manage_access/>), then run:

  ```bash
  IG_AUTH_SERVER=https://<owner's worker>.workers.dev npx -y github:OraCool/instagram-mcp login
  ```

  Approve in the browser; the token is delivered straight to the command on your computer and saved there. The login
  server does not store it, and you never see the app secret.

Without App Review (Standard Access) only accounts added to the app can log in — Meta enforces this. Opening the app
to anyone needs **Advanced Access** (App Review + Business Verification).

## Permissions (scopes)

`login` requests all of these; for tokens from the dashboard, enable them on the app.

| Scope | Needed for |
|---|---|
| `instagram_business_basic` | profile, media, stories, token refresh (always required) |
| `instagram_business_manage_insights` | `ig_account_insights`, `ig_media_insights` |
| `instagram_business_manage_comments` | comments, replies, hide/delete, tagged media |
| `instagram_business_content_publish` | `ig_publish_*` |
| `instagram_business_manage_messages` | `ig_list_conversations`, `ig_get_messages`, `ig_send_message` |

## Keeping the token alive

Long-lived tokens expire 60 days after they were issued or last refreshed. A token at least 24 hours old and not
expired can be refreshed for another 60 days with the `ig_refresh_token` tool (no app secret needed); the new token is
saved to the token cache file. An expired token cannot be refreshed — log in again.

## First run

```bash
npm run build && npm run inspect
```

In MCP Inspector call `ig_token_status`, then `ig_get_profile` and `ig_list_media`. Write tools stay disabled until
you set `IG_ENABLE_WRITES=true`.
