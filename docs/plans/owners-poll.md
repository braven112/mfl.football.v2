# The Owners' Poll — owner-voted team rankings inside The Pecking Order

**Status:** plan, not built. Decisions below marked **[DECIDED]** came from
Brandon; **[OPEN]** ones still need a call before implementation starts.

## The idea

Every week during the season, each owner casts a ballot ranking the league's
best teams. The ballots are aggregated into a consensus "Owners' Poll" that
publishes **inside the existing Pecking Order column**, sitting next to the
algorithmic composite so the week's story becomes *the room vs. the machine*.

Owners may rank their own team. That is not a loophole to close — it is the
source of the Homer Index (below), which is one of the more entertaining
things this feature produces.

## Decisions already made

| Question | Answer |
|---|---|
| Cadence | **Weekly during the season** [DECIDED] |
| Ballot shape | **Rank a top N only**, not the full field [DECIDED] |
| Home | **Merged into the Tuesday Pecking Order article** [DECIDED] |
| Turnout levers in scope | **Results locked until you vote**, **GroupMe reminders with deep link**, **voter accountability + accuracy scoring** [DECIDED] |
| Scope for v1 | **TheLeague only.** AFL is a follow-on [DECIDED] — shipped 2026-09-06, see *The AFL port* below |
| Ballot depth | **7 slots** (of TheLeague's 16) [DECIDED] |
| Non-voter nag | **Count-only** — no @-mentions, no names in chat [DECIDED] |

### One tension worth naming

The original ask was "rank them 1st through last"; the chosen ballot shape is
top-N. Those are not the same thing, and the gap shows up at the bottom of the
table: with a 7-slot ballot in a 16-team league, **nine teams** are not *ordered*
by the poll, they are merely *omitted* by it, and any team nobody ranked ties at
zero points.

In practice the unranked block will be smaller than nine, because ballots
disagree — a team ranked 7th on one ballot and left off six others still scores.
Expect roughly the bottom four to six teams to land there in a typical week, and
most of the field to score in a chaotic one.

This plan resolves it by being honest rather than clever: the poll publishes a
ranked block (the teams that received votes) and an **unranked block** below
it, ordered by the existing Pecking Order composite and labeled as such. AP
polls have worked this way for a century and owners already understand the
convention. If the tail ordering later feels like a real loss, the escape hatch
is documented under *Phase 2 options* — don't build it in v1.

## What already exists (build on it, don't rebuild it)

The weekly column shipped as **The Pecking Order** — the working title "Tuesday
Power Rankings" was renamed to avoid colliding with MFL's own Power Rank
feature, and `/theleague/power-rankings` is now just a 301.

| Piece | Path | Notes |
|---|---|---|
| Generator | `scripts/generate-pecking-order.mjs` (782 ln) | One league per invocation; `--publish` posts the GroupMe announcement |
| Ranking math | `scripts/lib/pecking-order-math.mjs` | 50% all-play / 50% rolling-3wk PPG, both min-max normalized |
| AI voice | `scripts/lib/pecking-order-ai.mjs` | Schefter-voiced headline/lede/blurbs, deterministic fallback |
| Issue archive | `data/<league>/pecking-order/<year>-<week>.json` | Committed to git — this is the durable record |
| Rendering | `src/components/shared/PeckingOrder{Issue,Landing,Permalink}.astro` | Already shared across both leagues |
| Routes | `src/pages/<league>/pecking-order/{index.astro,[year]/[week].astro}` | Thin wrappers |
| Cron | `.github/workflows/schefter-articles.yml` | Tuesday 7am PT (`0 14 * * 2`) |
| Offseason gate | `src/utils/pecking-order-season-window.mjs` | `isSeasonWindowOpen` |
| GroupMe | `scripts/lib/groupme.mjs` | `postToGroupMe`, `buildMentionAttachment` |
| Owner↔GroupMe map | `scripts/map-groupme-owners.mjs` | Two-step propose/apply, per league |
| Franchise KV pattern | `src/utils/kv-franchise-store.ts` | Not directly reusable — see *Storage* |

Field sizes differ and are load-bearing: **TheLeague is 16 franchises, the AFL
is 24.**

## Timing — the hard constraint, and how to work around it

Merging the poll into the Tuesday column creates a squeeze. MNF ends late
Monday; the column generates Tuesday 7am PT. A ballot that must close before
generation would have a ~6-hour overnight window. That is a guaranteed turnout
disaster.

**Recommended: two-stage publish, keeping Tuesday.** The issue file gains an
`ownersPoll` block with a lifecycle:

```
Tue 07:00 PT   Column publishes as it does today.
               ownersPoll: { status: "open", closesAt, ballotsIn: 0 }
               Poll section renders a CTA + live turnout meter. No results.
               GroupMe: "Column's up. The computer says X is #1. Ballot's open."

Tue → Wed      Owners vote. Turnout meter is public and live.
Wed 10:00 PT   GroupMe nag, @-mentioning owners who haven't voted.

Wed 18:00 PT   Ballot closes.
Wed 19:00 PT   Second cron pass AMENDS the same issue file in place:
               ownersPoll: { status: "closed", consensus, ballots, stats }
               Commits it. GroupMe: the reveal.
```

Why this over moving the column later in the week: it preserves the Tuesday-morning
habit the column was deliberately built around, gives a **36-hour** voting
window instead of six, and buys **three** GroupMe touchpoints per week instead
of one — open, nag, reveal. The reveal is its own event, which is exactly what
a weekly poll wants.

**Rejected alternative:** close the ballot Tuesday 6am and publish everything at
once. Simpler pipeline, but the window is unusable.

**[OPEN]** Confirm the two-stage approach, and confirm the close time (Wed 6pm
PT assumes owners vote during the workday; Wed 9pm PT catches the evening
crowd but pushes the reveal to late night).

## The ballot

**Route:** `/<league>/pecking-order/ballot` — one segment, so it cannot collide
with the existing two-segment `[year]/[week].astro`. Per the sibling rule in
CLAUDE.md, build **one** `src/components/shared/pecking-order/BallotPage.astro`
plus thin per-league route wrappers holding the auth gate and league import.
`tests/page-fork-ratchet.test.ts` will fail the build on a forked copy.

**Interaction: tap-to-add in order, not drag-to-sort.**

- The screen shows every franchise as a card (logo, record, last week's rank,
  PPG). Tap one → it becomes #1. Tap another → #2. And so on to N.
- Tapping a selected team removes it and renumbers the rest.
- Long-press / drag within the *selected* list reorders it.
- Submit unlocks at exactly N.

Why not a pre-sorted drag list: a seeded order anchors every ballot to the seed,
and dragging 16 rows on a phone is precisely the chore that makes owners bail.
Tap-to-add has no seed to anchor to, and is a sub-60-second flow on mobile.

**N is per-league registry config, never a literal.** Add to
`src/config/leagues-data.mjs`:

```js
ownersPoll: {
  enabled: true,   // theleague only for v1; afl-fantasy stays false
  slots: 7,        // TheLeague: 7 of 16
  quorum: 8,       // 8 of 16 ballots
  closeHourPT: 18,
}
```

`slots: 7` is set. It stays **registry config rather than a constant** even
though only one league uses it in v1 — that is what
`tests/league-literal-guard.test.ts` enforces, and it is what makes adding the
AFL a config entry later instead of a refactor. Give `afl-fantasy` an
`ownersPoll: { enabled: false }` entry now so the shape exists and the shared
components always have something to read.

**Ballot resubmission.** An owner may change their ballot freely until close.
The stored record keeps `submittedAt` and `updatedAt`.

**Prefill from last week.** From week 2 onward the ballot opens pre-populated
with that owner's *previous* ballot, clearly labeled "Your Week N-1 ballot —
edit or submit as-is." This is the single largest ongoing effort reduction and
the main defense against week-6 apathy. It is not the anchoring problem the
seeded-drag-list would have been: it is *their own* prior opinion, not the
system's suggestion.

## Scoring

**Borda points.** On each ballot, slot 1 earns `slots` points, slot 2 earns
`slots - 1`, … slot N earns 1. Every ballot contributes an identical point pool,
so no voter has more weight than another.

- **Consensus rank** = total points, descending.
- **Ties** broken by (1) most first-place votes, (2) higher Pecking Order
  composite.
- **Teams with zero points** are not ranked. They render in a distinct
  "Unranked" block ordered by the composite, with the label stated plainly on
  the page.
- **First-place votes** are displayed next to the leaders, AP-style: `1. Dark
  Magicians (9)`.

**The poll never blends into the composite.** "Merged into the article" is a
decision about *placement*, not *math*. The Pecking Order's algorithmic rank
stays exactly as it is; the poll sits beside it with a **Δ column** showing
disagreement. Averaging the two would destroy both signals and delete the only
interesting thing here — where the room and the machine disagree.

**Quorum: 8 of 16.** Below that the poll does not publish a consensus. The
section instead reads "No quorum — only 5 of 16 ballots cast" (a count, not a
list of names) and the column runs algorithm-only that week. This makes turnout
a collective stake rather than an individual chore, and it is honest: a
"consensus" backed by four ballots is not one.

Half the league is the right bar for a 16-team field — low enough to clear in a
normal week, high enough that the published consensus means something. Revisit
it after a few weeks of real turnout data rather than guessing again now.

## Turnout levers (all three chosen levers, plus the cheap ones)

### 1. Results locked until you vote [DECIDED]

While `status: "open"`, the poll section renders one of two states depending on
the viewer:

- **Hasn't voted** → CTA, live turnout meter, and a teaser: *"11 ballots are in.
  Cast yours to see where the room has you."*
- **Has voted** → their own submitted ballot, the live turnout meter, and *still
  no consensus numbers* (releasing running totals mid-window would let late
  voters game the result).

**This gate must be server-side.** Render the locked state in SSR frontmatter —
never ship the results into the HTML and hide them with CSS, which view-source
defeats in one keystroke.

Once `status: "closed"`, everything is public to everyone, voter or not. The
lock is a nudge during the window, not a permanent paywall — the column is the
league's public record and must stay readable.

### 2. GroupMe reminders with deep link [DECIDED]

Three posts per week through `postToGroupMe`, per-league Schefter bot:

1. **Tue 07:00 PT — open.** Bundled into the existing column announcement.
   Lead with bait, not a chore: *"The computer has the Magicians #1 and the
   Pigskins 11th. Disagree? Ballot's open."*
2. **Wed 10:00 PT — nag, count-only.** *"9 of 16 ballots are in. Seven owners
   left, poll closes at 6."* **No @-mentions and no names.** That rules out
   `buildMentionAttachment` here, and it means this feature needs no dependency
   on `scripts/map-groupme-owners.mjs` at all. Skip the post entirely at 100%
   turnout.

   Count-only is the weaker lever, deliberately. Compensate with the ones that
   don't call anyone out: the scarcity framing above (a deadline and a
   shrinking number), the public turnout meter, and the ballot prefill.
3. **Wed 19:00 PT — reveal.** Top 3, biggest riser/faller, the largest
   room-vs-machine disagreement, and the week's Homer.

Message-text rules from `docs/claude/rules/league-urls.md` apply and are not
optional: build the deep link with `leagueUrl(league, '/pecking-order/ballot')`
— never concatenate an origin and a path — and run the text through
`stripLinkAdjacentPunctuation`, or GroupMe autolinks the trailing period and
404s the link for every owner.

**[DECIDED]** Count-only. Naming non-voters was the stronger lever and was
rejected on purpose — record that here so a future session doesn't "improve" the
nag by adding the names back.

### 3. Voter accountability + accuracy scoring [DECIDED]

New page `/<league>/pecking-order/voters` (shared component, thin wrappers),
reading committed issue JSON only — no live KV, so it is a static read.

Per owner, per season:

- **Ballots cast** — `12 / 14`, with a per-week grid. Participation is a public
  stat.
- **Pairwise Accuracy** — the leaderboard. For every pair of teams on your
  ballot, did the team you ranked higher finish higher in **next week's
  all-play**? Score = % of pairs correct, accumulated across the season. Pairs,
  not raw rank error, so a ballot isn't punished for the field shifting
  underneath it; all-play rather than head-to-head result, because a single
  fantasy matchup is mostly luck and would make the leaderboard noise. With
  `slots: 7` that is **21 pairs** per ballot per week, so a 14-week season
  yields ~294 comparisons per owner — enough that the noise washes out, though
  the leaderboard won't mean much before about week 6. Don't headline it early.
- **Contrarian Index** — mean absolute distance from the final consensus. Not
  accuracy, and labeled as such: it measures independence, and it is a badge,
  not a demerit.
- **Homer Index** — (consensus rank of your team) − (your rank of your team).
  Positive means you rate yourself higher than the room does. This is the whole
  reason self-voting is allowed, and it will produce the best chat of the week.

Every ballot becomes fully public once its week closes. Voting weekly is
therefore a permanent, attributable record — which is the point.

### 4. Free levers worth taking

- **Live turnout meter** on the article, visible to everyone, all window.
  Public progress bars move people.
- **Turnout stated in the column**, as a count: *"14 of 16 ballots cast."*
  Naming non-voters there would contradict the count-only decision for chat, so
  don't — the participation record lives on the accountability page, where it
  reads as a season stat rather than a weekly callout.
- **Prefill from last week's ballot** (above) — the effort lever that matters
  most from week 3 onward.
- **One-tap entry from the nag.** The deep link should land logged-in owners
  directly on the ballot with the field already rendered; no interstitial.

## Storage

**Redis during the window, git after close.** Two different jobs:

- **Open window (Redis).** Key: `poll:<scope>:<year>-<week>:<franchiseId>`,
  value = the ballot. `scope` comes from `rankingsScopeForLeagueId` in
  `src/utils/rankings-scope.ts`. **The league scope is load-bearing, not
  decoration: both leagues have a franchise `0001`**, so an unscoped key is
  genuinely ambiguous the moment the AFL writes to it. That mistake is already
  documented in CLAUDE.md — do not re-make it here.
- **After close (git).** The close pass reads every ballot, computes the
  consensus, and writes the whole thing — consensus *and* individual ballots —
  into `data/<league>/pecking-order/<year>-<week>.json`, then commits. Redis is
  the working set; the committed issue file is the archive, and the
  accountability page reads only the archive.

`createKvFranchiseStore` is **not** directly reusable: its key shape is
`prefix:franchiseId` with no week dimension, and the poll needs a
commissioner-facing aggregate read the factory doesn't express. Write a sibling
factory or a purpose-built route rather than bending that one.

**API routes** (`src/pages/api/owners-poll/`):

| Route | Auth | Behavior |
|---|---|---|
| `POST /ballot` | authed owner | Upsert own ballot. Rejects if closed, wrong length, dupes, or unknown franchiseId |
| `GET /ballot` | authed owner | Own ballot + open/closed status |
| `GET /turnout` | public | `{ ballotsIn, total }` only — never per-owner detail while open |

Non-negotiables, all of them prior bugs in this repo:

- Auth is `getAuthUser()` (signed session cookie) only. Never re-add unsigned
  identity headers.
- The client sends `?league=`; the server **rejects a mismatch** against
  `user.leagueId`. The session is the input; the param is a check.
- The franchise written is always `user.franchiseId` from the session — never a
  value from the request body.
- Rate-limit `POST /ballot` via `src/utils/rate-limit.ts`.
- The ballot's franchise ids are validated against the league's actual roster of
  franchises before storage.

## Generator changes

`scripts/generate-pecking-order.mjs` gains a `--close-poll` mode for the
close pass. The aggregation math it calls is already built — see *Build
status* below.

The Schefter voice pass gets the poll as new fact-sheet material: biggest
room-vs-machine disagreement, unanimous #1, the week's Homer. Note the recorded
gotcha — **the AI response is keyed by `franchiseId`, and a fact sheet that
omits it makes every blurb silently fall back to the template.**

Cron: a second entry in `.github/workflows/schefter-articles.yml` at
`0 2 * * 4` (Wed 19:00 PT = Thu 02:00 UTC) running `--close-poll` for each
league sequentially — v1 runs TheLeague only, but keep the per-league loop and
the non-fatal-per-league error handling the Tuesday pass already uses, so
enabling the AFL later is a registry flip rather than a workflow edit.

**Prerequisite:** the workflow needs Upstash credentials to read ballots.
Confirm those secrets are available to that workflow before starting — the
Tuesday pass has never needed Redis.

## Guards to respect

- **Season window.** Gate on `isSeasonWindowOpen`, not "the feeds have a
  completed week." That guard cannot see the offseason: `currentSeasonYear()`
  runs on the Labor Day clock, so Feb→Labor Day resolves to a finished season
  whose feeds are complete by definition. An ungated poll opens a ballot in
  July. This has already fired once in production.
- **Year clock.** Results-shaped feature → `getCurrentSeasonYear()`, never
  `getCurrentLeagueYear()`.
- **Registry.** No league ids, slugs, data paths, or field sizes inline —
  `tests/league-literal-guard.test.ts` scans for them.
- **Page directory.** Both new pages need entries in
  `src/data/page-directory.json` with 10+ tags each, or they are invisible to
  site search. Nothing warns you.
- **Page fork ratchet.** Shared components + thin route wrappers only.
- **What's New.** This is a `new-feature`: requires a webp screenshot,
  league-neutral inline links in the prose (`/pecking-order`, not
  `/theleague/pecking-order`), and an explicit call on hero eligibility —
  `/update-whats-new` prompts for it; don't decide silently.
- **Best ball** is excluded. No games are played, so there is nothing to rank —
  same reason it is excluded from the column.

## Build status

**Steps 1-6 are built** — the whole plan. What shipped, and the things that
came out differently from the sketch above:

| File | Role |
|---|---|
| `src/utils/owners-poll-ballot.mjs` | Ballot validation, KV key construction, window state, stored-record parsing |
| `scripts/lib/owners-poll-math.mjs` | Borda tally, ties, quorum, unranked block, pairwise accuracy, contrarian, homer |
| `src/utils/owners-poll-store.ts` | Caller resolution + Redis reads/writes for the API |
| `src/pages/api/owners-poll/ballot.ts` | GET/POST the caller's own ballot |
| `src/pages/api/owners-poll/turnout.ts` | Public count-only turnout |
| `src/config/leagues-data.mjs`, `leagues.ts` | `ownersPoll` registry entry + `OwnersPollConfig` type |
| `src/utils/owners-poll-access.ts` | Page gate (routes own the redirect) |
| `src/utils/owners-poll-builder.ts` | Pure tap-to-add state transitions |
| `src/components/shared/owners-poll/OwnersPollBallotPage.astro` | Shared page |
| `src/components/shared/owners-poll/BallotBuilder.tsx` | Ballot island |
| `src/pages/theleague/pecking-order/ballot.astro` | Thin route wrapper |
| `src/styles/owners-poll.css` | Page styles |
| `src/data/page-directory.json` | Search entry (21 tags) |
| `tests/owners-poll-{math,ballot,api,builder}.test.ts` | ballot + API + math |
| `src/utils/owners-poll-window.mjs` | Open/close timing, DST-correct |
| `scripts/lib/owners-poll-redis.mjs` | Node-side store (keys shared with the app) |
| `scripts/lib/owners-poll-pass.mjs` | Open pass, close pass, GroupMe copy |
| `scripts/owners-poll-window.mjs` | Manual open / status / close CLI |
| `src/components/shared/owners-poll/OwnersPollSection.astro` | Article section |
| `src/components/shared/owners-poll/OwnersPollLive.tsx` | Open-state island |
| `src/utils/owners-poll-accuracy.mjs` | Pairwise accuracy (page-side) |
| `src/utils/owners-poll-voters.ts` | Season accountability math |
| `src/components/shared/owners-poll/OwnersPollVotersPage.astro` | Voters page |
| `src/pages/theleague/pecking-order/voters.astro` | Thin route wrapper |
| `src/pages/api/owners-poll/window.ts` | Commissioner open/close control |
| `src/components/shared/owners-poll/PollWindowAdmin.tsx` | Commissioner strip |
| `.github/workflows/schefter-articles.yml` | Wed nag + Wed close crons |
| `tests/owners-poll-{window,pass,voters}.test.ts` | 135 tests across 7 suites |

**The math did not all land in one file.** The plan said
`scripts/lib/owners-poll-math.mjs` for everything, but validation is asked by
BOTH sides — the API rejecting a submission, and the close pass skipping a
stored ballot that no longer validates — and scripts cannot import TypeScript.
So the shared half lives in `src/utils/owners-poll-ballot.mjs` (plain `.mjs`,
the same dual-consumer pattern as `franchise-id.mjs` and
`pecking-order-season-window.mjs`), and only the generator-only tally math is
in `scripts/lib/`. Duplicating the ballot rules across the two would have been
the version that eventually disagrees with itself.

Three decisions worth knowing before touching this code:

- **Keys are always league-scoped, with no legacy bare form.**
  `poll:<navSlug>:<year>-w<week>`, deliberately NOT reusing
  `rankings-scope.ts#scopedKvKey`, whose conditional shape exists only to
  preserve TheLeague's pre-existing keys and whose default fails OPEN to
  TheLeague. The poll has no legacy data, so it takes the safe shape.
- **Ballots are a Redis HASH keyed by franchise**, not one key per owner.
  HGETALL reads the week in one round trip at close, HLEN answers the public
  turnout meter without transferring a single ballot, and per-field writes are
  atomic so simultaneous submissions cannot clobber each other.
- **The eligible-franchise list travels with the window record**, written by
  the Tuesday pass. That keeps a route from doing a filesystem read or a
  static import of one league's config (a static import specifier cannot be a
  runtime variable), and guarantees the API validates against exactly the field
  the close pass will tally.

**Reordering is arrow buttons, not drag.** The sketch said long-press/drag
within the selected list. For a seven-row list, up/down buttons are more
reliable under a thumb and work with a keyboard and a screen reader, which
drag does not without a full a11y implementation. Verified in a real browser:
removing a pick renumbers the rest and drops Submit to `(6/7)`, disabled.

**Card order is alphabetical, and the composite rank is not shown on a card.**
Sorting the ballot by the machine's ranking would anchor every owner to it —
the one thing the poll exists to disagree with. Records and PPG are shown as
neutral context, read from the latest issue's standings snapshot.

**The team accent ships both brand colours.** `--op-team` and `--op-team-dark`
are set inline per card and CSS picks per theme, covering both the
`prefers-color-scheme` default and an explicit `[data-theme]` toggle. The first
cut passed only `colorPrimary`; several teams' primaries are near-black and
vanished against a dark card, which is the "looks perfect in light, ships
invisible in dark" failure this repo has shipped before.
`tests/design-token-guard.test.ts` is the standing guard for the broader
version of that bug and already covers this file.

**Everything is wired, and it will start itself.** The Tuesday Pecking Order
cron opens the ballot, Thursday morning nags, and the pass after Thursday's
kickoff close tallies and reveals. The workflow already carried Upstash secrets (cut-watch needed them),
so no new secret is required.

It cannot run *yet* only because the season hasn't started: the column
self-skips until the season it would rank is actually being played
(`isSeasonWindowOpen`), so the earliest real ballot is the Tuesday after
Week 1.

To see it before then, open a window by hand. **Two ways, and the browser one
needs no credentials** — the deployment already holds them:

**From the ballot page (commissioner only).** A `Commissioner` strip sits above
the ballot when `isCommissionerOrAdmin` passes: set a week and a duration, press
*Open ballot*. This is the recovery path in a real season too — a Tuesday run
that errored after writing the issue, or a league that wants the window
extended.

**From a shell** (needs `pnpm dlx vercel env pull` first):

```bash
node scripts/owners-poll-window.mjs open --league theleague --week 1 --hours 48
node scripts/owners-poll-window.mjs status --league theleague
node scripts/owners-poll-window.mjs close  --league theleague
```

Both write the same key and the same record shape. `close` on either only
removes the pointer — it never tallies and never deletes ballots, so re-opening
the same week picks them all back up (and the API reports the existing count,
so a non-zero number on a "fresh" open is not a surprise). Tallying is
`generate-pecking-order.mjs --close-poll`, deliberately a separate action.

## Build order (all complete)

1. ~~**Math + storage.**~~ Done — see above.
2. ~~**Ballot page.**~~ Done — see above.
3. ~~**Article integration.**~~ Done.
4. ~~**Close pass + cron.**~~ Done.
5. ~~**GroupMe.**~~ Done — open bait folded into Tuesday's announcement, a
   count-only nag, and the post-close reveal.
6. ~~**Accountability page.**~~ Done — `/pecking-order/voters`.

### Still open — needs Brandon

**The What's New entry is deliberately NOT written.** It is a `new-feature`, so
it needs a webp screenshot in `public/assets/whats-new/` (which only exists once
a real ballot has been opened and photographed) and an explicit call on **hero
eligibility** — CLAUDE.md says to ask rather than decide that silently, and
`/update-whats-new` prompts for it. Run that once a ballot has run for real.

Everything else on the four remaining open questions (two-stage publish, quorum
8, close 6pm PT, no participation stake) is implemented as the recorded
default and is a one-line registry or cron change if you want it different.

## Next: enabling the AFL (handoff)

TheLeague's poll shipped in PR #821. The AFL is deliberately not in it —
`ownersPoll.enabled: false` in the registry, no ballot/voters route wrappers,
and the categories are hidden there (see below). Start a FRESH branch off main
rather than extending #821.

**What already works, unchanged, the moment the flag flips.** The math, ballot
validation, KV scoping, window/kickoff clamp, accuracy scoring and every API
route are league-generic and already read their numbers from the registry. The
nag and close passes both no-op cleanly today (`[skip] AFL does not run the
Owners' Poll`, exit 0), and the workflow already invokes them for both leagues.

**What has to be decided, because 24 teams is not 16:**

| Question | Why it can't just be copied |
|---|---|
| Ballot depth | TheLeague ranks 7 of 16. Sevenof24 leaves 17 teams unranked — well past the "roughly the bottom four to six" this plan accepted. 10-12 is the honest starting range, and it changes how the unranked block reads. |
| Quorum | 8 of 16 is half. Half of 24 is 12, which is a much harder turnout bar in a league that is already twice as hard to get moving. |
| Conferences | The AFL is 12 + 12 across two conferences that draft differently and barely play each other. One leaguewide poll asks an AL owner to rank NL teams they have no read on — the same problem the draft room had to solve. A per-conference poll is the obvious alternative and is a real design fork, not a config change. |

**Mechanical work, once those are answered:**

1. `ownersPoll` block in `leagues-data.mjs` — `enabled: true`, plus the agreed
   `slots` and `quorum`.
2. Two thin route wrappers under `src/pages/afl-fantasy/pecking-order/`
   (`ballot.astro`, `voters.astro`) — copy TheLeague's shape exactly: auth gate
   and league data import in the route, everything else in the shared
   component. Do NOT fork the component (`tests/page-fork-ratchet.test.ts`).
3. `src/data/page-directory.json` entries for both, 10+ tags each.
4. The lineup ballot strip on the AFL lineup page.
5. Nothing needed for notifications: the three poll categories gate on
   `ownersPoll.enabled` via `requiresOwnersPoll`, so they appear on the AFL's
   `/notifications` page automatically and are correctly hidden until then.
6. A What's New entry tagged `["afl"]`.

**Guard that will catch a half-done job:** `tests/notification-preferences.test.ts`
asserts the poll categories are hidden from a league that does not run the
poll — flipping the flag without the pages will start offering toggles that
link nowhere.

## Phase 2 options (deliberately not in v1)

- **Optional deep ranks.** Top N required, ranks N+1…last optional, so a
  completist can order the whole field. Scoring stays uniform (only the first N
  slots earn points) and the deep ranks feed the tail order and accuracy
  scoring. Real fix for the omitted-tail problem, but it adds a scoring rule
  that is harder to explain — and explainability is what makes a poll trusted.
- **Vote from inside GroupMe.** `scripts/schefter-groupme-listen.mjs` already
  handles inbound messages, so a reply like `1,4,7,…` could submit a ballot with
  no site visit at all. Removes the last friction point; meaningfully bigger
  build, and worth doing only if turnout is still weak after the levers above.
- **Preseason and postseason special issues** outside the weekly cadence.
- **Season-long consensus champion** — the owner whose cumulative ballots best
  tracked the final standings, as an end-of-year award.

## Open questions

Settled: v1 is **TheLeague only**, the ballot is **7 slots**, and the nag is
**count-only**. Four calls remain, and none of them block starting on step 1 of
the build order — the math and storage layer is identical either way.

1. **Two-stage publish, or move the column later in the week?** Two-stage is the
   recommendation and the rest of this doc assumes it. Say so if you'd rather
   move the column.
2. **Quorum at 8 of 16?** Written in as the default. It is one registry number,
   trivially changed after real turnout data.
3. **Close time Wed 6pm PT or 9pm PT?** 6pm is written in. 9pm catches the
   evening crowd but pushes the reveal to ~10pm, which is a worse time to land
   a GroupMe post people will actually read.
4. **Any real stake on participation, or is the leaderboard enough?** No stake
   assumed in v1. A dues- or draft-order-linked penalty is a constitution
   question, not a code one, so it needs a league decision before it could be
   built regardless.

The AFL question below is now settled.

## The AFL port (2026-09-06)

The deferred question was whether the AFL's two conferences want
conference-scoped ballots rather than one 24-team poll. **Settled: one
league-wide ballot.**

The reason is the column, not the league structure. The poll publishes *inside*
The Pecking Order, and the AFL Pecking Order already ranks all 24 franchises in
a single list — it has since it shipped. A conference-scoped consensus printed
beside a league-wide machine ranking would disagree with it about which teams
are even comparable, which is not the "room vs. the machine" story this feature
exists to tell; it is just two tables that cannot be read against each other.
Duplicate players make cross-conference comparison awkward to *argue* about,
and that argument is the entertainment.

This is the one place the AFL's conference split does NOT apply, so it is
asserted in `tests/owners-poll-ballot.test.ts` rather than left to be
rediscovered — the draft pages are the cautionary case, where a
conference-scoped feature that didn't scope its data source served everyone the
AL's picks. If the call is ever reversed it is a design fork with its own
windows, keys and tally, not a registry edit.

**What the port actually was.** The machinery was already league-generic: keys
are `poll:<navSlug>:…`, every pass reads `league.ownersPoll`, and the cron had
been invoking both leagues since the feature shipped. So:

| Piece | Change |
|---|---|
| `src/config/leagues-data.mjs` | `ownersPoll.enabled: true`, `slots: 10`, `quorum: 12` |
| `src/pages/afl-fantasy/pecking-order/{ballot,voters}.astro` | Thin wrappers — auth gate and issue glob only, same shape as TheLeague's |
| `src/pages/afl-fantasy/lineup.astro` | The `LineupBallotStrip` island, `client:idle` |
| `src/data/page-directory.json` | Two entries, or the pages are invisible to search |
| Notification toggles | None — the three poll categories gate on `ownersPoll.enabled`, so they appeared the moment the flag flipped |
| Cron, GroupMe, push | None — already per-league, already invoking `--league afl-fantasy` |

**The numbers are the rules re-applied, not the numbers reused.** 10 slots keeps
roughly the share of the field TheLeague ranks (7/16 ≈ 10/24); copying 7 across
would have ranked under a third of the AFL and left most of it tied at zero.
12 is the same "half the field" quorum that 8-of-16 is.

**Three tests had used the AFL as their negative case** — "a league whose poll
is disabled", "a commissioner of ANOTHER league", "hides the poll categories
from a league that does not run it". Enabling the AFL turned all three into
tests of nothing. Two now use Best Ball, which is disabled by design (draft-only:
no lineups, no weekly team story to rank). The third was really about the
`?league=` check and had been passing for the wrong reason: with the AFL
disabled, `poll-disabled` fired before the mismatch check ever ran. It now
addresses TheLeague explicitly with an AFL commissioner's session, which is the
guard it always claimed to be.

## The worked example in the archive (2026-09-06)

The poll shipped after the last real column ran, so every committed issue
predated it and `OwnersPollSection.astro` — correctly — rendered nothing. The
result was a one-way link: the ballot and voters pages point INTO the column,
and the column mentioned the poll nowhere, which is the one page an owner
following that link lands on.

`scripts/seed-example-owners-poll.mjs` fills that gap until Week 1 produces a
real poll. It is seeded into each league's latest issue —
`data/theleague/pecking-order/2025-17.json` and
`data/afl-fantasy/pecking-order/2025-14.json`.

**These ballots are fabricated.** Nobody cast them. They are attributed to real
franchises and they publish into the archive the voters page reads, so treat
them as a demo fixture with a real byline, not as league history. Two things
keep that honest:

- Every seeded block carries `source: "synthetic"`, and the seeder **refuses to
  overwrite a block without it** — a real tally is never clobbered by a demo.
- The tally is not faked. The block is assembled by `buildClosedPollBlock`
  (`scripts/lib/owners-poll-pass.mjs`) — the SAME function the real close pass
  calls, not a copy of it, which is why a field added to a closed poll cannot
  silently skip the example. What renders is the real pipeline over invented
  input, and `tests/owners-poll-pass.test.ts` pins both the published key set
  and the fact that `closePoll` returns exactly what the builder produces.

Ballots are built so the Δ column shows something: the room's shared base order
blends the published composite with the pure recent-scoring order (owners chase
last Sunday harder than a 50/50 composite does), then per-voter noise, then a
per-owner homer bump. Output is deterministic — same seed, same file — so a
re-run never churns the archive.

**Known limit of seeding only the latest week.** Pairwise accuracy scores a
ballot against the FOLLOWING week's all-play, and neither seeded week has a
successor, so the voters page's accuracy column reads `—` for every owner.
Seeding `2025-16` and `2025-13` as well would make the earlier week scorable.
