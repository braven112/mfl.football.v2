# Feature: MFL Integration Test Pipeline

## Status: Planned

## Summary
A dedicated GitHub Actions workflow that validates MFL contract write operations against test league 36189. Runs separately from unit tests — its sole job is testing authenticated write capabilities.

## Motivation
The contract system writes salary/contract data to MFL via commissioner API. We recently fixed critical bugs (wrong host, missing cookies, team-option guard). Without an automated integration test, regressions in the write flow are only caught manually. This pipeline ensures every code change that touches the contract system is validated against a real MFL league before it can break production.

## What Gets Created

### 1. Test script: `tests/mfl-write-integration.test.ts`

A standalone Node script (following the `e2e-cookie-test.mjs` pattern) that makes real MFL API calls against league 36189.

**Test flow (write → verify → revert):**
1. Read current salary data for a known player from league 36189
2. Modify `contractYear` (increment by 1, wrap at 5→1)
3. Write the change via `writeContractToMFL()`
4. Read salary data again — assert `contractYear` matches new value
5. Revert to original `contractYear`
6. Read salary data again — assert it's back to original
7. Repeat for `contractInfo` (set to `F`, verify, revert to original)

**Safety:**
- Always reverts in a `finally` block, even on test failure
- Hardcodes league 36189 (never touches production 13522)
- Uses `APPEND=1` (already built into the writer)

**Auth:**
- Reads `MFL_USER_ID` and `MFL_IS_COMMISH` from env vars

### 2. GitHub Actions workflow: `.github/workflows/mfl-integration-test.yml`

**Triggers:**
- On every push to `main` (validates nothing broke post-deploy)
- On PRs that touch contract-related files:
  - `src/utils/mfl-contract-writer.ts`
  - `src/utils/contract-*.ts`
  - `src/pages/api/contracts/**`
- Manual trigger (`workflow_dispatch`) for on-demand testing
- Optional: daily schedule as a canary

**Steps:**
1. Checkout, setup pnpm/node (same pattern as roster-sync.yml)
2. `pnpm install --frozen-lockfile`
3. Run integration test with MFL secrets injected as env vars

**Secrets needed (add to GitHub repo settings):**
| Secret | Value | Purpose |
|--------|-------|---------|
| `MFL_USER_ID` | `aRFj2sGVvrPti0PuZljAYw%3D%3D` | Commissioner user cookie |
| `MFL_IS_COMMISH` | `Olc6mJ3NteCtyga9OVHIfTcGFaE0lCC%2Fukrb` | Commissioner flag cookie |

These are the same cookies for both leagues (13522 and 36189) — already confirmed.

### 3. Package.json update

```json
"test:mfl-integration": "npx tsx tests/mfl-write-integration.test.ts"
```

## Files to Create
- `tests/mfl-write-integration.test.ts`
- `.github/workflows/mfl-integration-test.yml`

## Files to Modify
- `package.json` — add `test:mfl-integration` script

## Key Technical Details

### MFL API Endpoints Used
- **Read:** `GET https://api.myfantasyleague.com/2026/export?TYPE=salaries&L=36189&JSON=1`
- **Write:** `POST https://www49.myfantasyleague.com/2026/import?TYPE=salaries&L=36189&APPEND=1`

### Reuse
- `src/utils/mfl-contract-writer.ts` — `writeContractToMFL()` (set `MFL_LEAGUE_ID=36189` in env before importing)
- `.github/workflows/roster-sync.yml` — reference for workflow structure

### Test League
- **League ID:** 36189
- **Salary page:** https://www49.myfantasyleague.com/2026/options?L=36189&O=07
- **Purpose:** Duplicate of TheLeague (13522) for safe write testing

## Future Expansion
This pipeline could grow to test other authenticated operations:
- Trade block writes
- Lineup submissions
- IR moves
- Any future MFL write endpoints

## Verification Criteria
1. Run locally: `MFL_USER_ID=xxx MFL_IS_COMMISH=xxx pnpm test:mfl-integration` → passes
2. MFL salary page shows no residual changes after test completes
3. GitHub Actions workflow triggers on relevant PRs → green check
4. Pipeline fails if MFL write or verification fails
