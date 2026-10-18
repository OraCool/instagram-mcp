# Getting an Instagram access token

instagram-mcp uses the **Instagram API with Instagram Login** (`graph.instagram.com`). You need:

- an Instagram **professional account** (Business or Creator). A linked Facebook Page is *not* required;
- a Meta developer app with the Instagram use case;
- a long-lived **Instagram User access token** for that account.

## 1. Switch the account to professional

In the Instagram app: *Settings → Account type and tools → Switch to professional account* (Business or Creator).

## 2. Create a Meta app

1. Go to <https://developers.facebook.com/apps> and create an app.
2. Choose the use case **"Manage messaging & content on Instagram"** (Instagram API with Instagram Login).
3. In the app dashboard open **Instagram → API setup with Instagram login**.

## 3. Add the account and generate a token

1. In *Generate access tokens*, click **Add account** and log in with the Instagram professional account.
   Accounts you add here must also accept the tester invite if Instagram asks for it.
2. Click **Generate token** next to the account and copy it. Tokens generated in the dashboard are long-lived
   (60 days).
3. Put it into `.env` (or your MCP client config) as `IG_ACCESS_TOKEN`.

## 4. Permissions (scopes)

| Scope | Needed for |
|---|---|
| `instagram_business_basic` | profile, media, stories, token refresh (always required) |
| `instagram_business_manage_insights` | `ig_account_insights`, `ig_media_insights` |
| `instagram_business_manage_comments` | comments, replies, hide/delete, tagged media |
| `instagram_business_content_publish` | `ig_publish_*` |
| `instagram_business_manage_messages` | `ig_list_conversations`, `ig_get_messages`, `ig_send_message` |

## 5. Standard vs. Advanced Access

- **Standard Access** is enough for accounts you own or manage and have added to the app in the dashboard —
  the normal setup for using this server with your own account. No App Review needed.
- **Advanced Access** (App Review + Business Verification) is only needed to serve accounts you don't own or manage.

## 6. Keeping the token alive

Long-lived tokens expire 60 days after they were issued or last refreshed. A token that is at least 24 hours old
and not expired can be refreshed for another 60 days:

- call the `ig_refresh_token` tool, and
- set `IG_TOKEN_CACHE_PATH` (e.g. `~/.config/instagram-mcp/ig.token.json`) so the new token is saved; the file
  then takes precedence over `IG_ACCESS_TOKEN`. Without it, copy the new token into your config yourself.

An expired token cannot be refreshed — generate a new one in the dashboard (step 3).

## 7. First run

```bash
cp .env.example .env   # fill IG_ACCESS_TOKEN
npm run build && npm run inspect
```

In MCP Inspector call `ig_token_status`, then `ig_get_profile` and `ig_list_media`. Write tools stay disabled until
you set `IG_ENABLE_WRITES=true`.
