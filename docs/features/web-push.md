# Web Push Notifications

Server-pushed notifications to owners' phones/desktops via the standard Web
Push API. v1 ships one real notification — **pending trade offers** — plus
the plumbing (VAPID keys, per-franchise subscription storage, opt-in UI,
test button) that every future notification type reuses.

## Setup

### 1. Generate VAPID keys (once per environment)

```bash
pnpm generate:vapid          # runs scripts/generate-vapid-keys.mjs
```

### 2. Set Vercel env vars

| Var | Visibility | Purpose |
|-----|-----------|---------|
| `VAPID_PUBLIC_KEY` | server-only | Signs pushes (paired with private key) |
| `VAPID_PRIVATE_KEY` | server-only | Signs pushes — keep secret |
| `PUBLIC_VAPID_PUBLIC_KEY` | client bundle | Same value as `VAPID_PUBLIC_KEY`; the browser subscribes with it (Astro only exposes `PUBLIC_`-prefixed vars to `import.meta.env`) |
| `VAPID_SUBJECT` | server-only, optional | `mailto:`/`https:` contact URL sent to push services (defaults to `mailto:admin@theleague.us`) |

After setting them: redeploy, then `pnpm dlx vercel env pull` locally.

**Do not rotate the keys** once owners have subscribed — browsers bind each
subscription to the key it was created with, so rotation silently kills
every stored subscription (they'll get pruned as 404/410 on the next send,
and every owner has to re-enable).

Everything degrades cleanly when the vars are unset: the APIs return 503
with a clear message, and the settings card says "Not configured on this
server yet".

## Architecture

```
Browser (settings card)                    Server
──────────────────────                     ──────
pushManager.subscribe(PUBLIC key)
  └─ POST /api/push/subscribe ──────────▶ validate + store in Redis
                                           key: push:subs:{leagueId}:{franchiseId}
                                           field: sha256(endpoint) → JSON sub

Trade submitted (POST /api/trades/submit)
  └─ notifyTradeOfferPush() ────────────▶ sendPushToFranchise(league, offeredTo)
                                           └─ web-push signs + POSTs to each
                                              stored endpoint; 404/410 pruned

Push service ─▶ public/sw.js 'push' handler ─▶ showNotification
Click        ─▶ 'notificationclick' ─▶ focus existing tab or open payload.url
```

### Files

- `scripts/generate-vapid-keys.mjs` — one-shot key generator.
- `src/utils/push-subscriptions.ts` — Redis storage. One HASH per
  league+franchise; per-franchise cap (8) with oldest-first eviction;
  validation of client-supplied subscriptions (https endpoint, base64
  keys); dead-endpoint pruning.
- `src/utils/push-sender.ts` — `isPushConfigured()` +
  `sendPushToFranchise(leagueId, franchiseId, payload)`. Dynamically
  imports `web-push` (server-only, never bundled client-side). Prunes
  subscriptions the push service reports dead (404/410).
- `src/utils/push-notify-trade.ts` — the trade-offer notification:
  pure `buildTradeOfferPayload()` + `notifyTradeOfferPush()` wrapper.
- `src/pages/api/push/{subscribe,unsubscribe,test}.ts` — authed routes.
- `public/sw.js` — `push` + `notificationclick` handlers.
- `src/components/shared/NotificationSettingsCard.astro` — opt-in card.
- `src/pages/{theleague,afl-fantasy}/notifications.astro` — thin per-league
  wrappers (registered in `src/data/page-directory.json`).
- `tests/push-subscriptions.test.ts` — unit tests for the pure logic.

### Security invariants

- **Identity comes only from the session JWT** (`getAuthUser()`). The
  subscribe/unsubscribe/test routes act exclusively on the session's own
  `leagueId` + `franchiseId`; the body never chooses the target. This is
  what makes cross-league franchise-id overlap (AFL 0001 vs TheLeague
  0001) a non-issue — the league id in the Redis key comes from the JWT.
- All three routes are rate-limited via `src/utils/rate-limit.ts`
  (subscribe/unsubscribe 20/hr, test 5/10min, per league+franchise).
- Subscriptions are validated server-side (https endpoint, sane key
  shapes, size caps) and unknown fields are dropped before storage.
- Sending is fire-and-forget from business routes — a push failure can
  never fail the underlying action (e.g. the trade submit).

### Per-device model

A subscription belongs to one browser profile on one device. The settings
card reflects **this device's** state (`pushManager.getSubscription()`),
and each franchise can hold up to 8 subscriptions — oldest evicted first.
iOS requires the site installed to the Home Screen before push works; the
card says so.

The service worker is registered in production builds only (dev
unregisters it — see TheLeagueLayout), so test push flows on a preview
deployment, not `pnpm dev`.

## Adding a new notification type

1. **Build the payload with a pure function** in a new
   `src/utils/push-notify-<thing>.ts` (copy the shape of
   `push-notify-trade.ts`): return `{ title, body, url, tag, icon }`.
   Use `leaguePushIcon(navSlug)` for the icon, a site-relative `url`
   (that's what the SW opens on click), and a stable `tag` so repeat
   notifications collapse instead of stacking.
2. **Wrap it** in a `notify*` function that resolves league/team context
   (registry lookups — never hardcode league ids) and calls
   `sendPushToFranchise`. Guard with `isPushConfigured()` and never throw.
3. **Call it fire-and-forget** (`void (async () => { ... })()`) from the
   server-side event source — an API route, cron script, or scanner.
4. **Unit-test the pure payload builder** in
   `tests/push-subscriptions.test.ts` or a sibling file.
5. No SW change needed — the `push` handler renders any payload matching
   the `{ title, body, url?, tag?, icon? }` contract.
6. Mention the new alert type in the notifications page copy if it's
   user-visible.

v1 deliberately has no per-type preferences — enabling push means "all
notification types". If/when there are enough types to matter, store a
per-franchise preference map alongside the subscriptions and filter in
`sendPushToFranchise`.
