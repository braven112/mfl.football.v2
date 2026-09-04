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
| Scope for v1 | **TheLeague only.** AFL is a follow-on [DECIDED] |
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

Why this over moving the column to Wednesday: it preserves the Tuesday-morning
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
- **After close (git).** The Wednesday pass reads every ballot, computes the
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
Wednesday pass. Ballot aggregation math goes in a new pure
`scripts/lib/owners-poll-math.mjs` (Borda, ties, quorum, accuracy, homer,
contrarian) so it is unit-testable and has no file I/O or league literals —
same shape as `pecking-order-math.mjs`.

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

## Suggested build order

1. **Math + storage.** `owners-poll-math.mjs` with unit tests (Borda, ties,
   quorum, unranked block, accuracy/homer/contrarian). Registry config. Ballot
   API routes with auth, scope, and validation tests.
2. **Ballot page.** Shared component, thin wrappers, tap-to-add UI, prefill.
   Ship it behind the season-window gate and test with `?testDate=`.
3. **Article integration.** `ownersPoll` block in the issue schema; open and
   closed states in `PeckingOrderIssue.astro`; the server-side results gate;
   turnout meter.
4. **Close pass + cron.** `--close-poll`, the second workflow entry, and the
   Wednesday commit.
5. **GroupMe.** Open bait, @-mention nag, reveal.
6. **Accountability page.** Leaderboards, per-week grid, published ballots.

Steps 1–3 are a usable feature on their own (a poll owners can vote in and see
results from). 4–6 are what make it *stick*.

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

1. **Two-stage publish, or move the column to Wednesday?** Two-stage is the
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

Deferred with the AFL, to revisit when it is enabled: the AFL's two conferences
may want conference-scoped ballots rather than one 24-team poll. That is a
design fork, not a config value — the draft pages hit the same split, where a
conference-scoped feature that didn't scope its data source served everyone the
AL's picks.
