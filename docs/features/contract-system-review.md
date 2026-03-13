# Story: Contract System Review & Test League Support

## User Story
As a commissioner, I want to test contract extensions and franchise tags against a duplicate MFL league (36189) so that I can validate the full write flow without affecting the production league (13522).

## Acceptance Criteria
- [ ] Test league ID 36189 is added to `ALLOWED_LEAGUES` in contract-validation.ts
- [ ] MFL contract writer can target league 36189 via environment variable (`MFL_LEAGUE_ID=36189`)
- [ ] Contract extension flow works end-to-end: owner submits → commish queue → approve → MFL write verified at https://www49.myfantasyleague.com/2026/options?L=36189&O=07
- [ ] Franchise tag flow works end-to-end: same path as above
- [ ] Commissioner approval actually writes correct salary, contractYear, and contractInfo to MFL
- [ ] All 6 declaration types are reviewed for correctness: new-acquisition, rookie-override, team-option, franchise-tag, veteran-extension, rookie-extension
- [ ] pnpm test passes
- [ ] pnpm build succeeds

## Technical Context

### Files to Modify
- `src/utils/contract-validation.ts` line 132 — Add `'36189'` to `ALLOWED_LEAGUES` array
- No other code changes needed for basic test league support (writer already reads `MFL_LEAGUE_ID` env var)

### System Architecture (Review)

**Declaration Types & Rules:**

| Type | Eligibility | Years Change | Salary Change | contractInfo |
|------|------------|-------------|---------------|--------------|
| `new-acquisition` | BBID/auction pickup | Owner picks 2-5yr | Set at acquisition | — |
| `rookie-override` | RC players | Reduce from 4yr to 1-3yr | No change | Keeps `RC` |
| `team-option` | TO contracts, 2+ yrs left | Exercises 5th year option | No change | `TO` |
| `franchise-tag` | 1yr remaining, not already tagged | Sets to 1yr | MAX(salary×1.20, top3avg) | `F` |
| `veteran-extension` | 2+ yrs remaining, NOT RC | +2 years | (top5avg×2)÷(currentYrs+2)+salary | Clears info |
| `rookie-extension` | RC designation | +2 years | (top5avg×2)÷(currentYrs+2)+salary | Clears `RC` |

**Flow:**
```
Owner (rosters page CDM) → POST /api/contracts/declare
  → validates eligibility, window, one-per-team rules
  → stores in data/theleague/contract-declarations.json (status: pending)

Commissioner (manage page) → GET /api/contracts/pending
  → sees pending cards with player + salary context

Commissioner → POST /api/contracts/approve
  → writeContractToMFL() → POST /{year}/import?TYPE=salaries&L={leagueId}&APPEND=1
  → XML payload with playerId, salary, contractYear, contractInfo
  → backup created first in data/theleague/contract-backups/
  → declaration status → 'applied' (success) or 'approved' (MFL write failed)

Commissioner → POST /api/contracts/reject
  → declaration status → 'rejected', optional reason
```

**MFL Write Details:**
- Host: `MFL_HOST` env var (default: `https://api.myfantasyleague.com`)
- League: `MFL_LEAGUE_ID` env var (default: `13522`)
- Auth: `MFL_COMMISSIONER_COOKIE` env var (commissioner's MFL_USER_ID cookie)
- Payload: URL-encoded `DATA=<salaries>...</salaries>` XML
- Safety: `APPEND=1` flag prevents overwriting all salary data
- Retry: exponential backoff (1s, 3s, 9s), 3 attempts

### Key Files

| Category | File | Purpose |
|----------|------|---------|
| **Types** | `src/types/contracts.ts` | ContractDeclaration, DeclarationStatus |
| **Types** | `src/types/contract-eligibility.ts` | DeclarationType, EligibilityResult |
| **Eligibility** | `src/utils/contract-eligibility.ts` | Who can declare what |
| **Validation** | `src/utils/contract-validation.ts` | Window checks, league ID validation |
| **Storage** | `src/utils/contract-storage.ts` | JSON CRUD for declarations |
| **Writer** | `src/utils/mfl-contract-writer.ts` | MFL API writes with backup/retry |
| **Extension calc** | `src/utils/extension-salary-calculator.ts` | 2yr extension formula |
| **Tag calc** | `src/utils/franchise-tag-predictor.ts` | Tag salary formula |
| **API: declare** | `src/pages/api/contracts/declare.ts` | Owner submits declaration |
| **API: pending** | `src/pages/api/contracts/pending.ts` | List pending for commish |
| **API: approve** | `src/pages/api/contracts/approve.ts` | Commish approves + MFL write |
| **API: reject** | `src/pages/api/contracts/reject.ts` | Commish rejects |
| **UI: owner** | `src/pages/theleague/rosters.astro` | CDM modal (~line 8208) |
| **UI: commish** | `src/pages/theleague/contracts/manage.astro` | Commish approval dashboard |
| **UI: tags** | `src/pages/theleague/contracts/franchise-tags.astro` | Tag listing page |

### Data Sources
- MFL salaries: `/{year}/export?TYPE=salaries&L={leagueId}&JSON=1`
- MFL rosters: cached in `data/theleague/mfl-feeds/{year}/rosters.json`
- Declarations: `data/theleague/contract-declarations.json`
- Year utility: `getCurrentLeagueYear()` (roster/contract context)

## Agent Sequence

### Phase 3: QA (Primary focus for this story)
- **qa-investigator** — Trace all 6 declaration type code paths end-to-end
- **qa-api-debugger** — Test MFL write to league 36189, verify at salary page

### Phase 4: Review (Light review since this is mostly existing code)
- **code-reviewer** — Check validation, salary calculations, edge cases

## Prompt Context Per Agent

### qa-investigator (Phase 3)
- Trace: CDM submit button → `/api/contracts/declare` → contract-eligibility.ts → contract-storage.ts → pending status
- Trace: Manage page approve → `/api/contracts/approve` → mfl-contract-writer.ts → MFL API → status update
- Key files: All files in "Key Files" table above
- Verify: One-per-team validation, window validation, salary calculation correctness

### qa-api-debugger (Phase 3)
- Test MFL write endpoint: `POST /2026/import?TYPE=salaries&L=36189&APPEND=1`
- Verify result at: https://www49.myfantasyleague.com/2026/options?L=36189&O=07
- Test MFL read: `GET /2026/export?TYPE=salaries&L=36189&JSON=1`
- Auth: Use `MFL_COMMISSIONER_COOKIE` env var

## Done Definition
- [ ] League 36189 accepted by validation
- [ ] QA confirms all code paths are complete (no TODOs, no broken chains)
- [ ] MFL write verified on test league salary page
- [ ] pnpm test passes
- [ ] pnpm build succeeds
