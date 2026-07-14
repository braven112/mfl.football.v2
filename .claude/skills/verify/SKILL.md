---
name: verify
description: How to run and drive this app locally to verify a change end-to-end (dev server, auth cookie forging, screenshots).
---

# Verifying changes in this repo

## Launch

```bash
pnpm install                      # if node_modules missing
JWT_SECRET=<any-string> pnpm dev --port 4399
```

Set `JWT_SECRET` explicitly — without it the server generates a random
secret per boot and you can't forge a session cookie. No `.env.local` is
needed just to render pages; KV-backed writes (drafts, etc.) will 500
without it, reads are fine.

## Authenticated requests

Auth is a signed `session_token` cookie (HS256 JWT, see
`src/utils/session.ts`). Forge one with the same secret you launched with:

```bash
SECRET=<same-string> node -e "
const {createHmac} = require('crypto');
const now = Math.floor(Date.now()/1000);
const payload = {userId:'MFL_TEST', username:'Verifier', franchiseId:'0001',
  leagueId:'19621', role:'owner', issuedAt:now, expiresAt:now+86400, iat:now, exp:now+86400};
const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
const s = createHmac('sha256', process.env.SECRET).update(h+'.'+p).digest('base64url');
console.log(h+'.'+p+'.'+s);"
```

`leagueId` `'19621'` = AFL, `'13522'` = TheLeague. Then
`curl -H "Cookie: session_token=$TOKEN" http://localhost:4399/...`.

## Screenshots (remote sandbox)

Playwright is in node_modules; Chromium is pre-installed:

- `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`
- Run the script from the **repo root** (module resolution) — write it to a
  temp file in the repo, delete after.
- Do NOT pass the sandbox HTTPS proxy to Chromium — it breaks localhost.
- AFL team icons point at `https://mflfootballv2.vercel.app/...` but the
  files exist locally in `public/` — `page.route` that host and
  `route.fulfill({ path: 'public' + pathname })` (route.continue can't
  switch https→http).
- External headshot hosts (espncdn, myfantasyleague) are unreachable —
  fulfill them with a placeholder image or accept broken avatars.
- Dark mode: add cookie `theme_pref=dark`.

## Test data

Feeds are committed JSON under `data/<league>/mfl-feeds/<year>/`, loaded
via eager `import.meta.glob` — the dev server picks up edits, but a **newly
created** file matching a glob needs a server restart. Back up any feed you
seed and restore it before committing.
