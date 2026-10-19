# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — compile `src/` → `dist/` (tsc, ESM, NodeNext). The MCP entrypoint is `dist/index.js`.
- `npm test` — vitest; single test: `npx vitest run test/server.test.ts -t "name"`.
- `npm run typecheck` — tsc without emit.
- `npm run inspect` — MCP Inspector against the built server (reads `.env`).
- `npm run login` — `instagram-mcp login` with `.env`.
- Worker (`worker/`): `npx wrangler deploy --dry-run` to check the bundle; typechecked by `npm run typecheck`
  (`worker/tsconfig.json`), tested from `test/login.test.ts`.
- Only `dist/**/*.js` and `docs/credentials.md` are shipped (`files`); check with `npm pack --dry-run`.

## Architecture

stdio MCP server on the official `@modelcontextprotocol/sdk` (`McpServer.registerTool` + zod input shapes), same
layout as the sibling `bepaid-mcp`.

- `src/index.ts` only wires config → `createServer` (`src/server.ts`) → stdio. Tests build the context with
  `createContext(config, { fetchImpl, sleep })` and connect through `InMemoryTransport` — see `test/server.test.ts`
  and the routed fake API in `test/fakeGraph.ts`.
- `src/tools/*` — one file per feature group; handlers wrapped in `safe()` (errors become `isError` results).
  Every tool that changes the account calls `requireWrites(ctx)` first (`IG_ENABLE_WRITES`, default off).
  Missing token is reported per call, not at startup.
- `src/instagram/client.ts` — thin `fetch` client for `graph.instagram.com/<IG_API_VERSION>`; Bearer token read from
  `TokenStore` on every request; Graph `{error:{...}}` bodies → `InstagramError` with code hints; `collect()` follows
  `paging.cursors.after`.
- `src/instagram/token.ts` — token source: `IG_TOKEN_CACHE_PATH` file (if present) over `IG_ACCESS_TOKEN`.
  `refresh()` calls the unversioned `/refresh_access_token` and writes the cache atomically with mode 0600.
  `shouldRefresh()` decides automatic refresh in `getToken()`.
- `src/instagram/publish.ts` — container flow: `POST /<IG_ID>/media` → poll `status_code` → `POST /<IG_ID>/media_publish`.
  The wait is bounded by `wait_seconds` (MCP calls must not block for minutes); unfinished containers are returned
  as `pending` for `ig_publish_container`. Carousels wait for every child under one shared budget.
- Login (`src/login.ts`, `src/instagram/oauth.ts`, `worker/`, `docs/callback/index.html`): `instagram-mcp login`
  starts a one-off listener on 127.0.0.1 and passes its port + random nonce through OAuth `state`. Option 1
  (`IG_APP_ID`/`IG_APP_SECRET`): Instagram redirects to the static GitHub Pages callback, which form-POSTs the code to
  the listener; the code is exchanged locally. Option 2 (`IG_AUTH_SERVER`): the Cloudflare Worker signs `state`
  (HMAC with the app secret, 15 min), exchanges the code and form-POSTs the token to the listener. The listener only
  accepts its nonce. Tokens never go into URLs. `oauth.ts` must stay web-standard (no Node APIs): the Worker bundles it.
- Several accounts = several server entries: `IG_ACCOUNT` → `~/.config/instagram-mcp/<name>.token.json`
  (`login --account <name>`). `authorizeUrl` always sets `force_reauth=true` so a second login can't silently reuse
  the browser's Instagram session; `login` prints the connected @username.
- Token cache defaults to `~/.config/instagram-mcp/token.json` (`DEFAULT_TOKEN_CACHE_PATH`); tests must always pass
  an explicit `IG_TOKEN_CACHE_PATH` so a real login on the machine can't leak in.
- The code exchange response has `user_id` as a JSON number > 2^53; `exchangeCode` quotes it before parsing.
- Ids in tool inputs are validated as numeric (`idInput`) so they can't alter request paths.

## Conventions

- Tests, fixtures, docs and examples must never contain real account data (usernames, ids, tokens, captions,
  messages). Use invented values such as `demo.studio`, `cdn.example.com`, ids `1784…0001`.
- Keep `docs/credentials.md` limited to what Meta's docs confirm.
- `.env`, `*.token.json`, `.wrangler/`, `private/` and `coverage/` are git-ignored; never commit tokens or app secrets
  (the Worker secret lives only in Cloudflare: `wrangler secret put`).
- `docs/` is published by GitHub Pages; `docs/callback/index.html` is the default option-1 redirect URI — changing its
  path breaks redirect URIs registered in users' apps.
- Only the Instagram Login path (`graph.instagram.com`) is supported; Facebook-Login-only features (hashtag search,
  Business Discovery, ads) are out of scope.

## Unverified details (check against a real account before relying on them)

- DM image body: `message.attachment` (singular) is used; Meta's docs show both `attachment` and `attachments`.
- Private replies via `recipient.comment_id` on the Instagram Login path.
- Whether Meta accepts the GitHub Pages / workers.dev callback as redirect URIs without extra domain verification.
- Exact dashboard menu names for adding Instagram Testers and accepting invites.
- Exact availability of individual insight metrics per media type (`DEFAULT_MEDIA_METRICS` in `src/instagram/types.ts`).
- `content_publishing_limit` field names (`config`, `quota_usage`).
