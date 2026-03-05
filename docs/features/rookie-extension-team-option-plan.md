# Plan: Implement Rookie Extension & Team Option CDM Flows

## Context

The CDM (Contract Declaration Modal) currently supports franchise tag and veteran extension via the admin action-select flow. The league rules also define two additional contract actions for rookie contracts:

1. **Rookie Extension** — adds 2 years to a rookie contract (RC or TO players with 2+ years remaining)
2. **5th-Year Team Option** — adds 1 year at top-10 position average salary (TO players with 1 year remaining)

These are mutually exclusive per player. Both need CDM simulation flows following existing patterns. The `icon-coin-r` SVG (for rookie extension) was already created in a previous task.

### Source Rules (from `rules.astro`)

**Rookie Extension:**
- Adds 2 additional years to a rookie contract
- Eligible: RC or TO, originally drafted (or traded + extended before Feb 14 same year)
- Can be applied Year 1 through start of Year 4 → `currentYears >= 2`
- Salary = `(top5Avg × 2) / (existingYears + 2) + currentSalary`, then 10% escalation each year
- One extension per team per season

**Team Option:**
- 1st-round picks only (TO contractInfo), 4-year RC with 5th-year team option
- 5th-year salary = **average of top 10 salaries** at the player's position
- Must be exercised before 4th year begins → when `currentYears === 1`
- Provides one additional year (4yr → 5yr total)
- Only for players drafted from 2026 onward
- Mutually exclusive with rookie extension

**Mutual exclusivity:** A player cannot receive both a rookie extension AND team option.

---

## Implementation Steps

### Step 1: Add `top10Average` to salary averages pipeline

**Files:**
- `scripts/update-salary-averages.mjs` (~line 586)
- `src/pages/theleague/rosters.astro` (~line 1229)

**Changes:**
1. In `summarizeByPosition()`, add `const top10 = list.slice(0, 10);` and `top10Average: average(top10.map(p => p.salary))` to the summary object
2. In rosters.astro salary averages processing, add a `teamOptionSalaries` tier:
```javascript
teamOptionSalaries: {
  QB: data.positions.QB?.top10Average ?? 0,
  // ... all positions
},
```
3. Update the `SalaryAverages` interface in `contract-eligibility.ts` to include `teamOptionSalaries`

### Step 2: Add `'team-option'` declaration type

**Files:**
- `src/types/contract-eligibility.ts`
- `src/utils/contract-eligibility.ts`

**Changes to types:**
1. Add `'team-option'` to the `DeclarationType` union
2. Add `teamOptionSalary?: number` field to `EligibilityResult`

**Changes to eligibility engine** (priority order update):
```
1. New acquisition (unchanged)
2. Rookie override (unchanged)
3. Franchise tag — add: exclude TO (contractInfo !== 'TO')
4. NEW: Team option — TO + 1 year remaining + offseason
5. Veteran extension — add: exclude TO (contractInfo !== 'TO')
6. Rookie extension — change: (RC || TO) + currentYears >= 2 + offseason
```

**Team option eligibility check** (insert after franchise-tag, ~line 296):
```typescript
// 4. Check for team option (TO player, 1 year remaining, offseason)
const isTO = contractInfo === 'TO';
if (isTO && currentYears === 1 && window.windowType === 'offseason') {
  const position = (playerInfo?.position ?? '').toUpperCase();
  const top10Avg = salaryAverages?.teamOptionSalaries?.[position] ?? 0;
  return {
    ...base,
    eligible: true,
    declarationType: 'team-option',
    teamOptionSalary: top10Avg,
    tagBasis: 'top 10 average',  // reuse tagBasis field for display
  };
}
```

**Modify franchise-tag check** (~line 283):
```typescript
if (currentYears === 1 && window.windowType === 'offseason' && contractInfo !== 'F' && contractInfo !== 'TO') {
```

**Modify veteran-extension check** (~line 299):
```typescript
if (currentYears >= 2 && !isRC && contractInfo !== 'TO' && window.windowType === 'offseason') {
```

**Modify rookie-extension check** (~line 313):
```typescript
const isTO = contractInfo === 'TO';
if ((isRC || isTO) && currentYears >= 2 && window.windowType === 'offseason') {
```

### Step 3: Server-side eligibility serialization

**File:** `src/pages/theleague/rosters.astro` (~line 1617)

**Changes:**
1. Add `'team-option'` to `adminOnlyTypes` array:
```javascript
const adminOnlyTypes = ['franchise-tag', 'veteran-extension', 'rookie-extension', 'team-option'];
```
2. Add `teamOptionSalary` to the serialized eligibility data (alongside existing `tagSalary`, `extensionSalary`):
```javascript
if (p.teamOptionSalary !== undefined) entry.teamOptionSalary = p.teamOptionSalary;
```

### Step 4: Client-side CDM — labels, action buttons, calculation

**File:** `src/pages/theleague/rosters.astro` (script section)

**4a. Add label** (~line 5345):
```javascript
const DECLARATION_TYPE_LABELS = {
  ...existing,
  'team-option': 'Team Option',
};
```

**4b. Add `calculateTeamOption` function** (after `calculateFranchiseTag`, ~line 5549):
```javascript
const calculateTeamOption = (salary, position, season) => {
  const avgSalary = getReferenceSalary(position, 'team-option', season);
  return {
    newSalary: Math.round(avgSalary),
    newYears: 1,
  };
};
```

**4c. Update `getReferenceSalary`** (~line 5531):
```javascript
if (type === 'franchise') return averages.franchiseSalaries?.[position] ?? 0;
if (type === 'team-option') return averages.teamOptionSalaries?.[position] ?? 0;
return averages.extensionSalaries?.[position] ?? 0;
```

**4d. Update `populateCdmActionOptions`** (~line 8288):

Replace the current franchise/extension logic with type-aware checks:
```javascript
const contractInfo = elig.contractInfo;
const isTO = contractInfo === 'TO';
const isRC = elig.isRookieContract;

// Tag-like actions (1 year remaining)
if (contractYears === 1 && !isTO) {
  // Franchise Tag — non-TO players only
  actionOptions.appendChild(makeCdmActionBtn(
    'franchise', 'Franchise Tag', '1 year at higher of 120% or position average',
    () => goToFranchiseTagStep2(), false, 'icon-franchise-tag'
  ));
}
if (contractYears === 1 && isTO) {
  // Team Option — TO players only (5th year)
  actionOptions.appendChild(makeCdmActionBtn(
    'team-option', 'Team Option', '5th-year option at top 10 position average',
    () => goToTeamOptionStep2(), false, 'icon-franchise-tag'  // or new icon TBD
  ));
}

// Extension actions (2+ years remaining)
if (contractYears >= 2 && !isRC && !isTO) {
  // Veteran Extension — standard contracts only
  actionOptions.appendChild(makeCdmActionBtn(
    'extension', 'Veteran Extension', 'Extend contract 1\u20132 years',
    () => goToVetExtYearStep(), false, 'icon-coin'
  ));
}
if (contractYears >= 2 && (isRC || isTO)) {
  // Rookie Extension — RC or TO contracts only
  actionOptions.appendChild(makeCdmActionBtn(
    'rookie-extension', 'Rookie Extension', 'Extend rookie contract 2 years',
    () => goToRookieExtReview(), false, 'icon-coin-r'
  ));
}
```

**4e. Update `buildYearsCellContent`** (~line 5427):

Add `'team-option'` and `'rookie-extension'` to the non-interactive chip types:
```javascript
if (elig.type === 'franchise-tag' || elig.type === 'veteran-extension'
    || elig.type === 'team-option' || elig.type === 'rookie-extension') {
  return '<span class="yrs-chip">...plain span...</span>';
}
```

### Step 5: Team Option CDM flow — 2-step (action → review)

**File:** `src/pages/theleague/rosters.astro`

Create `goToTeamOptionStep2()` — mirrors `goToFranchiseTagStep2()`:

```javascript
const goToTeamOptionStep2 = () => {
  cdmCurrentStep = 2;
  cdmFlowType = 'team-option';

  // Stepper: dot1 completed, dot2 active, step 2 of 2
  // (same stepper updates as goToFranchiseTagStep2)

  // Type badge
  typeBadgeEl.style.display = '';
  typeBadgeEl.dataset.type = 'team-option';
  document.getElementById('cdm-type-label').textContent = 'Team Option';

  // Calculate team option salary (top 10 average)
  const elig = cdmPlayerData.eligibility;
  const teamOptionResult = calculateTeamOption(elig.currentSalary, cdmPlayerData.position, config.extensionSeason);
  const optionSalary = teamOptionResult.newSalary;

  // Reuse tag section UI for salary comparison
  const tagSection = document.getElementById('cdm-tag-section');
  if (tagSection) tagSection.style.display = '';
  document.getElementById('cdm-tag-current').textContent = formatSalaryCompact(elig.currentSalary);
  document.getElementById('cdm-tag-new').textContent = formatSalaryCompact(optionSalary);
  document.getElementById('cdm-tag-basis-text').textContent = 'Based on the top 10 salaries at position';

  // Update projection table (for the 5th year)
  const playerAge = cdmPlayerData.birthdate ? calculateAge(cdmPlayerData.birthdate) : null;
  updateProjectionTable(optionSalary, 1, playerAge, config.salaryYears?.[0]);

  cdmSelectedYears = 1;
  cdmSelectedSalary = optionSalary;
  cdmSubmitBtn.disabled = false;
  cdmSubmitBtn.textContent = 'Exercise Team Option';
  if (cdmBackBtn) cdmBackBtn.style.display = '';
};
```

### Step 6: Rookie Extension CDM flow — 2-step (action → review)

**File:** `src/pages/theleague/rosters.astro`

Create `goToRookieExtReview()` — 2-step flow (skips year selection since always +2):

```javascript
const goToRookieExtReview = () => {
  cdmCurrentStep = 2;
  cdmFlowType = 'rookie-extension';

  // Stepper: dot1 completed, dot2 active, step 2 of 2
  // (no dot3 needed — fixed 2 years, no year selection)

  // Type badge
  typeBadgeEl.style.display = '';
  typeBadgeEl.dataset.type = 'rookie-extension';
  document.getElementById('cdm-type-label').textContent = 'Rookie Extension';

  // Calculate extension salary (same formula as veteran extension, fixed 2 years)
  const elig = cdmPlayerData.eligibility;
  const existingYears = Number(elig.currentYears) || 0;
  const baseSalary = Number(elig.currentSalary) || 0;
  const extYears = 2; // Always 2 for rookie extension
  const avgSalary = getReferenceSalary(cdmPlayerData.position, 'extension', config.extensionSeason);
  const denominator = existingYears + extYears;
  const proratedPortion = denominator > 0 ? (avgSalary * extYears) / denominator : 0;
  const newSalary = Math.round(proratedPortion + baseSalary);

  // Show extension terms section (reuse vet-ext section)
  const extSection = document.getElementById('cdm-extension-section');
  if (extSection) extSection.style.display = '';
  document.getElementById('cdm-ext-current').textContent = formatSalaryCompact(baseSalary);
  document.getElementById('cdm-ext-new').textContent = formatSalaryCompact(newSalary);

  const yrsCurrentEl = document.getElementById('cdm-ext-years-current');
  const yrsNewEl = document.getElementById('cdm-ext-years-new');
  if (yrsCurrentEl) yrsCurrentEl.textContent = existingYears + (existingYears === 1 ? ' yr' : ' yrs');
  if (yrsNewEl) yrsNewEl.textContent = denominator + ' yrs';

  // Show formula breakdown (same as vet-ext)
  const formulaSection = document.getElementById('cdm-formula-section');
  if (formulaSection) {
    formulaSection.style.display = '';
    // Populate equation, steps, result (same pattern as vet-ext year button click handler)
  }

  // Projection table
  const playerAge = cdmPlayerData.birthdate ? calculateAge(cdmPlayerData.birthdate) : null;
  updateProjectionTable(newSalary, denominator, playerAge, config.salaryYears?.[0]);

  cdmSelectedYears = extYears;
  cdmSelectedSalary = newSalary;
  cdmSubmitBtn.disabled = false;
  cdmSubmitBtn.textContent = 'Add Extension';
  if (cdmBackBtn) cdmBackBtn.style.display = '';
};
```

### Step 7: Simulation support in `applyContractAction`

**File:** `src/pages/theleague/rosters.astro` (~line 5802)

**Add team-option case** (after franchise case):
```javascript
} else if (actionType === 'team-option') {
  // Team option is separate from franchise tag — doesn't conflict
  result = calculateTeamOption(salary, position, config.extensionSeason);
  result.ufaYearIndex = years; // Year after current contract
}
```

**Add rookie-extension case** (after extension case):
```javascript
} else if (actionType === 'rookie-extension') {
  // Shares extension slot with veteran extension
  if (currentVeteranExtension) {
    delete contractActions[currentVeteranExtension];
    currentVeteranExtension = null;
  }
  result = calculateVeteranExtension(years, position, config.extensionSeason, 2, salary);
  currentVeteranExtension = id;
}
```

**Update submit handler** (~line 8762) to handle new flow types:
```javascript
if (cdmFlowType === 'team-option') {
  selectedPlayer = cdmPlayerData._rawPlayer;
  applyContractAction('team-option');
  closeDeclarationModal();
  return;
}
if (cdmFlowType === 'rookie-extension') {
  selectedPlayer = cdmPlayerData._rawPlayer;
  applyContractAction('rookie-extension', 2);
  closeDeclarationModal();
  return;
}
```

### Step 8: Regenerate salary averages data

Run the updated script to add top10Average to all existing data files:
```bash
node scripts/update-salary-averages.mjs
# or: node scripts/regenerate-salary-summaries.mjs
```

### Step 9: Add mock test data

**File:** `src/pages/theleague/rosters.astro` (~line 1640, testEligibility block)

Add mock players for TO scenarios:
```javascript
// 1st round pick, 3 years remaining — eligible for rookie extension
'99901': {
  type: 'rookie-extension',
  currentYears: 3,
  currentSalary: 2000000,
  contractInfo: 'TO',
  isRookieContract: false,
  extensionSalary: ...,
  extensionYears: 5,
}

// 1st round pick, 1 year remaining — eligible for team option
'99902': {
  type: 'team-option',
  currentYears: 1,
  currentSalary: 2000000,
  contractInfo: 'TO',
  isRookieContract: false,
  teamOptionSalary: ...,
  tagBasis: 'top 10 average',
}
```

### Step 10: Update unit tests

**File:** `tests/contract-eligibility.test.ts`

Add test cases:
1. **Team option**: TO + 1 year → `'team-option'`
2. **TO excluded from franchise tag**: TO + 1 year → NOT `'franchise-tag'`
3. **TO excluded from veteran extension**: TO + 2 years → NOT `'veteran-extension'`
4. **Rookie extension with TO**: TO + 2 years → `'rookie-extension'`
5. **Rookie extension with RC**: RC + 2 years → `'rookie-extension'` (already exists, verify)
6. **RC with 1 year**: RC + 1 year → NOT `'rookie-extension'` (enforces the 2+ years rule)
7. **Mutual exclusivity**: verify TO player can only get one of team-option OR rookie-extension based on years

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `scripts/update-salary-averages.mjs` | Add `top10Average` calculation |
| `src/types/contract-eligibility.ts` | Add `'team-option'` type, `teamOptionSalary` field |
| `src/utils/contract-eligibility.ts` | Team option check, TO exclusions, RC/TO rookie-ext eligibility |
| `src/pages/theleague/rosters.astro` | Top 10 salary tier, CDM flows, action buttons, simulation, mock data |
| `tests/contract-eligibility.test.ts` | New test cases for TO and updated rookie-ext |

---

## Key Design Decisions

1. **Team Option is 2-step** (action → review), same as franchise tag — no year selection needed (always 1 year)
2. **Rookie Extension is 2-step** (action → review) — no year selection since always +2 years. This differs from veteran extension (3-step with year choice) because the year count is fixed.
3. **Reuse existing CDM HTML** — team option reuses the tag-section (salary comparison), rookie extension reuses the extension-section + formula-section. No new DOM elements needed.
4. **Team option has its own simulation slot** — separate from franchise tag. A team can exercise both.
5. **Rookie extension shares the extension slot** — with veteran extension (one extension per team per year).
6. **Top 10 salary average** is a new data tier — needs `top10Average` added to the salary averages JSON files and the processing pipeline.

---

## Verification

1. **Run tests**: `pnpm test` — verify all eligibility tests pass including new TO/rookie-ext cases
2. **Dev server**: `pnpm dev` → navigate to `/theleague/rosters?testEligibility=true`
3. **Test TO player with 1 year**: Click ⋮ → should see "Team Option" button (not franchise tag) → click → review step shows top 10 avg salary → submit simulates correctly
4. **Test RC/TO player with 2+ years**: Click ⋮ → should see "Rookie Extension" button (not veteran extension) → click → review shows formula breakdown with fixed +2 years → submit simulates
5. **Test standard player (no RC/TO)**: Click ⋮ → should still see franchise tag / veteran extension as before
6. **Build**: `pnpm build` — verify no type errors

---

## Worktree & Branch Info

- **Worktree:** `vigorous-hermann`
- **Branch:** `claude/vigorous-hermann`
- **Base:** All CDM infrastructure (action-select flow, franchise tag, veteran extension) is already built on this branch
- **Icons ready:** `icon-coin` (vet-ext), `icon-coin-r` (rookie-ext), `icon-franchise-tag` (franchise tag) are all in the sprite
