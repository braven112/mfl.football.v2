# Site analytics — the Owner Activity page

Built 2026-09-10, on top of the counters `visit-surface-tracking.md` describes.
`/activity` stopped being a fantasy page: the transaction leaderboard (trades /
FA / auctions or waivers) came off, and what replaced it is derived from visit
data the app was already writing — league traffic, per-owner engagement, page
reach, quiet pages, category mix, install penetration and notification
adoption.

| Layer | Files |
|---|---|
| Pure derivations (traffic, engagement, pages, quiet list, categories) | `src/utils/site-analytics.ts` |
| Install + notification adoption (Redis) | `src/utils/site-adoption.ts` |
| Counters + readers | `src/utils/owner-activity.ts` |
| Endpoint | `src/pages/api/track-visit.ts` |
| UI | `src/components/theleague/OwnerActivityReport.astro`, both `activity.astro` routes |
| Guards | `tests/site-analytics.test.ts`, `tests/site-adoption.test.ts`, `tests/redis-command-reductions.test.ts` |

---

## 2026-09-10 — One page is recorded under THREE different paths, and a raw group-by splits it into three unpopular rows

**Context:** Popular Pages ranked `pages:{leagueId}` straight out of Redis and
looked up each key in `page-directory.json` by exact string match.

**Insight:** The path a visit is recorded under depends on the HOST, not on the
page:

- the tracker strips `/theleague` client-side, so TheLeague records `/rosters`;
- an AFL owner on the shared preview domain records `/afl-fantasy/rosters`;
- the same AFL owner on the league's apex domain records a bare `/rosters`;
- and the directory itself stores some entries bare (`/rosters`), some prefixed
  (`/theleague/lineup`, `/afl-fantasy/rosters`).

Nothing errors. The counts simply split across two or three keys that each look
unpopular, and on the AFL side the directory lookup missed every time, so page
names fell back to a de-slugged path — "Roster / Salary" rendered as "Rosters"
for one league and correctly for the other, which reads as a styling
inconsistency rather than a bug.

`resolveDirectoryHref(path, navSlug)` (`src/utils/nav-utils.ts`) is the
canonicalizer in BOTH directions — it strips whichever league prefix is present
and re-prefixes for the target — so pushing every recorded path AND every
directory path through it before summing is what makes one page one row.
`canonicalPath()` wraps it with the query/trailing-slash trim the recorded
paths already have.

Corollary for the quiet list: a directory entry carrying a query
(`/rosters?view=planner`) can never be recorded separately, because the tracker
strips the query. Left in, it sits in "never been opened" forever. Those
entries are excluded from the quiet list rather than counted as dead.

---

## 2026-09-10 — A reserved field inside a franchise-keyed hash is free storage, and a silent phantom owner

**Context:** Signed-out page views had to land somewhere. A second daily hash
would have meant a second key, a second TTL and a second read per day.

**Insight:** The daily hash `pageviews:{leagueId}:{date}` is franchiseId →
count, and franchise ids are always digits, so the word `anon` can never
collide with one. Adding the signed-out total as a reserved FIELD costs no new
key, no new read, and no new command (it rides the same Lua script).

The trap is on the read side, and it is silent both ways: the chart maps
fields to configured franchises, so an unknown field is ignored and nothing
looks wrong — but anything that COUNTS fields ("owners active today") or SUMS
them ("league page views by owners") reads the signed-out bucket as a 25th
franchise with suspiciously round numbers. Every reader excludes
`ANON_PAGEVIEW_FIELD` explicitly, and `tests/site-analytics.test.ts` asserts
the exclusion in both the count and the sum, because the failure mode is a
plausible number rather than an error.

---

## 2026-09-10 — When the field space is too big to allowlist, an existing REGISTRY can be the allowlist

**Context:** `visit-surface-tracking.md` (2026-09-06) established that the real
risk of a public counter endpoint is hash cardinality, and capped the surface
hash at eight fields with a literal allowlist. Counting anonymous PAGE views
raises the same question with no small literal answer — the site has ~130
pages and gains more.

**Insight:** `page-directory.json` already enumerates every page, per league,
and is already required for a new route. Validating the anonymous `page` param
against it (`isDirectoryPath`, membership computed once per league and cached)
caps the hash at the size of the directory — a bound that grows only when a
developer adds a page, never when a caller sends a string.

The part worth copying is what happens to a REJECTED path: the visit still
counts toward the day's signed-out total, it just never names a page. Dropping
the whole visit would have made the traffic line quietly wrong for every
dynamic route (`/players/1234`), which is the opposite of the honesty the
signed-out counter exists for.

---

## 2026-09-10 — Today is always partial, so a streak may end YESTERDAY

**Context:** "Days in a row" per owner, computed off the daily hashes.

**Insight:** Counting back from the last day in the window gives every owner who
has not loaded a page yet today a streak of 0 — for most of the league, for
most of the morning. The number is technically defensible and reads as broken,
which is worse than a rounding error: it is a metric people check twice and
then stop trusting. So the walk-back skips a still-empty final day and counts
from there, and a streak that ended the day BEFORE yesterday still reads 0.
Both halves are pinned by test, because the fix is one line and reverting it
looks like a simplification.

---

## 2026-09-10 — Count the audience that can be REACHED, not the one that has an opinion

**Context:** Reporting how many owners have each notification category on.

**Insight:** Preferences and reachability are separate records — `push:prefs:`
is written by the settings page, `push:subs:` by the browser granting
permission — and an owner can easily have the first with none of the second
(they set preferences on a device, then revoked, or never finished). Counting
their stored preference reports an audience that will never see the alert, and
the error compounds per category. A franchise with `HLEN push:subs: == 0` is
skipped entirely, which makes every category number a subset of the "reachable"
headline by construction.

Two mechanical notes from the same read: use **HLEN, not HGETALL**, when the
only thing wanted is a device count — the hash values are full push endpoints,
and pulling 24 franchises' worth across the wire to call `.length` on them is
the expensive way to learn a number Redis already knows. And read the
per-franchise install and preference records with **MGET**, so the whole
section costs `2 + N` commands.

---

## 2026-09-10 — Reach is the half a ranking by volume hides

**Context:** Popular Pages had ranked by view count since it shipped.

**Insight:** The per-owner page hashes were already being read to render the
"By Owner" accordion, so counting how many DISTINCT owners have ever opened a
page is free — and it answers a different question than the ranking does. A
page with 500 views from two owners is somebody's private tool; a page with 90
views from twelve owners is the league's front door. Ranked by count alone
those two are indistinguishable, and the second one is the one worth investing
in. The same read also yields the pages with no views at all, which is the
maintenance list nobody had.

---

## 2026-09-11 — `clip: rect(...)` hides the PAINT, not the LAYOUT — and a hidden label in a scrolling table scrolls the whole page

**Context:** An owner reported that Owner Activity slid sideways on a phone and
that no other page did. A sweep of every public page at 390px confirmed it:
`document.scrollWidth` was 448 against a 390 viewport, and only there.

**Insight:** The cause was the standard visually-hidden box, in the Last Seen
table's mobile rule:

```css
@media (max-width: 639px) {
  .activity-label { position: absolute; width: 1px; height: 1px; clip: rect(0,0,0,0); }
}
```

Three facts compound into a page-level bug:

1. `clip` (and `clip-path`) suppress PAINTING. The box is still laid out and
   still contributes to scrollable overflow.
2. An absolutely positioned box with no `left`/`top` sits at its **static
   position** — where it would have been in flow. Here that is the last column
   of a table deliberately wider than the phone.
3. `overflow-x: auto` on the `.table-wrapper` does NOT clip an absolutely
   positioned descendant unless that wrapper is itself a containing block. It
   was `position: static`, so the label's containing block was the page, and
   sixteen 1px boxes landed ~58px past the right edge.

The fix is one declaration — `position: relative` on the status CELL — which
makes the scroll container the label's clipping ancestor. It has no visible
effect, which is why `tests/activity-hidden-label-anchor.test.ts` pins it: a
later cleanup reads it as dead weight.

**Two things worth carrying:**

- **Bisect, do not read.** Hiding candidate subtrees and re-measuring
  `document.documentElement.scrollWidth` found it in one pass; reading the page
  for it produced the wrong answer twice — the nav drawer sits at x=710 and
  contributes nothing, because a `position: fixed` subtree does not extend the
  document's scroll area.
- **Sweep the whole site, it is cheap.** Loading every `visibility: all` page
  from `page-directory.json` at 390px and comparing `scrollWidth` to
  `clientWidth` takes two minutes and answers "is it only this page?" with
  evidence. It also found three others that still overflow:
  `/league-comparison`, `/design-system`, and `/assets` in both leagues.

