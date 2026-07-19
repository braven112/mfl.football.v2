# August Roster Cuts Automation

Owner-facing cut planning + deadline execution for TheLeague's August
roster cutdown (22 active by the 3rd Sunday of August, 8:45 PM PT).
Built July 2026 on branch `claude/august-roster-cuts-automation-dgvb7r`.
Plan: `docs/features/august-roster-cuts-automation-plan.md`.

## 2026-07-19 - Architecture Map

**Context:** Orientation for future sessions touching any part of the flow.

**Insight:** The feature is one shared selection brain with four consumers:

- **Selection core (shared .ts/.mjs pair):**
  `src/utils/august-cut-selection-core.mjs` is the single implementation
  (plain JS, same pattern as `leagues-data.mjs`); `src/utils/august-cut-selection.ts`
  wraps it with types + canonical constants. App code imports the `.ts`,
  node scripts import the `.mjs` directly — the owner-facing preview and
  the deadline job literally cannot drift. Constants MUST mirror their
  canonical homes: `AUGUST_CUT_TARGET === TARGET_ACTIVE_COUNT`
  (salary-calculations.ts), `AUGUST_CUT_ACQUISITION_TYPES === ACQUISITION_TYPES`
  (contract-eligibility.ts). `tests/august-cutdown-date.test.ts` locks both.
  Selection rules: only `status === 'ROSTER'` counts (taxi/IR excluded);
  marked players first in the owner's order; remaining overage filled
  newest-acquisition-first ("last added"); **trades never count as
  acquisitions** (league decision #9 — a traded-for player is long-held;
  only BBID_WAIVER / FREE_AGENT / AUCTION_WON qualify); never cut below
  target.
- **Credential envelope:** `src/utils/autocut-storage.ts` encrypts the
  owner's MFL cookie as AES-256-GCM. Key comes from the dedicated env
  secret `AUTOCUT_CRED_KEY` (deliberately NOT `JWT_SECRET`), derived via
  `scryptSync(AUTOCUT_CRED_KEY, 'autocut:cred:v1', 32)` — the salt string
  `'autocut:cred:v1'` is duplicated in `scripts/lib/august-cutdown.mjs`
  (the script-side decryptor) and the two MUST stay identical or every
  stored credential silently becomes undecryptable. Missing key/Redis →
  every credential function no-ops gracefully (panel renders unsaved state).
- **Redis key map:**
  - `autocut:{franchiseId}` — AutocutList `{ year, playerIds, updatedAt }`
  - `autocut:cred:{franchiseId}` — encrypted credential envelope
  - `autocut:snapshot:{year}` — audit snapshot, frozen BEFORE any MFL write
  - `autocut:done:{year}` — hash fid → `'done' | 'failed:<n>'` (resumability,
    MAX_ATTEMPTS gate)
  - `autocut:paused:{year}` — kill switch; any value halts every mode
  - `autocut:touches:{year}` — hash touchKey → PT date (auto-mode reminder
    dedupe)
- **Consumers:** `src/pages/theleague/rosters.astro` (Cutdown Plan panel UI,
  SSR shell in `src/components/theleague/CutdownPlanPanel.astro`),
  `src/pages/api/autocut-list.ts` (save + credential capture),
  `scripts/apply-august-cuts.mjs` (deadline execution via
  `.github/workflows/apply-august-cuts.yml`, cron `*/15 * * 8 *` — August
  only, in-script gates do the real work), commissioner surface at
  `src/pages/theleague/admin/cutdown-report.astro` +
  `src/pages/api/admin/autocut-control.ts` (pause/resume/mark-done).

**Evidence:** File headers of each listed file; `tests/august-cut-selection.test.ts`,
`tests/apply-august-cuts.test.ts`, `tests/autocut-storage.test.ts`,
`tests/autocut-control.test.ts`.

## 2026-07-19 - Demo-Mode `config.authUser` Override Is a Privacy-Leak Pattern — Gate Real-Identity Features on a Captured REAL_FID

**Context:** QA found the Cutdown Plan panel rendering another franchise's
real marked-cut list while Contract Demo mode was active.

**Insight:** Contract Demo (rosters.astro) *overwrites* `config.authUser`
with `{ franchiseId: currentTeam, ... }` for the demo's duration. Any
feature that derives "is this my team?" from `config.authUser` at
call time therefore spoofs ownership of whatever team is being browsed —
and if the feature renders private data (a pre-deadline cut list), that's
a real leak, not a cosmetic bug. The fix pattern: capture
`AUTOCUT_REAL_FID = config.authUser?.franchiseId` ONCE at init, before
demo can start, and gate every own-team check on the captured value plus
an explicit `!demoActive` term (`isAutocutOwnView()`), never on live
`config.authUser`.

**Recommendation:** Any future rosters.astro feature keyed to the real
logged-in franchise must snapshot the franchise id at init and check
`demoActive` explicitly. Treat `config.authUser` as demo-writable state.

**Evidence:** rosters.astro `AUTOCUT_REAL_FID` block (search for it);
commit b5d10e3 "Fix QA defects: demo-mode privacy leak…".

## 2026-07-19 - Save Race: One postAndCommit Path With a Monotonic Sequence Token

**Context:** Two entry points can save the cut list (Save button and the
CDM mark/unmark toggle); overlapping saves could commit stale state.

**Insight:** All saves funnel through a single `postAndCommit(newIds)`
(rosters.astro). A monotonic counter (`autocutSaveSeq`) stamps each save;
after the POST resolves, the save only commits (state + re-render +
clearing `saving`) if its token is still the newest — a superseded save
returns `{ stale: true }` and touches nothing (the newer in-flight writer
owns the saving flag). Retry paths (step-up re-auth) also route through
`postAndCommit`.

**Recommendation:** Reuse this pattern for any client feature with
multiple writers to the same server state; don't scatter `fetch` +
state-commit pairs across handlers.

**Evidence:** rosters.astro `postAndCommit` / `autocutSaveSeq`
(commit b5d10e3).

## 2026-07-19 - `astro check` OOMs on rosters.astro — Verify With Compiler Transform + esbuild Parse Instead

**Context:** Type-checking the branch: `astro check` runs out of memory
on `src/pages/theleague/rosters.astro` (the file is ~12k lines with a
huge inline script).

**Insight:** Don't fight the OOM. To verify the file still compiles and
its script parses: run `@astrojs/compiler`'s `transform` on the file
(catches template/frontmatter errors), then run esbuild's `parse`/build
on the extracted script (catches JS syntax errors). Both fit in memory
and catch the error classes that matter for a mechanical edit.

**Recommendation:** For edits to rosters.astro, verify via targeted
vitest suites + the compiler-transform/esbuild-parse combo; don't gate on
a full `astro check`.

## 2026-07-19 - TDZ Crash: Initial updateView() Runs Before Later `let` Declarations in the Same Inline Script

**Context:** Ship-prep screenshot capture found the rosters page script
dying for any logged-in owner during the cut window:
`ReferenceError: Cannot access 'demoActive' before initialization`.

**Insight:** Inside `initRosterPage`'s body, the initial `updateView()`
call executes ~14 lines before the Contract Demo section's
`let demoActive = false;`. The initial roster-row render calls
`isAutocutOwnView()` (for the AUTO-CUT badges), which reads `demoActive`
→ temporal dead zone → the WHOLE page script aborts. It never surfaced in
QA because it only triggers when the badge path actually runs: logged-in
owner + own team + active cut window. Fixed by hoisting the `demoActive`
declaration up into the autocut section (before the first possible read).

**Recommendation:** In rosters.astro's mega-script, any new helper that
`updateView()`/`renderTableRows()` can reach must only reference
variables declared ABOVE the initial `updateView()` call. When adding a
cross-section dependency, hoist the declaration, not the section. Test
the "logged-in owner, own team" path in a real browser — curl can't
catch client-side TDZ.

**Evidence:** Fixed 2026-07-19 (declaration now lives next to
`AUTOCUT_REAL_FID` with an explanatory comment; the old site has a
pointer comment).

## 2026-07-19 - Panel Dark Mode: `--color-white` Backgrounds Don't Flip — Use `--content-bg`

**Context:** Dark-mode screenshot showed the Cutdown Plan panel as a
white card on the dark page with near-white text painted on it.

**Insight:** Instance of the documented design-system gotcha: the gray
scale inverts as a unit in `tokens-dark.css` but `--color-white` stays
`#ffffff` in both themes. CutdownPlanPanel.astro used
`background: var(--color-white, #fff)` on six surfaces (panel, slate
rows, reorder chips, ghost buttons, modals, text input) while its text
used flipping gray tokens → unreadable in dark. Fixed by switching all
six to `var(--content-bg, #fff)` (white in light, `#1e1e1e` in dark).
See `domains/design-system.md` (2026-07 entry on `--color-white`) for
the general rule.

**Evidence:** `src/components/theleague/CutdownPlanPanel.astro` (fixed
2026-07-19).

## 2026-07-19 - Badge Honesty: AUTO-CUT vs MARKED Below the Cut Line

**Context:** Roster rows for the owner's team show per-player badges
during the cut window.

**Insight:** The badge text is deliberately honest about what the
deadline will actually do: `AUTO-CUT #N` only for players inside the
computed cut line (they WILL be cut), `MARKED #N` for marked players
below the line (marked, but safe unless the roster goes over again —
marked players are consumed only to reach the cap, never cut for their
own sake). Don't "simplify" both to one label; the distinction is the
owner's only signal that marking more players than the overage is safe
insurance, not extra carnage. Same honesty rule as the panel's collapsed
copy ("Your N marked players are safe unless you go back over").

**Evidence:** rosters.astro badge builder (`'MARKED' : 'AUTO-CUT'`
ternary near the `cdp-slate` render), selection rule #2 in
`august-cut-selection-core.mjs`.

## 2026-07-19 - Deploy Prerequisites (Before August)

**Context:** What must be true in the environments before the deadline
job can run for real.

**Insight / checklist:**

1. **`AUTOCUT_CRED_KEY` GitHub Actions secret** must be set AND match the
   Vercel env var of the same name — the web app encrypts with Vercel's
   copy, the Actions job decrypts with GitHub's. A mismatch is silent
   until execution night (decrypt failure → franchise skipped).
2. **`GROUPME_ROGER_BOT_ID`** must be available to
   `.github/workflows/apply-august-cuts.yml` (it posts owner nags and the
   execution report). Also needs `MFL_APIKEY` and the Upstash/KV pairs.
3. **Cookie-replay canary:** `mfl-integration-test.yml` now runs
   `scripts/check-owner-cookie-replay.mjs` (read-only `myleagues` replay
   of the stored `MFL_USER_ID` secret) on every pipeline run, `if: always()`,
   self-skips when the secret is absent. This is the continuous signal
   that MFL still accepts replayed owner cookies from an Actions runner.
4. **Phase 0 live spike still OUTSTANDING:** nobody has yet replayed a
   real owner cookie for an actual `add_drop`-style WRITE from script
   context. One real-write spike (on a test roster move) must happen
   before August or execution night is the first-ever live test of the
   core assumption.

**Evidence:** `.github/workflows/apply-august-cuts.yml` env block;
`.github/workflows/mfl-integration-test.yml` canary step;
plan doc Phase 0 section.

## 2026-07-19 - Documented Follow-Up: Extract the Autocut Client Module From rosters.astro

**Context:** Performance review of the branch.

**Insight:** The autocut client code is ~1,000 lines inside
rosters.astro's already-huge inline script, shipped to every rosters
visitor even outside the cut window. The performance reviewer's
recommendation: extract it into its own module loaded behind a dynamic
`import()` gated on `config.autocut` being present (i.e., only during
the Jun 1 → deadline window for a logged-in owner). **Deliberately
deferred** — the wiring was QA-validated late in the cycle and the
extraction risks destabilizing it right before the feature's live
window. Do it after the August 2026 deadline passes, not before.
Note the TDZ entry above when extracting: the module boundary actually
*fixes* that class of bug (imports hoist), which is another reason to do
it in the offseason.
