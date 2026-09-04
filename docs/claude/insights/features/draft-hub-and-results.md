# Draft Hub & Draft Results

The draft section: `/draft` (hub), `/draft/results` (historical archive), and
the `DraftNav` strip that ties every draft page together. Shipped 2026-09-02.
Plan and decisions: `docs/plans/draft-hub-and-results.md`.

---

## 2026-09-02 - What MFL's Draft Archive Actually Contains, and Why "Overall Pick Number" Was Wrong for Nine Years

**Context:** Building a historical draft archive meant reading every
`draftResults.json` both leagues have — TheLeague 2007-2026, the AFL
2003-2026. Almost none of the shape assumptions in the existing code survived
contact with the old seasons.

**Insight 1 — draft rounds are NOT uniform, so an overall pick number must sum
each round's REAL size.** TheLeague's rookie draft is 51 picks over three
rounds of **16, 17 and 18** — the extra slots are the toilet-bowl compensatory
picks (1.17, 2.17, 2.18), which is why the round sizes differ. The code this
replaced computed `(round - 1) * 16 + pick`, which gives round 3 pick 1 the
number 33 — already held by round 2 pick 17 — and ends a 51-pick draft at 50.
The AFL's 2010 and 2020 conference boards carry a 13th pick in one round for
the same kind of reason. Build the numbering from a running total of each
round's observed max pick, and assert `1..n` with no gaps or collisions
(`tests/draft-results-view.test.ts`).

**Insight 2 — a "unit" can hold TWO drafts.** The AFL's 2004 feed is a single
`CONFERENCE00` carrying rounds 1-16, where rounds 1-8 belong to twelve
franchises and 9-16 to a **disjoint** twelve — the same two sets MFL splits
into proper conference units from 2005 on. The same players are drafted in both
halves. Detect it from the data (a round boundary with disjoint franchises
either side), not from a hardcoded year — and REPORT it rather than
rearranging: renumbering the second half would silently rewrite what MFL
recorded.

**Insight 3 — an empty unit is not a conference.** AFL 2003 and 2004 carry a
`CONFERENCE01` with zero picks, because the league drafted as one body before
it split. Filter units on having picks BEFORE selecting a default, or the
conference switcher offers a tab that opens onto nothing.

**Insight 4 — MFL sometimes kept the ORDER and lost the PICKS.** AFL 2003 has
360 recorded slots and not one player id; TheLeague's 2007 startup has 320 with
the same hole. `----` is a further sentinel, meaning a commissioner-skipped
pick — treat any non-numeric player id as "no selection", never as an id. A
board of blanks is correct for those seasons, so say WHY on the page; an
unexplained column of dashes reads as a bug.

**Insight 5 — the identity union is per-league and they COMPOSE.**
`scripts/compute-player-identity-union.mjs` already took `--league=`; the AFL's
artifact is now built in prebuild alongside TheLeague's, and
`getGlobalPlayerMap(slug)` caches per league (one shared cache would have
served whichever league asked first). AFL `players.json` only starts in 2011,
so about half of the 2004 board and a shrinking tail through 2009 name players
nothing can resolve. TheLeague's union is chained on as a fallback and today
adds *nothing* — the AFL union is a strict superset, since a redraft league
rosters far more players — but the chain keeps that coincidence from becoming a
silent dependency.

**Insight 6 — the NFL team in the union is the player's CURRENT team.** On a
2015 board that renders "Jameis Winston · NYG", which is false about that
draft, and retired players render the placeholder "NFL". Show it only on the
newest season, where it is a rookie's actual landing spot.

---

## 2026-09-02 - Feed Globs: Lazy Keys Give You the Year List for Free

`import.meta.glob(..., { eager: true })` on `draftResults` puts every season in
the serverless chunk to render one board — 1.2 MB for the AFL's 24 years. A
**lazy** glob is strictly better for a year-picker page: the KEYS are known at
build time (so the season list is free, no directory read at runtime) while
only the season being viewed is loaded. That also avoids the `readdirSync` on a
`process.cwd()` path that defeated Vercel's file tracer and dragged all of
`data/` into the function — the thing
`compute-player-identity-union.mjs` was written to undo.

Same reasoning applies to a feed wanted for ONE year (calendar,
futureDraftPicks): glob it lazily and pick the year at runtime rather than
writing the year into a static import specifier, which is a league constant
that goes stale at the next rollover.

---

## 2026-09-02 - A Full-Bleed Island Page Ships With No Way Out

**Context:** Draft Broadcast and Draft Room render nothing but a hydrated
island — no header, no breadcrumb, no chrome. Nobody noticed until an owner
landed on the big board and found the browser back button was the only exit.

**Insight:** A page whose entire body is one component is exactly the page that
gets no navigation, because there is no markup to hang it on and no obvious
place it is missing from. Reviewing the *diff* of such a page shows a tidy
five-line template and nothing wrong.

Two things followed:

- **Make one component own "how you get out of here."** `DraftNav` renders the
  breadcrumb trail AND the strip, taking a `crumb` prop. A page cannot then
  ship with half of it, and there is no per-page header to forget.
- **Guard it by enumerating routes from the FILESYSTEM, not from a list.**
  `tests/draft-section.test.ts` walks `src/pages/*/draft/**`, checks that walk
  against its hand-written route list (so a new page cannot be added without
  being noticed), then asserts each route renders `DraftNav` with a crumb — and
  that none renders its own `Breadcrumbs`, since two trails on one page is the
  failure mode of fixing this page-by-page.

Note `readdirSync`, not a glob: this repo has **no glob dependency**, and
`node:fs` does not export `globSync` at the pinned `@types/node` version — a
test that imports it type-checks red while passing at runtime, which the
`astro check` ratchet catches and `pnpm test:unit` does not.

---

## 2026-09-03 - The AFL Drafts Twice, and MFL Can Only Say So Once

**Context:** Giving the AFL a draft room, which the plan had deferred because
its two conferences do not hold the same kind of draft.

**Insight 1 — MFL's `league.json` carries ONE `draft_kind` for a league whose
halves draft differently.** The AFL's says `"email"`. That is true of the
National League, which drafts over days off MFL's email-draft page (option 52),
and false of the American League, which meets in person and picks in the
live-draft applet (`ajax_ld`). Software that trusts the feed gets one of the
two wrong every time. The fact now lives in `afl.config.json`'s conferences and
is read through `getConferenceDraftKind` — a league fact the feed cannot
express belongs in league config, not in an inference.

It was already encoded a SECOND time, structurally, in `afl-hero-resolver.ts`'s
separate `afl-al-draft` / `afl-nl-draft` card builders, whose draft-day CTA
logic is too subtle to safely rewrite as a config lookup.
`tests/afl-conference-draft-kind.test.ts` therefore makes the two AGREE rather
than merging them: each card must offer its own conference's URL and never the
other's. When one source of truth is not achievable, a test that fails on
disagreement is the next best thing.

**Insight 2 — the poll URL is where conference scoping silently breaks.**
`/api/draft/status` accepts `?unit=` and falls back to the FIRST unit without
one. The draft room's client polled with only `year` and `league`, so an AFL
room would have served every NL owner the AL's picks — server-rendered
correctly, then overwritten within seconds by the wrong conference's board.
`DraftRoomPageData` now carries `pollUnit` (and `mflHost`, since the endpoint
defaults to TheLeague's). A conference-scoped page is not scoped until its
POLLING is scoped too.

**Insight 3 — `draftContext` defaults to `'rookie'`, which is wrong for every
redraft league.** The room's pool opens filtered to rookies unless told
otherwise. On the AFL that showed 133 players for a draft that takes 108 of
~1,235 — a board that looked plausible and was almost entirely empty of the
players about to be drafted. Best-ball already passed `'general'`; the AFL
needs it too. Caught only by LOOKING at the rendered page: every test passed,
and the number was wrong rather than missing.

**Insight 4 — extraction is forced by the guard, and that is the right order.**
`draft/room.astro` becomes a two-league sibling the moment the AFL gets one, so
`page-fork-ratchet` fails unless BOTH copies are thin. TheLeague's 165-line
route had to become a 73-line wrapper over
`utils/draft-room-data#buildDraftRoomData` before the AFL's could exist at all.
The AFL's needed a second extraction (`utils/afl-draft-room`) to clear the
band — the guard rejects 75-98 lines as "too close to call", not just >80.
