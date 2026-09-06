---
slug: visit-page-path-normalization
status: open
severity: P3
opened: 2026-09-06
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/996
hotfix_sha:
followup_issue:
followup_pr:
followup_session: session_01G9Qum7aAxCukdAFLju9pUr
---

# Follow-up: the visit beacon records one AFL page under two different keys

Not a hotfix brief — this is a review finding from `/live` on #996 (the
PWA-vs-browser visit split) that was deliberately NOT fixed there. The finding
is real; the obvious fix is wrong, which is the whole reason it needs a session
of its own rather than a one-liner.

## What's wrong

`src/layouts/TheLeagueLayout.astro`'s visit tracker normalizes the page it
reports with a single hardcoded strip:

```js
const page = location.pathname.replace(/^\/theleague/, '') || '/';
```

TheLeague is therefore always recorded unprefixed, whichever host the owner is
on. Every other league keeps whatever shape the URL had — so the AFL's rosters
page is recorded as `/rosters` when browsed on its apex domain and
`/afl-fantasy/rosters` when browsed on a preview domain or via the path prefix.
Two keys, one page, inside the same `pages:{leagueId}` hash: the Popular Pages
list on `/afl-fantasy/activity` splits that page's count across both rows.

The name lookup lands on the same asymmetry from the other side.
`src/data/page-directory.json` stores TheLeague's 77 paths UNPREFIXED and all
46 AFL paths PREFIXED, and `pageName()` in
`src/components/theleague/OwnerActivityReport.astro:18` is an exact-match
lookup against those. So an AFL visit recorded as `/rosters` resolves to
**TheLeague's** directory entry, and one recorded as `/afl-fantasy/rosters`
resolves correctly.

Predates #996 — that line is unchanged from `main`; #996 only appended query
params to the same beacon.

## Why the obvious fix is wrong

Making the strip generic (strip any league prefix) normalizes the AFL onto
`/rosters`, which then matches NOTHING in the AFL half of the page directory
and sends every AFL row through `pageName()`'s prettifier fallback. That trades
a split count for wrong labels on the whole list.

The correct normalization is per-league and asymmetric because the directory
is: TheLeague's canonical form is unprefixed, the AFL's is prefixed.
`stripLeaguePrefix` / `ensureLeaguePrefix` (`src/config/leagues.ts`) are both
already there for exactly this, and they take a registry entry — which is why
this belongs in `src/pages/api/track-visit.ts`, where the league is already
resolved (session for a signed-in visit, validated `?league=` for an anonymous
one), and NOT in the client script, where a literal league slug would also trip
`tests/league-literal-guard.test.ts`.

## Deferred items

- [ ] **F1 — Normalize the recorded page path per league, server-side**
  - Source: Copilot review on #996
  - Where: `src/pages/api/track-visit.ts` (normalize before `recordVisit`),
    `src/layouts/TheLeagueLayout.astro:473` (the client strip becomes
    unnecessary — send `location.pathname` and let the server decide)
  - Why deferred: pre-existing and unrelated to the surface split; the naive
    fix regresses AFL page names, and getting it right means picking the
    canonical form per league
  - Decide first: which form is canonical. Following the page directory
    (unprefixed TheLeague, prefixed AFL) keeps `pageName()` working with no
    data migration but keeps the asymmetry. Normalizing everything to the
    prefixed form is cleaner and needs `pageName()` to prefix before lookup.

- [ ] **F2 — Reconcile the keys already written under both shapes**
  - Source: follows from F1
  - Where: `pages:19621` and `pages:19621:<franchiseId>` in Redis
  - Why deferred: needs F1's decision first. A one-off merge script
    (`HINCRBY` the canonical field by the stray one's count, `HDEL` the stray)
    is enough; there is no history to preserve beyond the totals.

- [ ] **F3 — Guard the rule once F1 lands**
  - Source: cross-cutting lens, `/live` step 5b on #996
  - Where: `tests/visit-surface.test.ts` already scans the layout for the
    surface-detection rules; the path rule belongs beside it
  - Why deferred: nothing to pin until F1 picks a canonical form

## Context to start cold

- The surface counters added in #996 (`surface:{leagueId}*`) are NOT affected —
  they are keyed by `<surface>:<platform>`, never by page.
- best-ball-1 shares `TheLeagueLayout`, so it beacons too, under navSlug `bb1`
  → league id 37610. It has no `/activity` page, so its page counts are written
  and never read. Harmless, but do not "fix" the strip in a way that folds bb1
  into TheLeague's hash.
- The daily per-franchise counts (`pageviews:{leagueId}:{date}`) key on
  franchise, not page, so the Daily Page Views chart is correct today and stays
  correct through F1.
