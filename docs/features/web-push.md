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
   `push-notify-trade.ts`): return `{ title, body, url, tag, icon, badge }`.
   Use `leaguePushIcon(navSlug)` AND `leaguePushBadge(navSlug)` — both, always
   (see "Icon vs badge" below) — a site-relative `url` (that's what the SW
   opens on click), and a stable `tag` so repeat notifications collapse
   instead of stacking.
2. **Wrap it** in a `notify*` function that resolves league/team context
   (registry lookups — never hardcode league ids) and calls
   `sendPushToFranchise`. Guard with `isPushConfigured()` and never throw.
3. **Call it fire-and-forget** (`void (async () => { ... })()`) from the
   server-side event source — an API route, cron script, or scanner.
4. **Unit-test the pure payload builder** in
   `tests/push-subscriptions.test.ts` or a sibling file.
5. No SW change needed — the `push` handler renders any payload matching
   the `{ title, body, url?, tag?, icon?, badge? }` contract.
6. Mention the new alert type in the notifications page copy if it's
   user-visible.

## Icon vs badge — they are not interchangeable

`icon` is the large image in the notification. `badge` is the **small** icon,
and Android renders it by discarding RGB entirely and using only the **alpha
channel** as a stencil, which it then tints. Consequences:

- **An opaque PNG is a solid block on the device, not a logo.** The service
  worker used to pass TheLeague's `/assets/icons/pwa/icon-192.png` as the
  badge for every league. That file is PNG color type 2 — no alpha channel at
  all — so it rendered as a **blank white square**, which is what an AFL owner
  saw next to a working test notification in Sept 2026.
- Badges are `badge-96.png`: white-on-transparent silhouettes generated from
  each league's favicon by `scripts/generate-notification-icons.mjs`.
  Regenerate there; never hand-edit one, and never point `badge` at a favicon.
- `tests/push-notification-icons.test.ts` fails on a badge with too little
  transparency, on a badge that equals its league's icon, and on committed art
  that has drifted from what the generator produces.

## The manifest must be scoped to `/`

Every league is served at the **root of its own apex domain** — the middleware
rewrites `afl-fantasy.com/rosters` → `/afl-fantasy/rosters` internally, and
`vercel.json` 301s `/afl-fantasy/*` → `/*` on that host. A manifest declaring
`scope: "/afl-fantasy/"` therefore covers **no URL that domain actually
serves**, and a manifest whose scope excludes its own document is discarded:
no install prompt, no WebAPK, and no app icon for Android to show as the
notification's app identity. The AFL shipped that way until Sept 2026.

`start_url` and `scope` are both `/` in every manifest, pinned by
`tests/push-notification-icons.test.ts`. Each manifest also carries a
`purpose: "maskable"` icon, because Android crops adaptive icons to an
OEM-chosen shape and a non-full-bleed icon gets a visible notch.

**A league's manifest is only linked on that league's own apex.** The AFL's
manifest was otherwise served on theleague.us too — `vercel.json`'s
`/afl-fantasy/*` → `/*` redirect is host-gated to afl-fantasy.com,
`league-host-map.ts` keeps `/afl-fantasy/` in `SKIP_REWRITE_PREFIXES` so
cross-league deep links resolve, and the layout picks its head block by LEAGUE
rather than by host. So an AFL page genuinely renders at
`theleague.us/afl-fantasy/…`, and an ungated `<link rel="manifest">` puts a
`scope: "/"`, `start_url: "/"` AFL manifest on TheLeague's origin: Chrome
offers to install an app called "AFL" that opens The League, and if the two
share an app id the AFL's name and icons can overwrite an owner's installed
TheLeague app.

`onForeignLeagueHost` in `TheLeagueLayout.astro` suppresses the link. Note the
shape: it suppresses only on a **known foreign league apex**, not "unless on
our own apex" — localhost and Vercel preview hosts are in neither map and must
keep their manifest, or the PWA becomes untestable anywhere but production.

Two gaps this gate does **not** close, both deliberate:

- **The six `prerender = true` routes** (`theleague/insights`,
  `theleague/about`, both `pecking-order/[year]/[week]`,
  `afl-fantasy/players`, `afl-fantasy/draft/order`) evaluate the gate at BUILD
  time, where the hostname is localhost and nothing is suppressed — so they
  still carry their manifest on a foreign apex. Closing it would mean
  de-prerendering them, which is a bigger call than this fix. The distinct
  `id` below is what keeps the destructive half impossible there.
- `mfl.football` (`SHARED_APP_ORIGIN`) serves every league by path prefix and
  is in no league's `domains`, so a bare `HOST_TO_SLUG` lookup treats it like
  localhost. It is special-cased as foreign to *all* leagues, since no single
  league's PWA identity belongs on a multi-league origin.

Belt and braces, every manifest also carries a **distinct `id`**. An app id
defaults to `start_url`, so two manifests both saying `/` would be the same app
on a shared origin. `id` is resolved against the origin and does **not** have
to sit inside `scope`, which lets the AFL declare `"id": "/afl-fantasy/"` while
staying scoped to `/`. That exact string is also the id its old
`start_url: "/afl-fantasy/"` produced implicitly, so nothing already installed
gets re-keyed. Uniqueness and the host gating are both pinned by
`tests/push-notification-icons.test.ts`.

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

## What the INSTALLED app can do that the website cannot

Push is the oldest of these but not the only one. Four capabilities now key off
`display-mode: standalone` or the manifest, and none of them exist in a tab.

### The install pitch (`src/utils/pwa-install.ts`)

On iOS, Web Push works **only** once the site is on the Home Screen. Every
category in `notification-categories.ts` is therefore unreachable for an iPhone
owner in Safari, and until Sept 2026 the only place that said so was one line
of hint text at the bottom of the push card — so those owners were shown a page
full of switches that could never fire.

`InstallAppPrompt.astro` is one component in two variants: a dismissible banner
on both homepages (signed-in owners only) and a permanent card above the push
settings on both `/notifications` pages. `resolveInstallPitch` is pure and
pinned by `tests/pwa-install.test.ts`, because both failure directions are
invisible in a diff:

- **The in-app check runs BEFORE the iOS check.** The GroupMe webview — where
  every league link posted to chat opens — carries a complete iOS Safari user
  agent, so a naive `/iPhone/` test shows Add-to-Home-Screen steps to a browser
  that has no share sheet.
- **Chrome/Firefox/Edge on iOS are not pitched.** They all wrap WebKit, but only
  Safari's share sheet carries the item.
- **iPadOS 13+ reports a Mac user agent.** `maxTouchPoints` is the only tell, so
  the component swaps it in and `resolveInstallPitch` stays pure.
- **Dismissal lapses after 60 days.** An owner who swipes the banner away in
  June has no idea it is the only route to lineup alerts in September.

`beforeinstallprompt` is captured **in the layout, not the component**. It fires
once, early, before any island hydrates; if nothing is listening at that moment
the browser's offer to install is gone for that page load. It is registered
behind `window.__mflInstallPromptBound` because the ClientRouter re-executes
body scripts on every navigation.

### The app icon badge (`src/utils/app-badge.ts`, `/api/app-badge`)

`setAppBadge` paints a count on the Home Screen / dock icon — the only surface
that reaches an owner who never opens the app. Three things count, and the
choice of three IS the design: a badge promises that something is waiting for
**you**, so it may only count what the owner can act on and clear.

| Part | Source |
|---|---|
| `trades` | MFL `pendingTrades`, filtered to offers made TO this franchise |
| `lineup` | `buildLineupWarnings`, reduced to one bit, inside the kickoff window |
| `poll` | an open Owners' Poll window with no ballot from this franchise |

- **Trades this owner PROPOSED are not counted.** They are waiting on somebody
  else, so nothing the owner does could clear the number.
- **Unread Schefter posts are deliberately excluded.** Highest-volume source in
  the league; a permanently lit badge is one people stop seeing, and it would
  take the other three down with it.
- **A lineup with three bye-week starters counts 1, not 3.** It is one thing to
  go fix. `ownerLineupNeedsAttention` is what enforces that.
- **The lineup window comes from the schedule DATA** — opens 24h before the
  week's first kickoff, closes when the main slate does, both via
  `gameday-alerts.mjs`'s `scheduleGames`/`mainSlate`. No DST handling, and
  Thanksgiving, the Saturday slates of Weeks 16-18 and Christmas all work
  without being named. It **fails closed**: an unreadable schedule means no
  badge, because the cost of staying dark is one owner checking their own
  lineup and the cost of guessing is a badge nobody can clear.
- **Lineups are fetched LIVE; everything else is a committed feed.** The
  committed `weekly-results.json` carries scores rather than starters, and the
  whole value of the badge is that it reflects a lineup edited two minutes ago.
  Byes are the one extra fetch — `parseByeTeams` reads an `nflByeWeeks` export
  specifically, and handing it the `nflSchedule` feed silently yields an empty
  bye set, which reads as "every lineup is clean" rather than as a failure.
- **Every part fails quiet into a 0.** A badge must never be why an owner
  opening the app sees an error, and a 500 would strand a stale count on the
  icon with no way to clear it.
- **The 90s per-franchise cache is invalidated by the three routes that resolve
  a badged item** (`trades/respond`, the lineup POST in `lineup-route.ts`, the
  ballot POST) via `invalidateAppBadge`. Without that, an owner who just
  accepted a trade watches the number sit there, which reads as broken.
- **The service worker re-reads the real count on push** rather than trusting a
  payload field. One definition, and a push about something unbadgeable (a
  rumor, a weekly recap) correctly leaves the number alone.

### Manifest shortcuts

Long-press the icon for Set Lineup / Live Scores / My Roster / Schefter. Two
constraints, both pinned by `tests/push-notification-icons.test.ts`:

- **Shortcut URLs are apex-relative, so they resolve against ONE league's
  pages.** `/lineup` means `src/pages/<that manifest's league>/lineup`. A
  shortcut copied between manifests dead-ends for whichever league lacks the
  route — and it dead-ends from the OS launcher, where nobody is watching.
- **At most four.** Android silently drops the rest on a long-press, so a fifth
  is a shortcut nobody will ever see.

Shortcut `icons` are deliberately omitted; platforms fall back to the app icon
rather than requiring four more pieces of per-league art to keep in sync.

### Share target (`src/utils/share-target.ts`)

The installed app appears in the phone's share sheet, which a website cannot do
at all. Ours points at the Schefter tip form.

**The share is a PREFILL, never a submission.** `/api/schefter/tip` requires a
topic that no share sheet can supply, and rate-limits to 3 tips per owner per
day — auto-filing would spend an owner's quota on something they never
confirmed. The text is rendered as a `<textarea>` value (escaped like any other
Astro expression, never `set:html`), because it is whatever a third-party app
put on the clipboard.

`composeSharedTip` de-duplicates: Android hands a link over in `text` about as
often as in `url`, and plenty of apps repeat the page title verbatim in both
`title` and `text`, so a naive join prints the headline twice and burns a third
of the 500-character budget. The three param names are a contract between the
manifests and `readSharedPayload`; renaming one side drops every share on the
floor with the page still rendering, just empty. That contract is pinned.
