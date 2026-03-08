## 2026-03-08 - Team Options Follow Contract State, Not The Generic Submission Window

**Context:** The roster page and declaration API both need to support first-round team option planning without blocking owners until a narrow offseason-only window.

**Insight:** In this repo's contract model, a first-round team option is available while a TO player is still **before Year 4**, which maps to `currentYears >= 2` on the contract. That decision should remain visible year-round. Treating it like a normal offseason declaration (`window.inWindow`) hides valid planning states and conflicts with the existing roster UI, which already surfaces the TO action menu from contract state.

**Evidence:** `src/pages/theleague/rosters.astro` already marks the option window with `contractYears >= 2`, and the updated `src/utils/contract-eligibility.ts` plus `src/utils/contract-validation.ts` now follow the same rule so both UI eligibility and submission checks stay aligned.

**Recommendation:** Keep TO-specific rules separate from the general declaration window. If future contract actions depend on contract phase rather than calendar phase, model them off `currentYears`/`contractInfo` directly and only use `getContractWindow()` for actions that are truly calendar-bound.
