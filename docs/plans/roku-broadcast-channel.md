# Roku channel for the broadcast board

## Scope

Get `/theleague/broadcast` onto a Roku, as a real Roku channel, distributed to
Brandon plus a handful of owners. Decided Sep 2026.

Rejected alternatives, and why:

| Option | Verdict |
|---|---|
| Open the page in a browser on the Roku | **Impossible.** Roku has no browser and no webview. There is no HTML runtime on the device at all — a channel is BrightScript + SceneGraph XML. This is the whole reason this document exists. |
| AirPlay / Miracast from a phone or laptop | Works today, zero code. But it pins a device to the TV for the afternoon and dies on a screen lock — the opposite of the zero-input display this board is for. Fine as the stopgap while the channel is built. |
| Render the page headless and stream it as HLS | Keeps the UI pixel-identical, but needs an always-on render box (Vercel cannot do it), adds 10–30s of HLS latency to a board whose entire job is *right now*, and burns a Chromium per viewer. Rejected. |

## The three findings that shape the build

### 1. The staging logic must move SERVER-SIDE, or it gets forked into BrightScript

The board's data assembly is already server-side (`assembleBroadcastBoard`),
but the *decisions* — which stage is showing, whether it occludes the strip,
which strip page is up, the density tier and drop ladder — run in the island
(`LiveBroadcast.tsx`, `broadcast-layout.ts`, `broadcast-moments.ts`).
BrightScript cannot run that TypeScript.

Porting it is a second implementation of the rules, which is the exact disease
this repo already has ratchets against (`page-fork-ratchet.test.ts`,
`owner-boundary-parity.test.ts`, the five copies of `buildAttributor`). It
would drift, and it would drift *silently* — nobody watches the Roku with a
laptop next to it.

**So: add a render-instruction mode to the assembler.** A new
`/api/broadcast-tv` (or `mode: 'tv'` on the existing poll) returns the board
with the staging already decided — the active stage and its `occludes` value,
the resolved strip page, the cells already laid out for a fixed 1920×1080
canvas. The Roku becomes a dumb renderer that draws what it is told.

That is more work up front and it is the only version that stays correct.
It also means the layout rules keep their existing guard tests instead of
needing a parallel BrightScript test story that does not exist.

### 2. `user.id` is the owner's live MFL cookie

`assembleBroadcastBoard` passes `user.id` straight into `fetchMyLeagues` and
`readOutsideLiveSnapshot` — the session's `id` **is** the MFL cookie value
(see `broadcast-board.ts:311`). Two consequences:

- **A device token must never carry it.** A TV token is long-lived and sits in
  a set-top box. Mint the device token as a signed JWT carrying only an opaque
  `deviceId`; keep the `AuthUser` snapshot in Redis under that id. Revocation
  is then a Redis delete, and the MFL cookie never leaves the server.
- **MFL cookies expire, so pairing is not once-and-forever.** When the stored
  cookie goes stale the board returns `ok: false` and the TV must say
  *re-pair on your phone* rather than showing a dead board. Refresh the stored
  snapshot whenever that owner signs into the site normally, which makes
  re-pairs rare rather than routine.

Note this does NOT weaken `CLAUDE.md`'s "session JWT only" rule — the device
token is signed, and it is checked against Redis. What must not happen is
loosening `getAuthUser()` itself. Add a separate
`resolveBroadcastClient(request)` that tries the session cookie first and the
bearer device token second, and let only the broadcast poll route call it.

### 3. Beta distribution has an expiry, so plan for re-publishing

Roku retired open non-certified private channels. For a handful of owners the
route is a **Beta Channel**: a Roku developer account, a packaged and signed
`.pkg`, a capped tester list, and access that expires and needs renewing
(confirm the current cap and window in the developer dashboard — Roku has
changed both). No store certification, no trick-play or deep-link
requirements. Brandon's own TV can skip all of it and sideload.

## Build phases

### Phase 0 — stopgap, today

AirPlay (Roku 4K/Streambar, iOS) or Miracast (Android/Windows) the existing
page. Confirms the board reads at ten feet on the actual TV before any Roku
code is written, and settles the 1080p type sizes the channel will need.

### Phase 1 — server: the TV render contract

- `src/utils/broadcast-tv.ts` — lift the staging decisions out of
  `LiveBroadcast.tsx` into pure functions the island *also* calls, so there is
  one implementation. This is the load-bearing refactor.
- New response type in `src/types/live-broadcast.ts`, same rules as
  `BroadcastPollResponse`: no ESPN athlete ids reach the client, resolved
  headshot URLs only.
- Colours arrive already run through `ensureFieldOn` — BrightScript will not be
  re-deriving contrast, and seven TheLeague franchises are `#181818`.
- Guard test pinning that the TV payload and the island agree on the same
  stage for the same input.

### Phase 2 — server: device pairing

- `POST /api/roku/pair` (unauthenticated) → `{ deviceId, userCode }`, Redis
  TTL ~10 min.
- `/theleague/roku` + `/afl-fantasy/roku` — thin route wrappers over one shared
  component, auth gate and any cookie write in the *route* (both traps are
  already documented on the broadcast page itself). Owner types the code.
- `POST /api/roku/approve` (session-authed) → binds code to owner, mints the
  device JWT.
- `GET /api/roku/pair/status?deviceId=` → Roku polls, receives the token once.
- A manage/revoke list on `/preferences` or the roku page.
- Rate-limit the pair + status endpoints (`src/utils/rate-limit.ts`).
- Page-directory entry for the new page, 10+ tags.

### Phase 3 — the channel

Roku side, `roku/` at the repo root:

| File | Role |
|---|---|
| `manifest` | `ui_resolutions=fhd`, splash, optionally `screensaver_title` |
| `components/PairScene.xml` | The code screen, shown until a token exists |
| `components/BroadcastScene.xml` | Root; `#05070b` ground, layer order matching `occludes` |
| `components/PollTask.xml` | Task node + `roUrlTransfer`; 8s poll, 20s backoff after repeated errors, 40s watchdog — mirror `LiveBroadcast.tsx`'s constants |
| `components/LeaguePanel.xml` | Per-league score header |
| `components/PlayerStrip.xml` | The strip, with paged cross-fade |
| `components/RevealCard.xml` | Full-screen takeover |
| `components/RedZoneBanner.xml` | Persistent layer *above* the stage layer |

Roku-specific gotchas to design around:

- HTTPS needs `SetCertificatesFile("common:/certs/ca-bundle.crt")` +
  `InitClientCertificates()` or every request fails silently.
- Networking must be on a Task thread; blocking the render thread stutters the
  whole board.
- **Update node fields in place; never rebuild the node tree each poll.** On an
  Express-class box, recreating a 16-row strip every 8 seconds is visible.
  This is the Roku analogue of the burn-in-drift-as-transform rule.
- Burn-in drift = a `translation` animation on the root Group, 90s, same as the
  web board's root transform.
- Bundle the board's typeface as a TTF under `pkg:/fonts/`; the platform font
  has no tabular figures and every score will jitter its column width.
- `?demo=1` already exists on the page — point the channel at it to develop
  against a scripted slate in September instead of waiting for Sunday.

### Phase 4 — sideload, then beta

1. Enable dev mode on the Roku: Home ×3, Up ×2, Right, Left, Right, Left,
   Right. Note the IP it shows.
2. Zip the `roku/` contents (not the folder) and upload at `http://<roku-ip>`.
3. Iterate. A sideloaded dev channel survives reboots and is replaced by the
   next sideload.
4. For the other owners: generate a signing key on the device, package the
   `.pkg`, upload to the Roku developer dashboard, create a Beta Channel, send
   the invite links. Diarize the renewal.

## Rough effort

Phase 1 is the real work and the real risk — it is a refactor of a board that
shipped three weeks ago. Phases 2 and 4 are small and well-understood. Phase 3
is a lot of unfamiliar XML but very little logic, once Phase 1 has moved the
decisions server-side.

## Cost

**Roku charges nothing.** A developer account is free, there is no annual fee
(unlike Apple's), packaging and signing are free, Beta Channels are free, and
store certification is free if this ever goes public. Roku only takes a cut of
*monetized* channels — subscriptions, in-channel purchases, ads through their
network — none of which apply here. Verify at signup, but there has never been
a publishing fee.

The real cost is our own serverless bill. An 8-second poll is **450 requests
per hour per television**. A ten-hour Sunday is ~4,500 invocations per TV;
six owners is ~27,000 a Sunday, and each one fans out to MFL and ESPN.

That is not free, and it is worth noting where this repo's Vercel money
actually goes: build CPU minutes were 91% of the bill ($22.36 of $24.70) while
bandwidth was $0.46. Adding invocations pushes on the cheap axis, not the
expensive one. Still, two cheap mitigations are worth building in from the
start:

- **Slow the poll when nothing is playing.** The board already knows the NFL
  slate; outside a game window a 60s poll is indistinguishable to a viewer and
  cuts ~85% of the requests.
- **Share the upstream fetch.** Two owners in the same league watching the same
  Sunday currently each trigger their own MFL + ESPN reads. A short Redis cache
  on the league snapshot (5–8s, i.e. one poll interval) makes the upstream cost
  scale with *leagues* rather than with *televisions* — which also matters if
  MFL ever rate-limits us.
