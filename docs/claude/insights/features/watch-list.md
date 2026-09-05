# My Watch List — MFL's myWatchList, mirrored, on every player surface

Built 2026-09-05. One list per owner per league, stored on MFL
(`export/import?TYPE=myWatchList`), mirrored in Redis, readable and writable
from every surface that shows a player: the roster action sheets (both
leagues), the free-agents pages, the custom rankings board, and the shared
player details modal. Consumed by the Schefter Report (Watching tab +
highlight chip) and a push category (`watch-list-news`).

Files, by layer:

| Layer | Files |
|---|---|
| MFL read/write | `src/utils/mfl-watch-list.ts` (pull + incremental ADD/REMOVE) |
| Mirror | `src/utils/watch-list-keys.mjs` (key, shared with scripts), `src/utils/watch-list-store.ts` |
| API | `src/pages/api/watch-list.ts` |
| Browser store | `src/utils/watch-list-client.ts` (one truth per league, `watchlist:change` event) |
| Shared UI | `src/components/shared/PlayerActionModal.astro`, `WatchListBridge.astro`, `src/utils/player-actions.ts`, `src/styles/player-action-button.css` |
| Schefter | `src/utils/schefter-player-tagger.mjs`, `scripts/schefter-tag-players.mjs`, `src/utils/schefter-watching.ts` |
| Push | `scripts/push-watch-list-news.mjs`, category in `src/config/notification-categories.ts` |

---

## 2026-09-05 — The watch list is incremental, so it gets write-through; the draft list is an overwrite, so it got buttons

**Context:** The draft list (`docs/claude/insights/domains/mfl-api.md`,
2026-08-27) ships two explicit Pull / Push buttons and no autosync, and the
first instinct was to copy that shape.

**Insight:** The two MFL endpoints have different write semantics and that
decides the UX, not taste. `myDraftList` import is a complete overwrite with
no timestamps, so a background reconciler has no safe way to decide who won
— hence buttons. `myWatchList` import takes `ADD=` / `REMOVE=` and touches
nothing else, so a click can be sent as exactly the change the owner made,
with nothing on MFL ever overwritten. No snapshot, no undo buffer, no
"refuse an empty list" rule. The Redis mirror is a READ cache (and the only
server-side view of the list — see below), never a write buffer.

**Still shared with the draft list, because MFL is the same MFL:** owner
cookie only (no APIKEY, no FRANCHISE_ID, so no cron can read or write it),
HTTP 200 means nothing, `import` answers XML and ignores JSON=1, TYPE/L in
the query string, writes to the league's own host. The export SHAPE is still
unconfirmed live — `extractWatchListIds` accepts every shape MFL's other
per-owner lists use and reports an unrecognized one as a failed read, never as
"nothing watched".

---

## 2026-09-05 — The mirror exists because nobody but the owner can read the list

**Context:** The Schefter page wants to highlight posts about watched players
for the signed-in viewer; the push sender wants to alert every owner watching
the player a new post names.

**Insight:** MFL only serves `myWatchList` to the owner's own cookie, so a
page rendering for a viewer could technically pull it per request, and a cron
could not read it at all. The mirror (`wl:<registrySlug>:<franchiseId>`,
written by `/api/watch-list` on every read-through or write) solves both: the
page reads the mirror (fast, no MFL call per render), and the cron `MGET`s
every franchise's mirror in one round trip. It is as fresh as the owner's
last visit to any page with a Watch control, which is every page that shows a
player.

Keyed by the REGISTRY slug, not a rankings scope or nav slug — both leagues
have a franchise 0001, and the slug is the one identifier the TypeScript side
and the `.mjs` scripts both already have. `watch-list-keys.mjs` is plain
`.mjs` for exactly that reason.

---

## 2026-09-05 — The free-agent pages cannot import, so the store crosses a bridge

**Context:** `watch-list-client.ts` is the one browser-side truth, and the
free-agent pages needed to read it for the My Watch List view and the row
marks.

**Insight:** Both `players.astro` files drive their tables from a
`define:vars` script, which is a CLASSIC script — no imports. The same
constraint already forced the rankings columns onto CustomEvents
(`rankings:set-lookup`). Rather than a second event protocol,
`WatchListBridge.astro` mounts on the page, exposes the store on
`window.watchListStore`, mounts the shared `PlayerActionModal`, and owns the
delegated click for the `⋮` kebab (`[data-pa-open]`). The classic script only
renders markup and re-renders on `watchlist:change`.

The bridge carries the page's SSR sign-in verdict (`signedIn`, league-scoped:
an AFL session is signed OUT on TheLeague's page) so the very first click can
route to sign-in without a round trip.

---

## 2026-09-05 — "Signed out sees the option" needs a sign-in dialog on pages that never had one

**Context:** Commissioner's call: a signed-out visitor sees Watch and gets
the sign-in dialog, not a hidden or disabled control.

**Insight:** `SignInModal` was mounted only on the free-agent pages, and only
when claims were open (`promptSignIn`), which is false all auction season.
Three changes: the free-agent pages mount it for EVERY signed-out visitor,
both roster pages mount it, and `requestSignIn()` (`player-actions.ts`) opens
the dialog when present and falls back to the league's `/login?redirect=`
page when a surface (the player details modal on the homepage, say) has no
dialog to open. Do not rely on `data-signin-open` bubbling for the Watch
option: SignInModal's delegated trigger also PARKS the player for the waiver
claim resume, and reopening the claim form after a sign-in that was about
watching is the wrong landing.

---

## 2026-09-05 — Prose posts had no player ids, so a tagger resolves names; full names only

**Context:** 5 of 373 TheLeague posts carried `playerIds` (the transaction
lanes stamp them from MFL strings). The ESPN wire (345 posts), the rumor
mill, articles and Ask Roger only ever name a player in prose. Without ids
there is nothing to intersect a watch list with.

**Insight:** `schefter-player-tagger.mjs` indexes every person in the
players export by normalized full name and scans each post's headline, body
and article content with an n-gram walk. Rules, each a false positive that
has already bitten a matcher here:

- **Full names only.** The wire scorer once matched last names and tagged
  coaches and executives who shared one with a player
  (`schefter-scan.mjs`, `loadRosteredPlayerNames`). One-word names are never
  indexed.
- **Ambiguous name → tag every match, unless the text narrows it.** Two
  Josh Allens both get tagged; "Bills quarterback Josh Allen" tags the QB.
  Over-tagging is the safe direction for a highlight (a shrug); a miss is a
  post the owner never sees. Commissioner's call.
- **Never a team defense or a TM* slot.** Their MFL "names" are NFL teams
  and appear in prose constantly.
- **Prose matches go to `namedPlayerIds`, never `playerIds`.** `playerIds[0]`
  is the hero the OG composite and BreakingStoryHero render, stamped
  structurally by the transaction lanes; a prose match written there turned
  every wire story's unfurl into a composite of whoever was named first
  (caught in review on PR #971). Consumers read the union via
  `postPlayerIds`. **Omit the key when empty** or `writeJsonIfChanged` sees a
  700-post semantic diff.
- **A hint only counts NEAR the name** (±6 words). "Josh Allen recorded two
  sacks on the quarterback" must not drop the linebacker.

It runs as a step after every feed writer's workflow (scan, rumor scan,
articles) and is idempotent; the first run after merge is the backfill. The
backfill is deliberately NOT committed on the feature branch: the feeds are
cron-written, a rebase takes main's copy whole, and the step re-tags on the
next scan anyway.

---

## 2026-09-05 — Own roster counts as watched on the page, not on the phone

**Context:** "Automatically treat my own players as on the watch list so they
show up on the news feed."

**Insight:** `resolveWatchingSets` unions the mirror with the viewer's roster
(roster cache first, committed feed as fallback), and the chip says which one
matched ("On your watch list" outranks "Your player"). The PUSH sender
matches the watch list ONLY: roster injuries and status changes already go
out under `player-news`, and doubling them is how push permission gets
revoked. Same list, two different volumes.

## 2026-09-05 — One server verdict, one DOM attribute: a classic script cannot read a module's global at eval time

**Context:** After #971 each free-agent page decided "is this visitor an owner
HERE?" three ways: an inline `authUser.leagueId === league.id` compare in
frontmatter, a `watchSignedIn` copy handed to the classic `define:vars` script,
and `WatchListBridge` re-reading `data-signed-in` off its own element. They
agreed only because every copy started from `claimFranchiseId` — and both
leagues have a franchise 0001, so any copy that dropped the league test would
offer the other league's owner a Claim button the server refuses.

**Insight:** the server derivation is now one helper, `franchiseIdForLeague`
(`src/utils/auth.ts`), and the client has exactly one copy: the bridge
element's `data-signed-in`. The page's classic script reads it off the DOM too.
The tempting alternative — read `window.watchListStore.isSignedIn()` — does not
work, and the reason is load order, not style: the `define:vars` script is a
CLASSIC script that runs at parse time, and it applies the stored view
preference right then; the bridge is a deferred MODULE that has not run yet, so
the global is `undefined` at the moment the answer is needed. An element
rendered above the script is already parsed, so a `data-` attribute is the one
channel both script kinds can read at any time. `tests/free-agent-session.test.ts`
pins the helper, both pages, and the bridge; the `free-agents` path-guard
domain runs it on every edit to those files.
