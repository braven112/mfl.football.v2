---
slug: rankings-composite-ghost-weight
status: open
severity: P2
opened: 2026-09-02
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/699
hotfix_sha: 48396e8
followup_issue: 701
followup_pr:
followup_session:
---

# Follow-up: Import Rankings weights summed to 75, not 100

## What broke

On Import Rankings, the composite header read **"Composite of 4 ranking
sources"** while only three rows were ticked, and those three read `25 / 25 /
25` — a total of 75.

Two readers of the composite config disagreed, and only one filtered:

- `getCompositeConfig()` — the **math** path — filters members against the
  current imports (`src/utils/rankings-storage.ts:541`). **My Rank itself was
  always computed correctly**, as a clean even split of the surviving sources.
  This was never a wrong draft board.
- `getCompositeMembers()` — the **display** path — returned the raw stored list
  unfiltered, so a member whose import no longer existed stayed on the books
  invisibly.

Every symptom followed from that one asymmetry. The header counted a source it
never rendered; the visible weights summed to 75; and the `weight/Σweight` hint
written to catch exactly this stayed hidden — because the ghost's 25 padded
`totalWeight` back to exactly 100, so `Math.abs(share - weight) < 0.5` passed
and the UI concluded there was nothing to warn about.

Past the cosmetics: `setCompositeWeight` rebalanced across the ghost too, so a
weight the owner typed was silently diluted and never became the share they
asked for.

## What the hotfix did

Forward fix, one source file (`src/utils/rankings-storage.ts`) plus its tests.

`getCompositeMembers()` now filters stale ids exactly as `getCompositeConfig()`
does, then rebalances the survivors to 100 and persists that. Filtering on read
alone would have left the stored weights summing to 75, so the next
`setCompositeWeight` would rebalance around the ghost again and keep diluting
the typed number.

Two guards came out of review, both covering failure modes the heal itself
introduced (the previous read-only filter had neither):

- **A total miss is not "everything was deleted."** The imports and the
  composite config live under different localStorage keys, so one can be intact
  while the other is empty — `getAllImports()` returns `[]` when
  `readFromStorage` swallows a parse failure, and `initFromServer` probes
  `getCompositeMembers()` at `:907` *before* the server's imports reach
  localStorage. Healing there would persist `{members: []}` and destroy every
  tick and weight permanently. Nothing surviving now means filter nothing,
  write nothing.
- **The persist is best-effort.** `localStorage.setItem` throws on a full quota
  and where storage is blocked; letting that reach the outer catch returned
  `[]`, which renders every source unticked *and* makes `initFromServer`'s
  `getCompositeMembers().length === 0` guard overwrite an intact local config
  with the server's. The write has its own catch now.

Five guard tests shipped with the fix — so there is no "F1, the missing guard
test" item here. Each of the four behavioral ones fails against the unguarded
version; the fifth pins that a deliberate `70/30` split is left untouched.

## Deferred items

- [ ] **F1 — The producers of stale members are still in place**
  - Source: identified while diagnosing, deferred at implementation
  - Where: `src/utils/rankings-storage.ts:311` (the supersede path filters a
    superseded member out without calling `rebalanceToHundred`, so it leaves a
    sub-100 total); `src/utils/rankings-storage.ts:907` (`initFromServer`
    writes the server's `compositeConfig` before the local import list is
    reconciled, so members can reference imports not present yet); and a source
    dropping out of `data/ranking-sources/<year>.json` after a failed fetch in
    `scripts/fetch-ranking-sources.mjs` removes its `builtin:` import with
    nothing pruning its membership
  - Why deferred: the hotfix heals the symptom on read, which fixes every
    existing owner's board on next load. Stopping new ghosts at each source is a
    wider diff across three call paths and wants its own tests
  - Note: the read-time heal is a genuine safety net, so this is hardening
    rather than a second bug — but as long as producers exist, every new ghost
    costs an owner a confusing render before the next read cleans it up

- [ ] **F2 — The stale-id filter is now duplicated**
  - Source: cross-cutting lens, hotfix step 5
  - Where: `src/utils/rankings-storage.ts:541` (`getCompositeConfig`) and
    `src/utils/rankings-storage.ts:559`+ (`getCompositeMembers`)
  - Why deferred: DRY, explicitly in the hotfix deferral bucket. But this is the
    exact duplication that caused the bug — the two copies drifted once already,
    and a single `validMembers(members)` helper is what stops copy three
  - Note: worth doing *because* of the incident, not despite it

- [ ] **F3 — The heal is a side effect inside a getter**
  - Source: design observation, hotfix step 5
  - Where: `src/utils/rankings-storage.ts:559`+, called from
    `src/components/shared/rankings/MyRankEditor.tsx:59` and
    `src/components/theleague/rankings-import/ManageImportsSection.tsx:64`
  - Why deferred: it works and is idempotent, and reshaping it mid-hotfix was a
    bigger diff than the bug warranted
  - Note: the cleaner shape is reconciling once at mount alongside
    `syncBuiltinImports`, leaving `getCompositeMembers()` a pure read. The write
    was deliberately routed around `saveCompositeConfig` for this reason — that
    helper fires `rankingsUpdated` and pushes to the server, which must not
    happen from a render path

- [ ] **F4 — External reviewer findings landed after the merge**
  - Source: Gemini / Copilot / CodeQL on PR #699
  - Where: the PR comment thread
  - Why deferred: `/hotfix` does not wait on the advisory reviewers. CodeQL
    (`Analyze`) was running at merge time but was not a blocker here — the diff
    is client-side localStorage, touching no auth, no server route, and no
    user-supplied URL
  - Note: re-read the PR comments before starting; fold anything real into this
    list

## Context to start cold

**The composite math was never wrong.** Worth holding onto, because the
instinct on reading "rankings don't add up" is to go looking at the ranking
computation. `getCompositeConfig()` filtered from the start, so every owner's
My Rank order was a correct even split of their surviving sources the whole
time. This was a display and weight-control bug, which is why it was triaged P2
and not P0.

**How the ghost hides from the warning that exists for it.**
`effectiveShareFor` in `ManageImportsSection.tsx:166` was written precisely to
surface `weight/Σweight` when it diverges from the typed number. It computes
`totalWeight` over the *raw* member list, so the ghost's own weight pads the
denominator to exactly 100 and makes the typed 25 match the computed 25 — the
warning suppresses itself in exactly the case it was built for. If a similar
"show the effective value when it differs" hint is added elsewhere, check what
its denominator is summed over.

**Built-in ids are stable and were ruled out as a producer.**
`syncBuiltinImports` mints `builtin:${src.id}` (`rankings-storage.ts:260`),
keyed on source+type, specifically so composite membership survives the daily
refresh. So the daily cron is *not* orphaning members — that theory was checked
and discarded. The remaining producers are the three named in F1.

**The two consumers are shared, so there is no sibling-page fork to chase.**
`getCompositeMembers()` is read by `shared/rankings/MyRankEditor.tsx` (used by
both leagues' `players.astro` and `rosters.astro`) and by
`ManageImportsSection.tsx`, reached through the shared
`shared/rankings-import/ImportRankingsPage.astro`. TheLeague and the AFL were
both fixed by construction. Do not go looking for an `afl-fantasy/` copy of
`ManageImportsSection` — there isn't one.

**Verification limits.** The Vercel preview served
`/theleague/import-rankings` at 200, but the Saved Rankings table is a
client-only React island rendered from localStorage, so neither the preview nor
production can be checked by fetching HTML. The unit tests are the real proof:
`tests/rankings-storage.test.ts` seeds the exact screenshot state (three valid
members at 25 plus one stale at 25) and asserts the survivors total 100.
Confirming this on a real board means opening Import Rankings in a browser with
a stale member in localStorage.
