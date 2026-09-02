---
slug: rankings-composite-ghost-weight
status: open
severity: P2
opened: 2026-09-02
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/699
hotfix_sha: 48396e8
followup_issue: 701
followup_pr:
followup_session: session_01WQNPQJB55Bfb1WL1aRL6Be
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
  - Why deferred: DRY, explicitly in the hotfix deferral bucket
  - **Promoted by production verification (step 7): this is the actual fix, not
    housekeeping.** There are FOUR raw readers of the composite config —
    `getCompositeConfig` (`:541`), `getCompositeMembers` (`:559`),
    `setCompositeWeight` (`:676`) and `syncBuiltinImports` (`:350`) — and only
    the first two filter stale members. `syncBuiltinImports` re-reads the raw
    config and writes back `rebalanceToHundred(config.members)` without
    filtering, so on a load where it has fresh sources to seed it UNDOES the
    heal's write: the prod run finished with `ghost-deleted-import=25` back in
    localStorage. The display stays correct either way (the filter is on read),
    but `setCompositeWeight` reads raw storage too, so on that path a typed
    weight can still be diluted across the ghost. A single
    `validMembers(members)` helper applied at every read closes this properly.
  - Note: on a steady-state device `syncBuiltinImports` early-returns via its
    `upToDate` check and the heal persists fine, which is why this is narrower
    than the original bug and did not block the hotfix

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

- [ ] **F5 — Newly seeded built-in sources join the composite at weight 0**
  - Source: production verification, hotfix step 7
  - Where: `src/utils/rankings-storage.ts:344-356`
  - What: seeding pushes `{importId, weight: 0}` and then calls
    `rebalanceToHundred(config.members)` with **no** `pinnedId`. With no pin,
    `remaining` is 100 and `othersTotal` is the existing members' total, so the
    existing members scale to themselves and the newly seeded sources stay at 0
    — ticked in the UI, contributing nothing to My Rank.
  - Evidence: the prod run rendered `Composite of 6 ranking sources` with
    weights `33.4 / 33.3 / 33.3 / 0 / 0 / 0`.
  - Why deferred: pre-existing, untouched by the hotfix diff, and not a
    regression from it
  - Note: `toggleCompositeImport` (`:647`) already guards this exact case — "a
    source just ticked ON gets an even share (100/n) ... rebalancing it as a
    plain zero-weight member would leave it at 0%, nominally in the composite,
    actually ignored" — and the seeding path never got the same treatment. Only
    bites when built-ins are seeded onto a store that already has weighted
    members.

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

**How production was verified, and how to redo it.** The Saved Rankings table
is a client-only React island rendered from localStorage, so fetching HTML
proves nothing — the page returns 200 either way. It was verified instead by
driving Chromium at `https://theleague.us/import-rankings` with localStorage
seeded to the reported state (three real imports ticked at 25 plus one stale
member at 25), then reading `.ri-manage__weight-input` values out of the DOM.
Result: `33.4 / 33.3 / 33.3`, summing to 100, where the pre-fix render was
`25 / 25 / 25` summing to 75.

One sandbox detail that makes this reproducible: **Chromium here cannot reach
any external host** — outbound HTTPS goes through an egress relay its TLS does
not survive. The run worked by intercepting every request with
`ctx.route('**/*')` and re-issuing it through `route.fetch()`, which runs on
Playwright's own request context and reads `HTTPS_PROXY`. Same technique as
commit `dab9ef4`. Also pin `executablePath: '/opt/pw-browsers/chromium'` — the
bundled Playwright expects a headless-shell build that is not installed.

Both F2's promotion and F5 came out of that run rather than the unit tests,
because both only appear once `syncBuiltinImports` reconciles against a real
build snapshot.
