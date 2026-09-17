# Front Office hub — Phase 3: one page, both leagues, real actions

**Status:** planned (2026-09-17)
**Supersedes the "eventual cutover" note in** `src/components/shared/front-office-nav/front-office-pages.ts`
**Predecessors:** Front Office Phase 1 (link grid), Phase 2 (hub became the planner —
`docs/claude/followups/2026-09-16-league-planner-two-destinations.md`)
**Absorbs:** `docs/plans/cap-projection-gap-analysis.md` — its open question
("confirm with Brandon") is answered here; its four phases become Phase E below.

## The ask

> "The league's new front office page needs to incorporate the analytics just like AFL
> is. Make sure that each of these UI's is reused across both leagues and we take the
> best of the AFL and apply to the league. I also want to be able to make my contract
> extensions straight from the front office page… So a user can do everything a front
> office would need to do."

Three things, in dependency order:

1. **Analytics on TheLeague's hub** — it has none; the AFL's hub has a full set.
2. **One implementation per UI, both leagues** — today the hub forks at the panel
   level (`TheLeaguePlannerPanel` 428 lines vs `AflKeeperPlannerPanel` 751 lines),
   and the analytics inside the AFL panel exist a *third* time inline in each
   league's `rosters.astro`.
3. **Act, don't just plan** — declare extensions, franchise tags and cuts from the
   hub, instead of bouncing to `rosters.astro`.

## Decisions taken (Brandon, 2026-09-17)

| Question | Answer |
|---|---|
| What can an owner do from the hub? | **Extensions + franchise tags**, and **cuts / dead money**. Not lineups, waivers or trades — those stay where they are. |
| How is the extension machinery shared? | **Extract into a shared module** both `rosters.astro` and the hub mount. Retire `HpUnsignedFaCard`'s hand-copy of the same driver. |
| How much analytics on TheLeague? | **The AFL set + TheLeague's own cap charts.** |
| Layout | **One long stacked page.** No tabs. |
| Roster surface for cuts | **Action cards only** — no roster table on the hub. |
| Team switcher | **Browse any team, act only on your own.** The AFL gets a switcher too. |
| Draft assets layout | **The AFL's chip layout wins** — TheLeague's two ChartCards take far too much real estate. |
| What a chip shows | Pick position + immediate origin (`1.03 · via Magicians`), full trade chain on reveal. |
| Two draft years | **One card**, a year subhead per chip group. No side-by-side ChartCards. |
| Cap planning depth | **All four phases** of `cap-projection-gap-analysis.md`: 3-year projection, live what-if toggles, saved/comparable scenarios, comp-pick projection. |
| The three orphaned cap panels | **Delete all three**, build fresh against the current shared math. |
| Simulate vs commit | **Simulate freely, commit deliberately** — toggles are local scratch; nothing reaches MFL or the declaration store until an explicit Submit. |

### One consequence of "action cards only", stated up front

A cut card that only lists "cut candidates" cannot cut a player it does not surface.
So the Cut card lists **the whole selected roster**, ranked by cut value (savings
minus dead money), showing the top 8 with a "Show all N" expander. It reads as an
action card, but every player on the roster is reachable from it. If that turns out
to feel like a table anyway, that is the signal to revisit the table decision — not
a reason to ship a card you cannot cut from.

## Where the duplication actually is

Counted, not remembered:

| UI | Copies today |
|---|---|
| Roster analytics (position donut, age) | `src/utils/afl-roster-analytics.ts` + `AflKeeperPlannerPanel.astro` (SSR), AFL `rosters.astro` analytics view (inline), TheLeague `rosters.astro` analytics view (inline, client-rendered) — **3** |
| NFL / College stacks | AFL panel (SSR), AFL rosters (inline), TheLeague rosters (client-rendered into empty containers) — **3** |
| Contract-decision driver (CDM open → compute → stage → submit) | `rosters.astro` (~lines 5488–6130), `HpUnsignedFaCard.astro` (~lines 578–760) — **2** |
| Front Office hub panel | `TheLeaguePlannerPanel` + `AflKeeperPlannerPanel` — **2** |
| Draft assets on the hub | AFL `kp-picks` chips (~60 lines) vs TheLeague `DraftPicksCard` (340) + `DraftTeamAssetsView` (379) inside up to two `ChartCard`s — **2 layouts, ~12x the code** |

The *math* is already shared and must not be re-derived:
`src/utils/salary-calculations.ts` (`calculateFranchiseTag`, `calculateVeteranExtension`,
`calculateCutPenalty`, `calculateCapChargesWithActions`, `getReferenceSalary`),
`src/utils/contract-eligibility.ts` (`getPlayerEligibility`, `getTeamEligibility`),
`scripts/lib/roster-season-payload.mjs` (per-player salary/contract resolution).
Only the **UI drivers** are forked.

## Target shape

One shared panel, composed of shared sections, each gated on a registry feature flag
rather than on a league name. `leagueHasFeature(slug, 'salaryCap' | 'contracts' | 'keepers')`
decides what renders — adding a third league is then a registry entry, not a fork.

```
FrontOfficeHubPage.astro                 (shell — unchanged)
├── FrontOfficeTeamSwitcher.astro        (now BOTH leagues)
└── FrontOfficePanel.astro               (NEW — replaces both league panels)
    ├── FrontOfficeMetricStrip           cap space / avg per player / signed / dead $ / avg age
    │                                    AFL variant: roster size / keepers used / avg age
    ├── CapProjectionTable                NEW  [salaryCap] — 3 years side by side, scenario-aware
    ├── ScenarioBar                       NEW  [salaryCap] — save / name / compare / reset what-ifs
    ├── ContractActionsSection           owner-only  [contracts]
    │   ├── FranchiseOptions             existing card + action kebab
    │   ├── VeteranExtensionCandidates   existing card + action kebab
    │   ├── CutCandidatesCard            NEW  [salaryCap]
    │   └── ContractActionsBar           NEW — staged actions + Submit + Clear All
    ├── KeeperPlanner                    owner-only  [keepers]   (AFL, unchanged)
    ├── FreeAgentNeedsCard               [contracts]
    ├── DraftAssetChips                   NEW SHARED — the AFL's chip row, both leagues
    ├── RosterAnalyticsPanel             NEW SHARED — the AFL set, plus cap charts [salaryCap]
    └── <details> NFL & College stacks   NEW SHARED — SSR both leagues, open by default
```

Section order stays driven by `data-planner-phase` (`src/utils/planner-phase.ts`), which
already floats Extensions to the top during the extensions-and-tags window. The new
action sections join that ordering rather than inventing a second one.

### New/changed files

| File | Change |
|---|---|
| `src/utils/roster-analytics.ts` | **New** — `afl-roster-analytics.ts` generalized and renamed; adds cap-allocation, position-$ allocation and cap-efficiency builders behind the `salaryCap` flag. Old module becomes a re-export shim for one release, then goes. |
| `src/components/shared/front-office-hub/RosterAnalyticsPanel.astro` | **New** — the one analytics UI. Position donut + age-by-position strip + age stats (from the AFL) + cap allocation / roster composition / position $ / cap efficiency (from TheLeague's rosters tab). |
| `src/components/shared/front-office-hub/NflCollegeStacks.astro` | **New** — extracted from `AflKeeperPlannerPanel`, SSR for both leagues. |
| `src/utils/contract-actions-client.ts` | **New** — the extracted CDM driver: eligibility → open CDM → compute via `salary-calculations` → stage → `POST /api/contracts/declare`. One module, three hosts. |
| `src/components/shared/front-office-hub/ContractActionsBar.astro` | **New** — "Submit Tags/Extensions" + "Clear All", moved out of `rosters.astro`'s roster-controls. |
| `src/components/shared/front-office-hub/CutCandidatesCard.astro` | **New** — whole roster ranked by cut value, `calculateCutPenalty` preview, confirm → `POST /api/cut-player`. |
| `src/components/shared/front-office-hub/DraftAssetChips.astro` | **New** — the AFL's `kp-picks` chip row, generalized. Replaces `DraftPicksCard` + `DraftTeamAssetsView` **on the hub only**. |
| `src/utils/cap-projection.ts` | **New** — pure module: roster + a scenario → cap space for N seasons. Escalation and cap charges come from `salary-calculations.ts`; nothing is re-derived. |
| `src/components/shared/front-office-hub/CapProjectionTable.astro` | **New** — 3 seasons side by side, re-rendered live as toggles change. |
| `src/components/shared/front-office-hub/ScenarioBar.astro` | **New** — save / name / load / compare / reset. |
| `src/utils/cap-scenarios.ts` | **New** — scenario storage, scoped via `rankings-scope.ts`'s helpers (see Hazards). |
| `src/components/theleague/{TeamCapAnalysis,BudgetPlannerPanel,FranchiseTagPanel}.astro` | **Deleted** — 1,549 lines imported nowhere. |
| `src/components/shared/front-office-hub/FrontOfficePanel.astro` | **New** — replaces `TheLeaguePlannerPanel` + `AflKeeperPlannerPanel`. |
| `src/utils/front-office-panel-data.ts` | **New** — merges `front-office-planner-data.ts` + `front-office-keeper-data.ts` behind one `buildFrontOfficePanelData(slug, franchiseId)`. |
| `src/pages/{theleague,afl-fantasy}/front-office/index.astro` | Thin wrappers only — auth gate, cookie write, data import, one component. **Must stay under 80 lines** (see Hazards). |
| `src/pages/theleague/rosters.astro` | Mounts the extracted driver instead of its inline copy. Analytics + planner tabs stay for now. |
| `src/components/theleague/hp-sections/HpUnsignedFaCard.astro` | Drops its hand-copy of the driver. |

## Draft assets: the AFL's chip layout wins

TheLeague's hub currently renders draft assets as up to **two `ChartCard`s side by
side**, each holding a `DraftTeamAssetsView` (379 lines, grouped by round with team
icons and per-round headers) or a `DraftPicksCard` (340 lines, pick rows with trade
chains) — and it pre-renders one hidden copy **per team, per year**, so the team
switcher can swap without a fetch. That is 16 x 2 full asset views in the SSR payload
for a section most owners read in two seconds.

The AFL does the same job in a `kp-picks` flex-wrap row of two-line chips, roughly 60
lines of markup and CSS, one card, no per-round chrome. It wins on real estate and on
payload, and it is what ships.

`DraftAssetChips.astro` generalizes it:

- **Chip face:** `1.03` over `via Magicians` for TheLeague, `2nd round` over
  `via Dynasty Warriors` for the AFL (no predicted order exists there). Untraded picks
  read `Original`, exactly as the AFL's do today.
- **Full trade chain on reveal.** `formatTradeChain`'s multi-hop provenance does not
  fit a chip, so it is revealed rather than dropped. **Not a bare `title` attribute** —
  that is invisible on touch and unreliable for screen readers. The chip is a
  `<button type="button">` with `aria-expanded` and `aria-describedby` pointing at the
  chain text, revealed on hover, on focus, and on tap. A pick with no chain is a plain
  `<span>`, not a button that does nothing.
- **Both years in one card**, each year a small group label above its own chip row.
  The `showDualDraftCards` branch in `planner-phase.ts` stops selecting between two
  `ChartCard`s and instead selects how many year groups the one card renders — the
  phase logic is reused, the layout fork is not.
- **The team switcher swap gets cheaper.** Per-team chip rows are small enough to keep
  pre-rendering all of them, so switching stays fetch-free.

**`DraftPicksCard` and `DraftTeamAssetsView` are not deleted and not edited.**
`rosters.astro` is their only other host, and it keeps them until its planner tab is
retired. Changing them would put a cosmetic refactor inside the 12k-line page for no
benefit — the hub simply stops importing them.

## Salary cap planning: from one reactive year to three simulated ones

Today the hub's cap planning is **one year, precomputed, read-only** — five
`MetricCard`s of display strings. `docs/plans/cap-projection-gap-analysis.md` already
specced the fix and ended on "confirm with Brandon"; confirmed, all four phases.

### First, a find: 1,549 lines of cap-planning UI that nothing renders

| Component | Lines | Imported by |
|---|---|---|
| `TeamCapAnalysis.astro` | 543 | **nothing** |
| `BudgetPlannerPanel.astro` | 559 | **nothing** |
| `FranchiseTagPanel.astro` | 447 | **nothing** |

The gap-analysis doc describes all three as live capabilities — they are not, and have
not been for long enough that nobody noticed. **All three are deleted.** They carry no
guard test, have had no eyes on them, and their cap math predates the current shared
`salary-calculations.ts`; mounting stale cap math on a planning page is worse than
having no page. What is worth keeping from them is the *design* (BudgetPlanner's
planned-spend-vs-cap summary and warning strip is a good shape), and that is reused in
`ScenarioBar` deliberately rather than by import.

### The model: simulate freely, commit deliberately

One scratch object, `Scenario`, holds a bag of hypothetical moves:

```ts
type ScenarioMove =
  | { kind: 'extend'; playerId: string; years: number }
  | { kind: 'tag';    playerId: string }
  | { kind: 'cut';    playerId: string }
  // NB: a "walk" move was built and then REMOVED — see Phase E's outcome.
```

`cap-projection.ts` is pure: `(roster, scenario, years) => CapYear[]`. It composes
`calculateCapChargesWithActions`, `calculateVeteranExtension`, `calculateFranchiseTag`,
`calculateCutPenalty` and `ANNUAL_ESCALATION` from `salary-calculations.ts`. **No cap
formula is written in this module** — if a number is wrong it is wrong in one shared
place, the same place the Trade Builder and `rosters.astro` read.

The hard line, and the reason this design was chosen:

- A **toggle** mutates the scenario in memory and re-renders the projection. It never
  calls an API. Nothing is filed, nothing is visible to the commissioner, nothing
  reaches MFL.
- A **Submit** on a specific action posts exactly that action to
  `/api/contracts/declare` or `/api/cut-player`, and the action bar names what is being
  filed before it goes.
- Committing an action **clears it from the scenario** and it reappears as a real
  pending declaration, so the projection never double-counts a move that is now real.

That boundary is guard-tested, not just documented — a toggle handler that reaches a
`fetch` is the failure this feature can most plausibly ship.

### Scenario storage

Named scenarios are per-owner, per-league. **Both leagues have a franchise 0001**, so
the keys go through `src/utils/rankings-scope.ts`'s existing helpers rather than a new
scheme: `scopedLocalKey('fo.scenarios', scope)` for localStorage, and — if these should
follow an owner between devices — `scopedKvKey('fo:scenarios', scope, franchiseId)`
behind the same `?league=` check the rankings sync uses, where the KV scope comes from
the session and the param is a check, never an input. **localStorage first**; the Redis
mirror is a follow-up, not a prerequisite.

### Comp-pick projection is BLOCKED — the rule may not exist

The gap-analysis doc's Phase 4 assumes a free-agency compensatory pick: "if you let
this guy walk, here's the comp pick you'd get and when." **There is no such rule in
`docs/claude/league-rules.md`.** The only compensatory picks in TheLeague are the three
**toilet bowl** slots (1.17, 2.17, 2.18), awarded by consolation bracket results and
already handled in `src/utils/draft-utils.ts` — nothing to do with free agency.

So the projection would have to invent a formula, and a planning page that invents a
league rule is worse than one that omits it. This item stays specced and unbuilt until
Brandon either points at the rule or states it. Everything else in Phase E is
unblocked and does not depend on it.

## Phases

Each phase is independently shippable and leaves the tree green.

### Phase A — shared analytics — **SHIPPED 2026-09-17**
1. Generalize `afl-roster-analytics.ts` → `roster-analytics.ts`; add the cap builders.
2. Build `RosterAnalyticsPanel.astro` + `NflCollegeStacks.astro`.
3. Mount in **both** hub panels (still two panels at this point).
4. Build `DraftAssetChips.astro` and swap TheLeague's two draft `ChartCard`s for it.
   Presentational and self-contained, so it rides along with the analytics work.
5. TheLeague's hub gains analytics — the headline ask, delivered first.

**Done.** Both hubs render `RosterAnalyticsPanel` + `NflCollegeStacks`; the cap block
is gated on the `cap` prop (fed from the registry's `salaryCap`), never on a slug.
`afl-roster-analytics.ts` → `roster-analytics.ts`, widened with `buildCapAnalytics`,
which composes `salary-calculations.ts` and declares no cap formula of its own.

Two things the build turned up that the plan had not anticipated:

**1. The AFL's rendering is provably unchanged.** Diffed the authenticated
`/afl-fantasy/front-office` DOM before and after the extraction: byte-identical apart
from one `</div>` — the stacks are now a sibling of the analytics block rather than a
child, because each component owns its root. No visual or behavioural effect; the
modal listener moved with the markup it serves.

**2. Pre-rendering 16 teams of NFL/college stacks doubled the page.** TheLeague's hub
switches teams by toggling pre-rendered panels, so the first cut rendered every team's
stacks: 300 `PlayerCell`s at ~2 KB each (a three-deep headshot `onerror` chain plus
the modal's JSON payload) — **1.45 MB raw / 133 KB gzipped, for fifteen teams nobody
is looking at.** Page went 1.45 MB → 3.29 MB raw, 134 KB → 267 KB gzipped.

The charts are cheap (~26 KB a team, pure SVG) and stay pre-rendered for all 16, so
switching teams is still instant for the part an owner actually compares. The stacks
now render for the selected team only, and switching offers a link that reloads the
page for that team. Final: **1.92 MB raw / 160 KB gzipped** — +26 KB gzipped over
baseline for the whole analytics suite, with the chip row giving ~20 KB raw back.
`tests/front-office-shared-analytics.test.ts` pins the stacks outside the per-team
loop so this cannot silently regress.

Guards: `tests/front-office-shared-analytics.test.ts` (new, 17 assertions) plus the
existing AFL suite, updated to follow the extraction rather than weakened. New
`front-office-hub` domain in `.claude/hooks/path-guard.json` runs them on every edit
in that territory.

### Phase B — one panel — **SHIPPED 2026-09-17**
6. Fold both panels into `FrontOfficePanel.astro`, sections gated on feature flags.
7. Merge the two data builders into `front-office-panel-data.ts`.
8. Give the AFL a team switcher; `isOwner` becomes
   `selectedTeamId === viewer's own franchise`, not `signedIn`.

**Done.** Both league panels are deleted and replaced by `FrontOfficePanel.astro`;
`buildFrontOfficePanelData` is the single entry point; both routes are 70 lines. The
AFL has a team switcher for the first time, and an AFL owner can browse any of the 24
teams read-only.

**The keeper board is owner-PRIVATE, which the plan had not distinguished.** "Browse
any team, act only on your own" assumed every section is public data that is merely
un-actionable for someone else. The AFL keeper plan is not: it is a private strategic
scratchpad, and `/api/afl-keepers` enforces owner-only read in so many words ("owners
can only read/write their own plan… the plan is private (no public read) since it's a
strategic scratchpad"). Rendering it for another team would draw an empty board backed
by a 403. So the board renders for the viewer's own team only and the panel says why;
everything else on the AFL hub — analytics, stacks, draft chips, metrics — is public
roster data and follows the switcher. `tests/front-office-shared-analytics.test.ts`
pins both halves, including a check that the API really is owner-only, so if that ever
becomes a public read the privacy argument gets re-examined rather than silently
outliving its reason.

Three smaller things the build settled:

- **The metric strip is a list, not five fixed tiles.** TheLeague's are cap-shaped
  (cap space, avg per player, players signed, dead money, age); the AFL's are
  roster-shaped (size, average age, youngest, oldest). The switcher's script walks
  whatever the server sent rather than naming `fo-metric-cap`, which would no-op on
  the other league.
- **`MetricCard`'s `hint` is red.** The AFL's youngest/oldest tiles put a player's
  name there at first and it rendered as an error. A neutral fact belongs in
  `subtitle`; `hint` is for something the owner must act on, like "Must cut 3 players".
- **Action sheets are not interchangeable.** `AFLActionModal` carries real roster
  writes (IR / Cut / Trade block), so it mounts only with the keeper board — i.e. only
  for the viewer's own team. Mounting it while browsing someone else's would offer
  writes against a roster you do not own. `WatchListBridge` (watch/bid) mounts for
  contract leagues. Browsing another AFL team mounts neither, because nothing there
  triggers one.

`page-fork-ratchet.test.ts` earned its keep: the AFL wrapper first landed at 77 lines,
inside the 75–98 band that test asserts is empty so the 80-line threshold stays a
clear call rather than a judgement one. Rather than re-argue the threshold, the cookie
assembly moved into `rememberAflTeamChoice` (the `rememberSundayTicketChoices`
precedent — the route still makes the call, the helper only builds the arguments) and
both routes came to 70.

Sizes: the AFL hub went 526 KB raw / 80 KB gzipped → 971 KB / 101 KB, the cost of
pre-rendering 24 teams of charts so the switcher never fetches. TheLeague's moved
160 KB → 167 KB gzipped.

### Phase C — extract the contract driver — **SHIPPED 2026-09-17**
9. Lift the CDM driver out of `rosters.astro` into `contract-actions-client.ts`.
10. Re-point `rosters.astro` and `HpUnsignedFaCard` at it. **No behavior change here** —
    this phase is a pure move, proved by `scripts/roster-parity-check.mjs`.

**Done.** `contract-actions-client.ts` holds the pricing adapter and the submit; all
four hosts (rosters.astro's bulk submit, `cdm-wizard.ts`, the homepage's Unsigned FA
card, the hub) file through it. `scripts/roster-parity-check.mjs` reported
**"PARITY: 12 (season, team) renders identical"** before and after, run three times
across the change.

**Less was left than the plan assumed, and more.** The CDM wizard had already been
extracted to `cdm-wizard.ts` by `docs/plans/rosters-page-split.md` phase 6.1 — the
plan's "lift the CDM driver" was largely already done. What was still duplicated was
the *arithmetic*: `rosters.astro` carried its own franchise tag, team option, veteran
extension and cut penalty, byte-identical to `salary-calculations.ts` and differing
only in how they looked position averages up. Plus **three** copies of the dead-money
percentage table inside that one page. All now delegate.

The modal's open/populate/step flow deliberately stays page-local: it closes over
`contractActions`, `recalculateRoster`, `currentTeam` and the row it launched from,
and lifting it would mean inventing an abstraction over a 7k-line script to serve one
caller. The hub uses its own small trigger and the shared core instead.

### Phase D — actions on the hub — **SHIPPED 2026-09-17**

**PREREQUISITE found during Phase A — the hub's players all have `points: 0`.**
All 393 players in the hub's shipped player list carry zero points.
`rosters.astro` has an explicit fallback for this (its ~line 1242: "Between Feb 15
and Labor Day, current season points are 0. Fall back to last season's points so
extension/franchise tag filtering works"), and `front-office-planner-data.ts` never
ported it — it deliberately loads ONE season, so there is no prior season to fall back
to. Consequences, in order of importance:

- `VeteranExtensionCandidates` and `FranchiseOptions` on the hub filter on points, so
  the two cards Phase D hangs its declare buttons off are already picking candidates
  from zero-point rosters. **Fix this before wiring actions to them**, or the buttons
  will be attached to the wrong players.
- The Cap efficiency chart added in Phase A reads empty ("No scoring yet this season")
  for the same reason. That copy is accurate, and the chart fills in on its own once
  the feed carries scoring, so it is not itself a bug — but it is the symptom that
  surfaced this.

The fix is to load the prior season's points into the builder, which is a real change
to a module narrowed to one season on purpose. Size it in Phase D rather than
smuggling it into a presentational change.


11. Mount `ContractDeclarationModal` + `ContractActionsBar` in `FrontOfficePanel`,
    owner-only, `contracts`-gated.
12. Add the action kebab to `FranchiseOptions` / `VeteranExtensionCandidates` rows,
    `showActions`-opt-in exactly as `FreeAgentNeedsCard` already does (defaulting off
    so `rosters.astro`'s planner tab is unaffected — the rule
    `tests/front-office-player-actions.test.ts` already pins).
13. Build `CutCandidatesCard`.
14. Live cap recomputation returns to the hub: `TheLeaguePlannerPanel`'s header note
    "no live client-side cap-math recomputation… Front Office has no cut / declare /
    extend actions" **stops being true** and must be rewritten, not left.

**Done.** An owner can file a franchise tag or extension and cut a player from the
hub. The zero-points prerequisite was the first thing fixed (see below); a **fifth**
copy of the extension formula turned up in `extension-salary-calculator.ts` — the one
the candidate cards print from — and now delegates, with a test pinning it against
`salary-calculations` across a table of real contracts. That one mattered most: a
disagreement there would show an owner one price and file another.

Verified in a browser with the writes intercepted: the row reads `$5,569,156 × 5`,
the confirm reads `$5.57M × 5`, and the filed body carries `requestedSalary 5569156`,
`requestedYears 5`, `requestedContractInfo "E"`. Cancel restores without filing. The
cut posts `{playerId, year}` and treats a 409 as done.

**The points prerequisite, resolved.** All 393 players read `points: 0`, because
`src/data/mfl-player-salaries-<year>.json` is cron-written and reads zero for every
row between the February rollover and the first scored week. The fallback patches the
SOURCE rows (the cards read `allPlayers`, the cap chart reads `seasonData.teams` —
patching one would have them disagreeing on one page) and applies only when the WHOLE
league reads zero, because one player with no points is a fact about that player.
297 of 393 now carry points and all 16 efficiency charts render.

### Phase E — cap planning — **SHIPPED 2026-09-17**
15. Delete `TeamCapAnalysis`, `BudgetPlannerPanel`, `FranchiseTagPanel`.
16. Build `cap-projection.ts` (pure) + `CapProjectionTable.astro` — 3 seasons side by
    side, static first, no toggles. Shippable on its own and already a real upgrade on
    the single-year metric strip.
17. Wire the what-if toggles: extend / tag / cut mutate the scenario and
    re-render the projection. Reuses Phase D's eligibility, which is why it comes
    after it.
18. `ScenarioBar` — save, name, load, compare two, reset. localStorage, scoped.
19. Comp-pick projection: **blocked**, see above.

**Done**, except the comp-pick item, which stays blocked. The three orphaned panels
are deleted. `cap-projection.ts` is pure and declares no cap arithmetic of its own;
`CapProjectionTable` shows three seasons and re-projects live; `ScenarioBar` saves,
names, loads, compares and clears, through `scopedLocalKey`.

**A fourth toggle was built and removed.** "Walk" dropped a player from every season
at zero cost — a move no mechanism in this league offers, since a cut leaves dead
money and a trade is the only other way out. It invited planning against cap space
that cannot exist. The thing it was reaching for, a contract lapsing, is not a move at
all: `calculateCapCharges` counts a player in season `index` only while
`contractYears > index`, so a player with one year left already drops off the 2027
column with nothing ticked. Guarded, so it cannot come back.

Driven in a browser: ticking a cut, then an extend, then a tag on the same player
leaves **two** moves lit, not three — one move per player, the last replacing rather
than compounding. Save produces a chip, reset returns the numbers to baseline with
nothing lit, load restores both. **No write endpoint is touched by any toggle**, which
`tests/cap-scenario-boundary.test.ts` now pins as a scan: a `fetch` in either
component fails the build, and the only literal URL allowed in the action component
is `/api/cut-player`.

Filing dispatches `fo:action-filed`, which drops that player from the scenario — so
the projection cannot count the same move twice, once as scratch and once as the
pending declaration it just became.

## Hazards (each one is a rule that has already bitten this repo)

- **`front-office/index.astro` must stay off the fork ratchet.** Neither wrapper is in
  `tests/fixtures/page-fork-baseline.json` today, i.e. both are ≤80 lines. Growing one
  past that fails `tests/page-fork-ratchet.test.ts`. All logic goes in the shared panel.
- **Cookie writes belong to the route.** The AFL's new team switcher needs
  `setAflPreference(Astro.cookies, …)` in `afl-fantasy/front-office/index.astro`
  frontmatter, never in `FrontOfficeTeamSwitcher.astro` — a component writing
  `Astro.cookies` throws after headers commit and blanks the page.
- **ClientRouter lifecycle.** One shared panel means one script, but a cross-league
  navigation is a same-origin swap, so the init must re-read the league from a node
  the swap *replaced* (`data-league={league.slug}` on the panel root), never capture it
  at module load. `tests/cross-league-init-gate.test.ts` — add the hub to its pair list.
- **`rosters.astro` parity.** Phase C touches the 12k-line page. Run
  `node scripts/roster-parity-check.mjs` **before and after**, per CLAUDE.md.
- **Type baseline.** Deleting two panels and adding six files will move the
  `astro check` count in both directions. Re-measure with `/ratchet`, never hand-edit
  `tests/fixtures/typecheck-baseline.json`.
- **`/api/cut-player` is an owner-cookie write against MFL.** It cannot run for a
  browsed team. The Cut card renders only when the selected team is the viewer's own —
  the same `isOwner` gate as the extension cards, not a separate check.
- **A toggle must never call an API.** The whole value of "simulate freely" is that
  scratch is scratch. Guard-tested (below), because this is the most plausible way the
  feature ships broken.
- **Scenario keys are league-scoped or they are wrong.** Both leagues have a franchise
  0001. Go through `rankings-scope.ts`, and re-read the scope per call rather than
  capturing it at module load — under the ClientRouter one module instance survives a
  navigation from one league's hub to the other's.
- **Reveal-on-hover is not enough.** The trade-chain reveal on a draft chip must work
  on touch and for a screen reader — `aria-expanded` + `aria-describedby`, not `title`.
  **Note from Phase A:** the hub's own data cannot supply a multi-hop chain today.
  `extractAssetsFromTransactions` walks trades into an `ownershipMap` it OVERWRITES at
  each hop, so only the original and current owners survive; `tradeHistory` is never
  populated on this path. `via` carries everything known, and the reveal is wired but
  latent until that util retains its history — a small, separate change with its own
  callers and its own test.
- **Do not pre-render a heavy per-player component once per team.** The hub's switcher
  tempts you to: FA needs and draft chips are pre-rendered for all 16 and that is
  correct, because they are small. A `PlayerCell` is ~2 KB rendered. Measure before
  adding a section to the per-team loop.
- **Sibling drift.** Run the `sibling-drift-checker` agent before `/live`: this work
  touches both leagues' rosters pages and both hub routes.
- **Which clock.** The hub is roster-management-shaped throughout —
  `getCurrentLeagueYear()`, never `getCurrentSeasonYear()`. Verify with `/rollover-check`.

## Guards to add

1. `tests/front-office-panel-unified.test.ts` — one panel component, both routes mount
   it, neither league-specific panel file exists.
2. Extend `tests/front-office-player-actions.test.ts` — the extension/tag kebab is
   `showActions`-gated and off by default; the action bar renders only for the owner's
   own team.
3. `tests/contract-actions-single-driver.test.ts` — no file outside
   `contract-actions-client.ts` posts to `/api/contracts/declare`. This is the exact
   "never inline a second copy" shape `owner-boundary-parity.test.ts` uses, and it is
   what stops the driver forking a fourth time.
4. Add `/front-office` to `tests/cross-league-init-gate.test.ts`'s pair list.
5. `tests/cap-scenario-boundary.test.ts` — no scenario-toggle handler reaches `fetch`,
   and `cap-projection.ts` declares no cap formula of its own (every rate and threshold
   is imported from `salary-calculations.ts`). This is the `owner-boundary-parity`
   shape again, applied to cap math.
6. `tests/cap-projection.test.ts` — unit-test the pure module against known rosters,
   including a scenario that extends, cuts and tags the same team in one pass.

Write each with `/guard-test` so the path-guard map entry comes along.

## Chrome and copy, folded in

- `src/data/page-directory.json` — the `front-office` entry gains tags for the new
  capability: extensions, franchise tag, cut player, dead money, roster analytics,
  age curve, cap allocation.
- `src/config/footer-config.ts` — the AFL's My Team column still has **no Front Office
  link** (left open by the Phase 2 follow-up). Add it here.
- `src/data/weekly-changelog-staging.json` — one line per phase that ships user-visible
  change, `league` tagged. Phase D is a `new-feature`, so **ask Brandon about
  `heroWorthy`** rather than deciding it.
- A `/guides` page is likely warranted for "run your front office" once Phase D lands —
  the capability will not fit in a 200-character bullet.

## Explicitly not in scope

- Lineups, waivers/bids and trade submission from the hub. Trade Builder stays its own
  Front Office page.
- Retiring `rosters.astro`'s `?view=planner` and analytics tabs. Brandon's "we will
  remove the planner pages eventually" still holds, but the deletion is its own change
  after the hub has carried the traffic for a while.
- A roster table on the hub.
- Comp-pick projection, until the rule exists (see above).
- Syncing saved scenarios to Redis. localStorage first; cross-device is a follow-up.
