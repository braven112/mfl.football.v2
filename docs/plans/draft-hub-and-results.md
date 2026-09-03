# Draft Hub, Draft Results, and `/draft/*` consolidation

Status: Phases 1-4 + 6 SHIPPED (2026-09-02). Phase 5 (AFL Draft Room) and the
deferred AFL Mock Draft are the remaining work.
Branch `claude/draft-results-page-be59e6`.

Goal: one coherent draft section. Every draft page reachable from every other,
a real historical Draft Results page, and TheLeague / AFL holding the same set
of draft pages.

## Decisions (from Brandon, 2026-09-02)

| Question | Decision |
|---|---|
| What is Draft Results | Full historical archive — every draft, every year |
| Landing state | Most recent completed draft, all teams |
| Startup drafts | Included, clearly labeled (TheLeague 2007 / AFL 2003–04) |
| Interlinking | BOTH a `/draft` hub page AND a sub-nav strip on every child page |
| URL shape | Nest everything under `/draft/*` |
| TheLeague `?view=history` tab | Retire; redirect to the new page |
| Leagues | TheLeague + AFL. No auction results. Best Ball untouched. |
| AFL conferences on Results | `?conference=` switcher, matching Draft Broadcast |
| AFL Draft Room | Build it, conference-aware (AL live board / NL slow-draft view) |
| AFL Mock Draft | Deferred to a follow-up |
| Mock Draft parity gap | Accept — the hub renders only the pages that league has |
| Hub content | Live draft state + last-draft recap strip + your draft capital |
| Old published links | Redirects AND rewrite the archives |
| Delivery | Phases 1–4 as one release; Phase 5 (AFL Draft Room) follows as its own PR alongside the deferred AFL Mock Draft |
| What's New hero | NOT hero-eligible — set `excludeFromHero: true` |

## Why this is not just "add a page"

`/theleague/draft-predictor?view=history` ALREADY renders a pick-by-pick board
(`buildHistoryRows`, draft-predictor.astro:344) with a year picker and a team
filter. It is TheLeague-only, buried as the third tab of a page called "Draft
Order", absent from the nav and from page-directory.json. The AFL twin has no
view selector at all. So the work is as much promotion and de-duplication as
it is new construction.

## Route map

Existing routes move; nothing new is invented for pages that already exist.

| Now | After |
|---|---|
| `/{league}/draft-predictor` | `/{league}/draft/order` |
| `/{league}/draft-broadcast` | `/{league}/draft/broadcast` |
| `/theleague/draft-room` | `/{league}/draft/room` (AFL: new, conference-aware) |
| `/theleague/mock-draft/**` | `/theleague/draft/mock/**` |
| — | `/{league}/draft` (new hub) |
| — | `/{league}/draft/results` (new) |

Unmoved and merely linked from the hub + strip: `/import-rankings`, `/cr`.
Best Ball keeps `/draft-room`, `/draft-board`, `/mock-draft` exactly as they
are — its nav is opt-in and separate.

### Redirects

`vercel.json` `redirects` (there are 8 today). Each old route needs BOTH forms,
because the apex hosts already 301 `/theleague/:path*` → `/:path*`:

- `/draft-predictor` → `/draft/order`
- `/theleague/draft-predictor` → `/theleague/draft/order`
- …and the same pair for broadcast, room, mock-draft.

ORDER MATTERS. Vercel evaluates the list top-down and the existing apex
prefix-strip rules are broad, so the draft rules go BEFORE them; otherwise an
apex request is rewritten to the unprefixed form and never sees a rule that
was written against the prefixed one.

Query strings survive Vercel redirects by default, which is what keeps
`?year=`, `?conference=`, `?rehearse=` and `?screensaver=` working on the
broadcast and order pages. `?view=history` on the old order URL is the one
case needing a destination change rather than a pass-through — it goes to
`/draft/results`, not `/draft/order?view=history`.

## Phases

### Phase 1 — route move + redirects (no behavior change)
Move the six page files, add the redirect pairs, rewrite the ~90 URL
references. Ships as a pure relocation: same pages, new addresses. Verifiable
by diffing rendered output before/after.

Reference surface, by weight: `whats-new.json` (13), `nav-config.json` (13),
`page-directory.json` (9), the two broadcast pages (6 each), the best-ball
pages (which reference TheLeague's draft-room in copy), `rosters.astro` (4),
mock-draft's own pages, `DraftHero.astro`, `article-links.mjs`, plus the
hero/spotlight resolvers (`afl-hero-resolver`, `afl-team-spotlight`,
`league-event-hero-view`, `hero-resolver`).

Published archives get rewritten too, per decision:
`whats-new-archive/2025.json`, `whats-new-archive/2026.json`,
`schefter-archive/2026.json`.

Tests that will need their expectations moved: `afl-draft-room-link`,
`afl-conference-draft-pills`, `draft-broadcast-preflight`, `draft-broadcast`,
`mock-draft-controls`, `pick-reveal`, `footer-champions`,
`schefter-rumor-topic-focus`, `insights-curated-head`.
`tests/fixtures/page-fork-baseline.json` keys on route paths — retighten it.

### Phase 2 — Draft Results page
One shared component, two thin route wrappers (the
`theleague/division-strength.astro` shape — auth gate and league data import
stay in the route, because a static import specifier can't be a runtime
variable and `Astro.redirect()` only redirects from a page).

- Source: `data/{league}/mfl-feeds/{year}/draftResults.json`, 2007–2026
  (TheLeague) and 2003–2026 (AFL).
- Reuse `buildHistoryRows` from draft-predictor rather than re-deriving it —
  lift it into `src/utils/draft-utils.ts` where the other draft helpers live.
  Note its `overallPickNumber` hardcodes a 16-team round; that is wrong for
  the AFL and for TheLeague's 2007/2008 drafts, so it has to take the round
  size from the feed instead.
- AFL: `draftUnit` is an ARRAY of two conference units. `?conference=`
  switcher, same param name and shape as the broadcast page.
- Startup drafts: 2007 TheLeague (320 picks), AFL 2003 (360, single unit) and
  2004 (192, single unit) render with a "Startup Draft" label so their size
  reads as intentional. Note AFL 2003/2004 have an EMPTY second conference
  unit — the switcher must not offer a conference with no picks.
- Default: most recent completed draft, all teams.

### Phase 3 — retire the History tab
Drop `history` from `DraftViewSelector`'s `VIEWS`, redirect
`?view=history` → `/draft/results`, delete the now-dead history branch from
draft-predictor.astro (~120 lines of frontmatter + markup + styles). Keep the
`rawView === 'trades' ? 'history'` legacy alias resolving to the redirect.

### Phase 4 — hub + sub-nav strip
`DraftNav.astro` — a shared strip listing the draft pages THIS league has,
current page marked `aria-current`. Rendered at the top of every `/draft/*`
page. Model it on `DraftViewSelector` (real `<a>` links, not click handlers —
that component's comment records that handlers never bound under the
ClientRouter and left the tabs dead).

`/draft` hub, shared component + two wrappers:
- live draft state (calendar + `/api/draft/status`, as `DraftCountdownHero`
  and the AFL hero resolver already do)
- last-draft recap strip → links into Results
- your draft capital (`DraftCapitalTable` / `DraftPicksCard` already exist)

Nav: regroup the scattered draft links in `nav-config.json` into one Draft
section pointing at the hub. NOTE `/theleague/draft-broadcast` is in
page-directory.json but MISSING from nav-config.json today — fix while here.

### Phase 5 — AFL Draft Room, conference-aware
The one genuinely new feature. `afl-draft-room-link.test.ts:16` is the
authority on why it can't be a port: the AL meets live in MFL's `ajax_ld`
applet, the NL runs a slow email draft off MFL's option page. So:
- AL → the live board (TheLeague's shape: timer, player pool, polling
  `/api/draft/status`)
- NL → slow-draft view: pick log, on-the-clock, NO countdown timer
- an MFL draft page is only offered to an owner of the drafting conference —
  that rule is already encoded in the hero resolver and must hold here.

### Phase 6 — registry, changelog, tests
- `page-directory.json`: entries for the hub and Results in both leagues, plus
  the AFL room; 10+ tags each (`tests/page-directory-data.test.ts` enforces).
  Update the moved paths.
- `whats-new.json`: new-page entry at the TOP, league editorial voice,
  screenshot (webp in `public/assets/whats-new/`), INLINE league-neutral links
  in the prose (`/draft`, `/draft/results` — never `/theleague/draft`).
  `excludeFromHero: true` — decided 2026-09-02, NOT a hero launch.
- `tests/page-fork-ratchet.test.ts` baseline: the two new pages are shared
  components with thin wrappers, so they must NOT enter the forked set.

## Traps specific to this work

1. `buildHistoryRows`'s `(round - 1) * 16 + pick` is a TheLeague-modern-era
   assumption. Wrong for AFL and for both TheLeague startup years.
2. AFL 2003/2004 carry a second conference unit with ZERO picks. A switcher
   built from `draftUnit.length` offers a dead tab.
3. `draftUnit` is an object for TheLeague and an array for the AFL. Normalize
   once, at the edge — the repo has been burned by exactly this shape drift
   before (see the weekly-results normalizer).
4. The hub and Results must be ONE component with thin wrappers per league.
   Copying the page per league is the `page-fork-ratchet` failure mode, and
   this repo already carries ~57,800 lines across 24 forked siblings.
5. What's New hrefs must be league-neutral — `rewriteDescriptionLinks`
   prefixes per reader, so a prefixed href sends half the audience to the
   other league's site.
6. Vercel redirect ordering vs. the existing apex prefix-strip rules.


## What the feeds actually turned out to contain

Written after building it. Every item here was found by reading the real
archive, and every one is pinned by `tests/draft-results-view.test.ts`.

1. **TheLeague's rounds are 16, 17 and 18 picks** — the toilet-bowl
   compensatory slots (1.17, 2.17, 2.18) make each round a different size. The
   `(round - 1) * 16 + pick` in the old history tab therefore gave round 3 pick
   1 the number 33, which round 2 pick 17 already had, and ended a 51-pick
   draft at 50. Overall numbering is now a running total of each round's real
   size. AFL 2010 and 2020 carry a 13th pick in one round for the same reason.

2. **AFL 2004 is two drafts in one unit.** Rounds 1-8 belong to twelve
   franchises and rounds 9-16 to a disjoint twelve — the same two sets MFL
   splits into proper conference units from 2005 on. The same players are
   drafted in both halves. Detected from the data (a round boundary with
   disjoint franchises either side), and REPORTED rather than rearranged:
   renumbering the second half would silently rewrite what MFL recorded.

3. **AFL 2003 has no selections at all** — 360 slots, not one player id. So
   does TheLeague's 2007 startup (320 slots, no ids). Both render as a board of
   blanks, which is correct, so the page says why.

4. **AFL 2004-2009 name players nothing can resolve** — 47% resolve in 2004
   rising to 96% by 2009 — because AFL `players.json` only begins in 2011.
   TheLeague's identity union is chained on as a fallback and currently adds
   NOTHING (the AFL union is a strict superset: a redraft league rosters far
   more players). The chain stays so that coincidence can't become a silent
   dependency.

5. **`----` is a skipped pick**, not a player id. MFL writes it with a "Pick
   Skipped By Commissioner" comment.

6. **The NFL team in the identity union is the player's CURRENT team**, not the
   one he was on when drafted — "Jameis Winston · NYG" on a 2015 board is
   simply false. It is shown only on the newest season, where it is a rookie's
   actual landing spot.

## Guards that caught real bugs during the build

Worth recording, because both fired on work that looked finished:

- `design-token-guard` rejected three tokens invented out of thin air
  (`--color-border`, `--color-accent-contrast`, `--color-accent-soft`). Each
  would have rendered its fallback in BOTH themes — light fine, dark broken.
  Fixed by adopting DivisionStrengthPage's local-alias idiom over the repo's
  real globals.
- `page-fork-ratchet` rejected 85- and 89-line route wrappers as too close to
  call. The data assembly moved into `buildDraftResultsView` /
  `buildDraftHubProps`, leaving the wrappers at 40-56 lines.

## Still to do

- **Phase 5 — AFL Draft Room, conference-aware.** `afl-draft-room-link.test.ts`
  is the authority on why it is not a port: the AL meets live in MFL's
  `ajax_ld` applet, the NL runs a slow email draft off MFL's option page. It
  must be a shared component behind a thin wrapper, or `draft/room.astro`
  becomes a genuine new fork.
- **AFL Mock Draft** (deferred). TheLeague's mocks a 3-round, 51-pick rookie
  draft; the AFL is 108 picks per conference.
- Publishing either to the AFL is a ONE-LINE edit: add `'afl-fantasy'` to that
  page's `leagues` in `src/components/shared/draft-nav/draft-pages.ts`. The hub,
  the strip and `tests/draft-section.test.ts` all read that list, and the test
  fails if a page is advertised to a league whose route file doesn't exist.
