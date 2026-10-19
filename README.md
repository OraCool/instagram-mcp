# instagram-mcp

MCP server for the [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)
— let Claude (or any MCP client) work with your Instagram **Business or Creator** account:

> **Unofficial.** A community project, not affiliated with or endorsed by Meta or Instagram. It uses the official
> Graph API with your own access token — no password, no scraping, no private API.

- **Profile & media** — profile stats, posts, reels, stories, carousel children, media you're tagged in.
- **Insights** — account metrics (views, reach, engagement, followers, demographics) and per-post metrics.
- **Comments** — read, reply, comment, hide/unhide, delete, enable/disable comments.
- **Publishing** — images, reels, stories and carousels (2–10 items) from public URLs; daily quota check.
- **Direct messages** — list conversations, read recent messages, send text/image DMs and private replies to comments.

## Tools

| Tool | Purpose |
|---|---|
| `ig_token_status` | Which account the token belongs to, token source and expiry, whether writes are enabled |
| `ig_refresh_token` | Extend the long-lived token by 60 days (saved to `IG_TOKEN_CACHE_PATH`) |
| `ig_get_profile` | Username, bio, followers/follows/media counts |
| `ig_list_media` | Posts and reels with likes and comment counts (cursor paging) |
| `ig_get_media` | One media item, incl. carousel children |
| `ig_list_stories` | Currently live stories |
| `ig_list_tagged_media` | Media in which the account is tagged |
| `ig_account_insights` | Account metrics for a period, with breakdowns |
| `ig_media_insights` | Metrics of one post/reel/story (defaults by media type) |
| `ig_list_comments` / `ig_list_replies` | Comments of a post, replies of a comment |
| `ig_reply_comment` / `ig_comment_on_media` ✍️ | Reply to a comment / comment on own media |
| `ig_hide_comment` / `ig_delete_comment` ✍️ | Hide/unhide or delete a comment |
| `ig_set_comments_enabled` ✍️ | Turn comments on/off for a post |
| `ig_publish_image` / `ig_publish_reel` / `ig_publish_story` / `ig_publish_carousel` ✍️ | Publish from public media URLs |
| `ig_get_container_status` / `ig_publish_container` ✍️ | Check and finish a publish that was still processing |
| `ig_publishing_limit` | API posts used in the last 24 h (limit 100) |
| `ig_list_conversations` / `ig_get_messages` | DM threads and their latest 20 messages |
| `ig_send_message` ✍️ | Send a DM (text or image) or a private reply to a comment |

✍️ = changes your account; refused unless `IG_ENABLE_WRITES=true`.

## Setup

Requires Node.js 20+ and an Instagram Business or Creator account. Three ways to get a token — details in
**[docs/credentials.md](docs/credentials.md)**:

- **Paste a token** from your own Meta app's dashboard into `IG_ACCESS_TOKEN`.
- **Option 1 — `login` with your own app:**
  `IG_APP_ID=... IG_APP_SECRET=... npx -y github:OraCool/instagram-mcp login`
- **Option 2 — `login` through an app owner's login server** ([worker/](worker/README.md), Cloudflare Worker), for
  team members/clients added to that app: `IG_AUTH_SERVER=https://... npx -y github:OraCool/instagram-mcp login`

`login` saves the token to `~/.config/instagram-mcp/token.json`, which the server picks up automatically.

Register with Claude Code:

```bash
claude mcp add instagram -- npx -y github:OraCool/instagram-mcp            # after `login`
claude mcp add instagram -e IG_ACCESS_TOKEN=IGAA... -- npx -y github:OraCool/instagram-mcp   # pasted token
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "instagram": {
      "command": "npx",
      "args": ["-y", "github:OraCool/instagram-mcp"],
      "env": {
        "IG_ENABLE_WRITES": "false"
      }
    }
  }
}
```

From a clone: `npm install && npm run build`, then use `node /path/to/instagram-mcp/dist/index.js` as the command.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `IG_ACCESS_TOKEN` | — | Long-lived Instagram User access token (not needed after `login`) |
| `IG_USER_ID` | from `GET /me` | Professional account id |
| `IG_API_VERSION` | `v25.0` | Graph API version |
| `IG_TOKEN_CACHE_PATH` | `~/.config/instagram-mcp/token.json` | Token saved by `login`/refresh; takes precedence over `IG_ACCESS_TOKEN` |
| `IG_APP_ID`, `IG_APP_SECRET` | — | Option 1: your own Meta app, for `login` |
| `IG_REDIRECT_URI` | `https://oracool.github.io/instagram-mcp/callback/` | Option 1: redirect URI registered in your app |
| `IG_AUTH_SERVER` | — | Option 2: URL of a hosted login server (`worker/`) |
| `IG_ENABLE_WRITES` | `false` | Allow publishing, comment moderation and sending DMs |

## Good to know

- **Publishing** — media must be at a public URL (Meta downloads it); images must be JPEG. Video processing can
  take minutes: when it's not done within `wait_seconds` (default 60), the tool returns a pending `container_id`
  for `ig_publish_container`. Containers expire after 24 h. Max 100 API posts per rolling 24 h.
- **Messages** — you can reply only within 24 hours of the person's last message; text max 1000 bytes; only the
  20 most recent messages of a thread are readable.
- **Insights** — about 90 days of history; some metrics need 100+ followers; missing data comes back empty.
- **Not supported by this API** — personal accounts, ads, hashtag search, other accounts' stats (Business
  Discovery), and anything requiring Facebook Login.

## Development

```bash
npm install
npm test            # vitest, fake Graph API — no network
npm run typecheck
npm run build
npm run inspect     # MCP Inspector against dist/ with .env
```

## License

MIT
