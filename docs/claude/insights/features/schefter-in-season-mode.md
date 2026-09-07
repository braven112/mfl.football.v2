# Schefter in-season mode — the feed as a personal assistant

Built 2026-09-07. From Labor Day to the Super Bowl the Schefter Report opens on
a **For You** tab (your roster, your watch list, your franchise, your
deadlines); out of season it falls back to the league-wide feed, which is what
keeps the page alive from February to Labor Day. Lineup warnings, which
previously existed only as a push and a group-chat broadcast, now also land on
the feed as `assistant` posts.

Files, by layer:

| Layer | Files |
|---|---|
| Date switch | `src/utils/schefter-season-mode.ts` (`resolveFeedMode`, `defaultSource`) |
| Page resolver | `src/utils/schefter-news-view.ts` (tabs, filtering, OG — shared by both leagues) |
| Shared body | `src/components/shared/SchefterNewsPage.astro` |
| Routes | `src/pages/theleague/news.astro` (72 lines), `src/pages/afl-fantasy/news.astro` (50) |
| Side loads | `src/utils/schefter-news-loaders.ts` |
| "Is this mine?" | `src/utils/schefter-watching.ts` (`postIsForViewer`) |
| Assistant posts | `scripts/lib/schefter-assistant-post.mjs`, `scripts/schefter-lineup-check.mjs` |

---

## 2026-09-07 — The filter you plan is often already implied by the predicate you wrote

The plan called for an explicit rule dropping `type: 'external'` posts with no
player ids — 68 of TheLeague's 351 wire posts, the bulk of what made the
in-season feed unreadable. It was never needed. For You already asks "does this
name a player I roster or watch, or carry my franchiseId?", and an untagged
wire post answers no to both. Measuring before implementing turned a planned
feature into a one-line test.

Generalizable: when a plan lists both a positive selector and a negative
filter, check whether the negative is a consequence of the positive. Shipping
it anyway would have been dead code that looks load-bearing — and the next
person to touch the filter would have assumed removing it changed behavior.

## 2026-09-07 — A hand-written tab list beside a filter will drift, silently

Both leagues rendered an always-empty **NFL Insider** tab for months. The tab
list was an array literal a few lines below the filter predicates, so nothing
connected "this tab exists" to "this tab has posts" — and the injuries/odds
lanes (`doc-rivers`, `vegas-vic`) have never written one. Nobody noticed
because an empty tab looks exactly like a quiet week.

The fix is structural, not a deletion: ONE `PREDICATES` map backs both the
filter and `hasPostsFor`, so a tab appears the day its lane writes a post and
disappears when it has none. The AFL's copy had drifted the other way — it had
lost five of seven tabs entirely — which is the same bug with the opposite
sign, and the reason the routes were unified before the feature was built.

**The fork was the root cause of both.** `tests/page-fork-ratchet.test.ts`
scored `news.astro` as forked (663 vs 247 lines); unforking it dropped the
baseline 22 -> 21 and made the drift impossible to reintroduce.

## 2026-09-07 — Scope by TYPE when the post is honestly league-wide

Calendar deadlines ("TODAY: Declare Contracts / Cut to 22") are the most
actionable thing in the feed and carry `franchiseIds: []`, because they apply
to everyone. The tempting fix — stamp every franchise's id on them so the
personal filter catches them — writes a false statement into the data that
every later reader believes. `ALWAYS_ACTIONABLE_TYPES` includes them by post
type instead, which says the true thing: actionable for you, not about you.

Keep that set short. Every type added is one more thing in a feed whose entire
purpose is to be quiet.

## 2026-09-07 — A cron that starts writing files needs its workflow rewired, and the failure is silent

`lineup-reminders.yml` ran with `permissions: contents: read`, a shallow
checkout and no commit step, because the job had only ever sent a GroupMe post
and a push. Adding the feed write to the script would have worked perfectly in
the job and then thrown the result away at container teardown — no error, no
red check, just a feature that never appeared.

Checklist when a job starts mutating a committed file: `contents: write`, a
`ssh-key` + `fetch-depth: 0` checkout, and `commit-feed-and-push.mjs` (never a
plain rebase — the feeds are written by several workflows on overlapping crons
and collide on `merge=binary`).

## 2026-09-07 — `summary` in whats-new.json is text; only `description` is set:html

An anchor written into an entry's `summary` shipped as visible
`<a href="/news">…</a>` on the detail page. `description` blocks go through
`set:html` and render links correctly; `summary` does not, and no test catches
it because the string is valid either way. Caught only by screenshotting the
rendered page — which is the argument for rendering a What's New entry before
calling it done, not just running `tests/whats-new-data.test.ts`.

## 2026-09-07 — Don't reuse another feature's season window just because it exists

`isSeasonWindowOpen` (Pecking Order) closes at `SEASON_WINDOW_WEEKS = 20`,
about three weeks BEFORE the Super Bowl — correct for a weekly column, wrong
for a feed meant to stay personal through the playoffs. Sharing the constant
would mean retuning that column silently moves the feed, and vice versa.
`schefter-season-mode.ts` defines its own end bound and shares only
`nflWeekOneKickoff`, which is a fact about the NFL rather than a tuning knob.

Also rejected: `isInSeason()` from `current-week.ts`, which is table-driven off
`SEASON_CONFIGS` (2024-2026) and expires. The Labor Day-derived math does not.
