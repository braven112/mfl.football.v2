## 2026-03-08 - Team Options Follow Contract State, Not The Generic Submission Window

**Context:** The roster page and declaration API both need to support first-round team option planning without blocking owners until a narrow offseason-only window.

**Insight:** In this repo's contract model, a first-round team option is available while a TO player is still **before Year 4**, which maps to `currentYears >= 2` on the contract. That decision should remain visible year-round. Treating it like a normal offseason declaration (`window.inWindow`) hides valid planning states and conflicts with the existing roster UI, which already surfaces the TO action menu from contract state.

**Evidence:** `src/pages/theleague/rosters.astro` already marks the option window with `contractYears >= 2`, and the updated `src/utils/contract-eligibility.ts` plus `src/utils/contract-validation.ts` now follow the same rule so both UI eligibility and submission checks stay aligned.

**Recommendation:** Keep TO-specific rules separate from the general declaration window. If future contract actions depend on contract phase rather than calendar phase, model them off `currentYears`/`contractInfo` directly and only use `getContractWindow()` for actions that are truly calendar-bound.

## 2026-07-09 - Reusing ContractDeclarationModal Off the Roster Page: Clone the Narrow Flow, Don't Extract the Whole Thing

**Context:** Adding a "Set years" action to the homepage's Unsigned FA Adds
card, so owners can declare a new-acquisition player's contract length without
navigating to `/theleague/rosters`.

**Insight:** `ContractDeclarationModal.astro` is just a static shell (IDs,
empty containers) — all of its behavior lives in a single ~1,400-line inline
`<script>` in `rosters.astro` (`openDeclarationModal` and friends), which also
drives franchise-tag, veteran-extension, team-option, and cut flows via a
`cdmFlowType`/`cdmSubmitType` state machine. Extracting that whole thing into
a shared module was not worth the risk for this feature: the homepage only
ever needs the `new-acquisition` year-select branch (`resolveUnsignedFaAlerts`
guarantees `currentYears === 1` and `!contractInfo` for everything it
returns), so the other flows are dead weight and a refactor of that scale
risks regressing the roster page's actual money-moving actions. Instead,
`HpUnsignedFaCard.astro` imports the same `<ContractDeclarationModal />`
component (safe — it's just markup/CSS) and ships its own much smaller
client script that only implements the year-select branch, posting to the
same `/api/contracts/declare` endpoint. Zero changes to `rosters.astro`.

**Evidence:** `src/components/theleague/hp-sections/HpUnsignedFaCard.astro`
(`initHpUnsignedFaModal`) vs. `src/pages/theleague/rosters.astro` lines
~8068-9993 (`openDeclarationModal`/`submitDeclaration`). Both drive the same
DOM IDs (`cdm-year-options`, `cdm-submit`, etc.) but only one page's script
runs at a time since the modal is rendered per-page.

**Recommendation:** If a future page needs a *different* subset of CDM flows
(e.g. franchise-tag from a standings page), don't reach for the rosters.astro
script either — write another narrow, purpose-built client script against the
same shared markup/API. Only extract the shared state machine into a real
module if three-plus pages need the *same* multi-flow behavior; until then,
narrow clones are lower risk than a shared abstraction spanning a script that
size.
