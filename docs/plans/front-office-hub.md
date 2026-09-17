# Front Office hub — Phase 3: one page, both leagues, real actions

**Status:** planned (2026-09-17)
**Supersedes the "eventual cutover" note in** `src/components/shared/front-office-nav/front-office-pages.ts`
**Predecessors:** Front Office Phase 1 (link grid), Phase 2 (hub became the planner —
`docs/claude/followups/2026-09-16-league-planner-two-destinations.md`)

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
    ├── ContractActionsSection           owner-only  [contracts]
    │   ├── FranchiseOptions             existing card + action kebab
    │   ├── VeteranExtensionCandidates   existing card + action kebab
    │   ├── CutCandidatesCard            NEW  [salaryCap]
    │   └── ContractActionsBar           NEW — staged actions + Submit + Clear All
    ├── KeeperPlanner                    owner-only  [keepers]   (AFL, unchanged)
    ├── FreeAgentNeedsCard               [contracts]
    ├── DraftPicksCard / DraftTeamAssetsView
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
| `src/components/shared/front-office-hub/FrontOfficePanel.astro` | **New** — replaces `TheLeaguePlannerPanel` + `AflKeeperPlannerPanel`. |
| `src/utils/front-office-panel-data.ts` | **New** — merges `front-office-planner-data.ts` + `front-office-keeper-data.ts` behind one `buildFrontOfficePanelData(slug, franchiseId)`. |
| `src/pages/{theleague,afl-fantasy}/front-office/index.astro` | Thin wrappers only — auth gate, cookie write, data import, one component. **Must stay under 80 lines** (see Hazards). |
| `src/pages/theleague/rosters.astro` | Mounts the extracted driver instead of its inline copy. Analytics + planner tabs stay for now. |
| `src/components/theleague/hp-sections/HpUnsignedFaCard.astro` | Drops its hand-copy of the driver. |

## Phases

Each phase is independently shippable and leaves the tree green.

### Phase A — shared analytics (no behavior change to actions)
1. Generalize `afl-roster-analytics.ts` → `roster-analytics.ts`; add the cap builders.
2. Build `RosterAnalyticsPanel.astro` + `NflCollegeStacks.astro`.
3. Mount in **both** hub panels (still two panels at this point).
4. TheLeague's hub gains analytics — the headline ask, delivered first.

**Done when:** both hubs render the same analytics component, cap charts present only
on TheLeague, and `pnpm vitest run tests/afl-keeper-planner-features.test.ts` passes.

### Phase B — one panel
5. Fold both panels into `FrontOfficePanel.astro`, sections gated on feature flags.
6. Merge the two data builders into `front-office-panel-data.ts`.
7. Give the AFL a team switcher; `isOwner` becomes
   `selectedTeamId === viewer's own franchise`, not `signedIn`.

**Done when:** `AflKeeperPlannerPanel.astro` and `TheLeaguePlannerPanel.astro` are
deleted, both route wrappers are under 80 lines, and an AFL owner can browse another
team's hub read-only.

### Phase C — extract the contract driver
8. Lift the CDM driver out of `rosters.astro` into `contract-actions-client.ts`.
9. Re-point `rosters.astro` and `HpUnsignedFaCard` at it. **No behavior change here** —
   this phase is a pure move, proved by `scripts/roster-parity-check.mjs`.

**Done when:** parity check output is byte-identical before and after, and the three
hosts share one driver.

### Phase D — actions on the hub
10. Mount `ContractDeclarationModal` + `ContractActionsBar` in `FrontOfficePanel`,
    owner-only, `contracts`-gated.
11. Add the action kebab to `FranchiseOptions` / `VeteranExtensionCandidates` rows,
    `showActions`-opt-in exactly as `FreeAgentNeedsCard` already does (defaulting off
    so `rosters.astro`'s planner tab is unaffected — the rule
    `tests/front-office-player-actions.test.ts` already pins).
12. Build `CutCandidatesCard`.
13. Live cap recomputation returns to the hub: `TheLeaguePlannerPanel`'s header note
    "no live client-side cap-math recomputation… Front Office has no cut / declare /
    extend actions" **stops being true** and must be rewritten, not left.

**Done when:** an owner can tag, extend and cut from `/front-office` and see the
declaration land on `/front-office/contracts`.

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
