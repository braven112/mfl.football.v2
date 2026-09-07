# Schefter in-season mode — the feed as a personal assistant

Built 2026-09-07. From the NL draft to the Super Bowl the Schefter Report opens on
a **For You** tab (your roster, your watch list, your franchise, your
deadlines); out of season it falls back to the league-wide feed, which is what
keeps the page alive from February to the drafts. Lineup warnings, which
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
| Homepage rail | `src/utils/schefter-rail-view.ts`, `src/components/shared/SchefterFeedCompact.astro` |
| Retraction | `scripts/schefter-retract-post.mjs` |

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

Also rejected: `isInSeason()` from `current-week.ts`, which was table-driven off
`SEASON_CONFIGS` (2024-2026) and expired. That table has since been retired in
favour of the derived math — see the 2026-09-07 entry below.

## 2026-09-07 — The rail was the ask; /news was not

The request was "the Schefter report **on the right**", repeated as "the **home
page** link". Both times it was read as the standalone `/news` page and the
correction was pushed back on. The compact sidebar
(`SchefterFeedCompact.astro`, mounted from each homepage) is a different
component from the news page and had none of the work applied to it.

The tell was there twice in the user's own words and once in the artifact they
sent — a screenshot of the homepage rail, not the news page. When someone
supplies a location twice and a picture once, the location is not the
ambiguous part.

## 2026-09-07 — Two gates made a shipped feature indistinguishable from an unshipped one

The rail personalizes only when the viewer is a signed-in owner AND the feed is
in season. Both are correct. Together they meant that on any day before the
switch, an owner looking at the homepage saw **exactly** the feed they saw
before — no tab, no chip, no hint the work existed. It read as "you didn't
build it", and there was no way to tell the two apart from the outside.

Two things follow. First, when a feature is conditional, verify it in the
condition the USER is in, not the one that makes it visible — every check that
passed was run with `?testDate=` set to mid-October. Second, prefer a season
boundary that is already true when you ship over one that is three days out.

## 2026-09-07 — The season starts when the league says it does, not when the country does

Labor Day is a national date; this league's season starts when its drafts are
done. In 2026 the AFL's AL draft ran Aug 29 and the NL draft Aug 30, so for
nine days the site served wire filler to owners whose rosters were built.

The first cut READ the NL draft out of the AFL's resolved-events feed, with a
Labor-Day-derived fallback for the seasons that feed cannot answer for. That
was two mistakes stacked.

**It read a date that did not need reading.** The event is `computed` — the
league calendar spells it `sunday-before-labor-day-weekend`, which is
`laborDay - 8`, pure arithmetic. Reading the resolved feed bought a cron
dependency, a `node:fs` import in a module 138 files reach, a cache, a
fallback, and a TZ bug (the same draft was written `…T00:00:00Z` under UTC and
`…T07:00:00Z` under the app's pinned Pacific, and consuming the instant slid
the switch seven hours — backwards, into the evening before the draft).
Deriving it removes all five.

**It was scoped to Schefter when the ask was site-wide.** The reasoning at the
time — `getCurrentSeasonYear` drives standings, playoffs, MVP and draft order
across ~71 files, so don't move it as a side effect of a feed change — is a
real risk, but it was the wrong call: it answered a narrower question than the
one asked, and it left the feed's idea of "the season" free to disagree with
the rest of the site's.

Both are now fixed. `getSeasonStartForYear` in `league-year.ts` is the ONE
definition and `getCurrentSeasonYear` rolls on it; `seasonModeStart` delegates
and owns no date. The feed keeps exactly one constant of its own,
`SEASON_END_WEEKS`, because a year selector has no end and the feed needs one.

The eight days this moved are not cosmetic: in that window standings, draft
order and MVP tracking now name the season whose rosters actually exist.

## 2026-09-07 — One capped list cannot serve two tabs

The rail took `limit` personal posts and topped up with league news "if there
was room". For an owner with `limit` or more of their own there never was, so
All rendered exactly what For You rendered and the tabs looked broken. It
showed up on the AFL first, where franchise 0001 matches 33 posts against a
30-slot rail — the league where the owner has MORE of their own news is the
league where the feature looks most broken, which is the opposite of intuition.

Each tab now gets its own `limit` and the rail renders the union.

## 2026-09-07 — A personal feed amplifies whatever is wrong upstream

The commissioner reported a post claiming another franchise was shopping a
player on HIS roster. It was not a hallucination: `buildExposure` chose the
team to name by hashing the offer id and chose the players to name from
`allAssets` — both sides of the offer merged at `redact-trade-offer.mjs:211` —
with no relationship between the two choices. The prompt's signal-2 wording
asserts ownership ("Hearing the [team] have [Player] on the table"), so roughly
half of every signal-2+ post was a coin flip on whether the named team owned
the named player.

Two lessons, and the second is the general one:

- **An existing test was pinning the bug.** `redact-trade-offer-exposure`'s
  "caps at the number of players actually in the offer" expected all three
  players beside the named team, one of which the OTHER franchise was sending.
  A test can encode a bug as an invariant; when a fix breaks a test, read the
  fixture before assuming the fix is wrong.
- **Personalization is an amplifier.** That post sat in a 383-item firehose for
  two days without complaint. The moment it appeared at the top of one owner's
  feed with YOUR PLAYER on it, it was reported within minutes. Any feature that
  narrows a feed to "things about you" raises the cost of every upstream
  correctness bug, and should be shipped with that in mind.

## 2026-09-07 — Retract published posts with a script, not an edit

`scripts/schefter-retract-post.mjs` removes posts by id from a league's live
feed and every archive shard. The feeds are cron-written, so a hand edit is
invisible in review and cannot be repeated for the next league. It deliberately
leaves the scanner's `posted`/exposure state alone: clearing that would let the
same offer regenerate the same wrong post on the next scan.

No shipped-feed guard test for misattribution — rosters move, so a post that
was accurate when written reads as misattributed once the player is traded. The
guard belongs on the redactor
(`tests/redact-trade-offer-attribution.test.ts`), where it is deterministic.

## 2026-09-07 — Two derivations of one date, pinned against each other

`getSeasonStartForYear` computes `laborDay - 8`. `league-event-resolver`
resolves the same day from the `sunday-before-labor-day-weekend` rule in
`league-events.json`. Neither can be deleted — the year selector must work with
no I/O for any year, and the calendar must render the event — so there are
genuinely two derivations of one date, and two derivations drift silently.

`tests/league-year-rollover.test.ts` asserts they agree for 2026-2030 and that
the result is a Sunday in every one. That is the cheap version of a single
source of truth when a single source is not available.

## 2026-09-07 — The expiring table nobody would have noticed

`current-week.ts` carried `SEASON_CONFIGS`, a hand-maintained list of Week 1
kickoffs for 2024, 2025 and 2026. Past the last row it fell through to a helper
that placed kickoff on the FIRST Thursday of September — Sep 3 in 2026, a full
week before the real Sep 10 opener — so from 2027 on, every week number and
`isInSeason()` would have been quietly wrong rather than visibly broken.

`nflWeekOneKickoff` reproduces all three retired rows to the minute, so the
table was deletable with no behavior change in any year it covered. Verified
before deleting, not after.

A hardcoded table with a wrong fallback is worse than no table: the table hides
the bug for exactly as long as someone keeps maintaining it.
