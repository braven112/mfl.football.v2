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

## Per-category preferences

Shipped, and built exactly as this doc originally prescribed: a
per-franchise preference map alongside the subscriptions, filtered inside
`sendPushToFranchise`.

- `src/config/notification-categories.ts` — the registry. One entry per
  alert type: label, description, cadence, group, `defaultOn`, an optional
  `requiresFeature` league gate, and `live`.
- `src/utils/push-preferences.ts` — Redis storage,
  `push:prefs:{leagueId}:{franchiseId}`. Only EXPLICIT choices are stored,
  so a category added later still ships with its intended default rather
  than arriving off for every owner who ever opened the page.
- `src/pages/api/push/preferences.ts` — GET/POST for the command center.
- `src/components/shared/notifications/NotificationCommandCenter.tsx` — the
  settings UI, on both leagues' `/notifications` pages.

**`category` is a required argument to `sendPushToFranchise`.** It is
checked at that one door rather than at each call site: a preference
honoured by some senders and not others is worse than none at all. An
unknown category is REFUSED, so a typo cannot become a way around every
setting an owner has chosen.

**`live: false` means "no sender yet".** Such a category is hidden from the
settings page — a switch that silently does nothing is worse than an absent
one — and `tests/notification-preferences.test.ts` fails if a category is
marked live while no code references its id. That guard caught four during
the build.

**Cron scripts** cannot import the TypeScript sender, so they compose the
copy and POST it to `src/pages/api/cron/push-fanout.ts` (CRON_SECRET-gated)
via `scripts/lib/push-fanout.mjs`.

## Where each category is sent from

Every category in the registry is live as of Sept 2026. The senders:

| Category | Sender |
|---|---|
| `lineup-deadline` | `scripts/schefter-lineup-check.mjs` |
| `roster-deadline` | `scanEventReminders` in `scripts/schefter-scan.mjs` |
| `transaction-big` / `transaction-all` | `scripts/schefter-scan.mjs` |
| `rumor` | `scripts/schefter-rumor-scan.mjs` |
| `player-news` | `scripts/push-player-news.mjs` (Roster Sync) |
| `scoring-final` / `scoring-swing` | `scripts/push-gameday-alerts.mjs` (Roster Sync) |
| owners-poll categories | `scripts/generate-pecking-order.mjs` + the poll close pass |
| `weekly-recap` etc. | `scripts/schefter-weekly-articles.mjs` |

The last two scripts ride Roster Sync rather than taking crons of their own:
it already runs every five minutes with a checkout, and both read feeds it
has just fetched. Both are non-fatal by design and run BEFORE the commit
step — a push outage must never cost the feed write that already succeeded.

### Game-day alerts

`scripts/lib/gameday-alerts.mjs` holds the detection, pure and testable;
the script is only I/O. Two things there are load-bearing:

- **The swing gate is "the week's main slate is final".** A lead change at
  10:30am Pacific, with eleven starters yet to play, is not a result. The
  main slate is found in the DATA — the kickoff time the most games share —
  rather than from a weekday and a clock, so it needs no DST handling and
  survives Thanksgiving and the Saturday slates of Weeks 16-18. It fails
  CLOSED: an unreadable schedule means no swing alerts.
- **The leader is recorded on every poll, including suppressed ones.**
  Recording it only once swings are allowed makes the first post-slate poll
  compare against nothing and miss the change of hands that happened during
  the window. A tie CLEARS the leader, and because the state is stored with
  `HSET` — which can only add and overwrite — a cleared leader has to be
  returned as an explicit `removed` list and deleted with `HDEL`.

### Player news

`scripts/push-player-news.mjs` diffs the injury report against a Redis
snapshot **it owns**, not against git. Roster Sync's commit step is skipped
when nothing else changed, so "diff the last commit" is only correct on the
runs that commit. The snapshot means the diff is a function of what we last
TOLD PEOPLE, which is the thing that must not repeat.

It sends nothing on a first run — with no snapshot, every rostered injury
in the league reads as brand new — and re-seeds without sending if more
than 40 statuses change at once, which means the feed changed shape rather
than that forty players got hurt.

## Adding a notification type, in short

1. Add a registry entry with `live: false`.
2. Write the sender, passing the category id to `sendPushToFranchise` (or to
   `sendPushFanout` from a script).
3. Flip `live: true`. The settings page picks it up with no edit.
