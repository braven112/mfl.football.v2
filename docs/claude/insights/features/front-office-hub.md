# The Front Office hub — one page, both leagues, real actions

Built 2026-09-17, five phases in one branch
(`docs/plans/front-office-hub.md` carries the plan and the per-phase
outcomes). The hub went from a read-only planner that each league rendered
its own copy of, to one shared page where an owner can price, file and
simulate roster moves.

Files, by layer:

| Layer | Files |
|---|---|
| Data | `src/utils/front-office-panel-data.ts` (one entry point), `front-office-planner-data.ts` (TheLeague), `front-office-keeper-data.ts` (AFL) |
| Analytics | `src/utils/roster-analytics.ts` (was `afl-roster-analytics.ts`) |
| Cap model | `src/utils/cap-projection.ts` |
| Contract core | `src/utils/contract-actions-client.ts` |
| Panel | `src/components/shared/front-office-hub/FrontOfficePanel.astro` + `RosterAnalyticsPanel`, `NflCollegeStacks`, `DraftAssetChips`, `CutCandidatesCard`, `CapProjectionTable`, `ScenarioBar`, `FrontOfficeActions` |
| Routes | `src/pages/{theleague,afl-fantasy}/front-office/index.astro`, 70 lines each |
| Guards | `tests/front-office-shared-analytics.test.ts`, `tests/contract-actions-client.test.ts`, `tests/cap-scenario-boundary.test.ts` |

## What this cost, and what it was hiding

The brief was "add analytics and let me extend contracts". The work was
mostly finding the same code written five times.

| Thing | Copies found |
|---|---|
| Roster analytics | 3 — the AFL hub panel, and both `rosters.astro` files |
| The hub panel itself | 2 — 428 + 751 lines rendering the same page shape |
| `POST /api/contracts/declare` | 4 — bulk submit, CDM wizard, homepage FA card, and the hub about to be a fifth |
| The veteran-extension formula | 5 — `salary-calculations`, `rosters.astro`, the client core, and `extension-salary-calculator.ts` |
| The dead-money percentage table | 4 — three of them inside `rosters.astro` alone |

Plus 1,549 lines of cap-planning UI (`TeamCapAnalysis`,
`BudgetPlannerPanel`, `FranchiseTagPanel`) imported **nowhere**, and
described as live capabilities in `cap-projection-gap-analysis.md`. An
audit doc can go stale in the direction of claiming something exists.

## Five things worth remembering

**A feature flag beats a slug compare, and a test can tell them apart.**
Sections render on `leagueHasFeature(slug, 'contracts' | 'keepers')` and on
whether their data is present, never on `leagueSlug === 'theleague'`. A
guard counts the slug branches in the panel and allows exactly one — the
claim verb, because "TheLeague bids, the AFL claims" genuinely cannot come
from a flag. Counting rather than forbidding is what makes the rule
survivable.

**"Un-actionable for others" and "unreadable by others" are different.**
The plan said browse any team, act only on your own. That assumed every
section is public data. The AFL keeper plan is a private strategic
scratchpad with owner-only read enforced at the API — rendering it for
another team would have drawn an empty board backed by a 403. The guard
now asserts the API really is owner-only, so the privacy argument cannot
outlive its reason.

**Measure before pre-rendering per team.** The hub's switcher swaps
pre-rendered panels, which is right for metrics, FA needs and draft chips
because they are small. It was badly wrong for the NFL/college stacks:
~19 `PlayerCell`s per team at ~2 KB each (a three-deep headshot `onerror`
chain plus the modal's JSON) came to 1.45 MB raw / 133 KB gzipped for
fifteen teams nobody was looking at, doubling the page. Charts stay
pre-rendered; stacks render for the selected team only.

**A comment's premise can expire while the comment stays true-sounding.**
`front-office-planner-data.ts` passed `ytdPointsByPlayer: new Map()` with a
comment explaining that the planner renders no scoring column. Correct when
written; by the time the extension cards arrived, those cards pick
candidates by rank *or* points, so every player reading `points: 0` made
both cards rank arbitrarily. Nothing failed — it just quietly chose the
wrong players. When you add a consumer, re-read what the producer decided
not to send.

**The parity harness is what makes touching `rosters.astro` survivable.**
`scripts/roster-parity-check.mjs` was run before every phase that went near
that page and reported "PARITY: 12 (season, team) renders identical" each
time, including across the contract-math extraction. It is the only way to
refactor 7k lines of imperative client script with any confidence, and it
costs about ninety seconds.

## The line the cap planner defends

Ticking extend / tag / cut mutates an in-memory scenario and
re-projects three seasons. It never calls an API. Filing is the separate
act of pressing a button in the cards above, and doing so dispatches
`fo:action-filed`, which drops that player from the scenario — otherwise
the projection counts the same move twice, once as scratch and once as the
pending declaration it just became.

That promise is one careless `fetch` away from being false, and the failure
would be silent: the projection would still look right.
`tests/cap-scenario-boundary.test.ts` pins it as a scan — a `fetch` in
either component fails the build, and the only literal URL allowed in the
action component is `/api/cut-player`.

## Deliberately not built

**Comp-pick projection.** The gap-analysis doc specced "if you let this guy
walk, here's the comp pick you'd get". There is no such rule:
`docs/claude/league-rules.md` has none, and TheLeague's only compensatory
picks are the three toilet bowl slots (1.17, 2.17, 2.18), already handled
in `draft-utils.ts`. Building it would mean inventing a league rule on a
page owners plan against. Note this is unrelated to the removed `walk`
toggle above — a lapsing contract is already the baseline.

**A "walk" toggle, built and then removed.** It dropped a player from every
season at zero cost. Nothing in this league does that — a cut leaves dead
money, a trade is the only other exit — so it offered cap space that cannot
exist. Worth remembering as a shape: a simulator's danger is not a wrong
number, it is a lever for a move the real world does not have. And what it
was reaching for, a contract running out, was never a move: the baseline
projection already drops a player the season their years expire.

**The draft chip's multi-hop trade chain.** The reveal is built and
accessible (button + `aria-expanded` + `aria-describedby`, hover/focus/tap
— not `title`, which never fires on touch), but it is latent:
`extractAssetsFromTransactions` walks trades into an ownership map it
*overwrites* at each hop, so only the original and current owners survive
and a twice-traded pick reads the same as a once-traded one. Retaining that
history is a change to a shared util with its own callers.
