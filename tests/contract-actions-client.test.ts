/**
 * Guards the one place a contract gets priced and filed.
 *
 * Four surfaces declare contracts — rosters.astro's bulk submit, the CDM
 * wizard, the homepage's Unsigned FA card, and the Front Office hub. Before
 * Phase C, three of them carried their own `fetch` to
 * /api/contracts/declare and rosters.astro carried its own copy of every
 * pricing formula. Two copies of a cap formula is two answers to "what does
 * extending him cost", and the copies drift silently because nothing
 * compares them.
 *
 * These are scan guards, deliberately. The arithmetic itself is unit-tested
 * against salary-calculations.ts below; what a scan can prove and a unit
 * test cannot is that nobody re-inlined it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  calculateFranchiseTag,
  calculateTeamOption,
  calculateVeteranExtension,
  getReferenceSalary,
  toDeclarationRequest,
  toSalaryAverages,
} from '../src/utils/contract-actions-client';
import {
  calculateFranchiseTag as sharedFranchiseTag,
  calculateVeteranExtension as sharedVeteranExtension,
} from '../src/utils/salary-calculations';

const CORE = readFileSync('src/utils/contract-actions-client.ts', 'utf-8');
const ROSTERS = readFileSync('src/pages/theleague/rosters.astro', 'utf-8');

describe('exactly one module POSTs a contract declaration', () => {
  it('no source file outside the core hits the endpoint directly', () => {
    // git ls-files so a new file cannot slip past a hardcoded list.
    const files = execSync("git ls-files 'src/**/*.astro' 'src/**/*.ts' 'src/**/*.tsx'", {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      // The API route itself and the core are the two legitimate mentions.
      .filter((f) => !f.startsWith('src/pages/api/'))
      .filter((f) => f !== 'src/utils/contract-actions-client.ts');

    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /fetch\(\s*['"`]\/api\/contracts\/declare/.test(src);
    });

    expect(
      offenders,
      offenders.length
        ? `These file(s) POST /api/contracts/declare directly instead of calling ` +
          `submitDeclaration() from src/utils/contract-actions-client.ts:\n  ${offenders.join('\n  ')}`
        : '',
    ).toEqual([]);
  });

  it('the core throws the API\'s own message rather than inventing one', () => {
    // "already has a pending franchise tag" / "not eligible" is the most
    // useful thing an owner can be told; a generic string discards it.
    expect(CORE).toMatch(/throw new Error\(\(result as any\)\?\.error \|\| 'Submission failed'\)/);
  });

  it('files staged actions sequentially, not in parallel', () => {
    // The API rejects a second franchise tag for the same team and that
    // check reads the store, so a Promise.all would let two race past it.
    expect(CORE).toMatch(/for \(const action of actions\)/);
    expect(CORE).not.toMatch(/Promise\.all/);
  });
});

describe('rosters.astro prices contracts through the shared core', () => {
  it('holds no copy of the pricing formulas', () => {
    // Each of these was a full re-implementation in the page, identical in
    // arithmetic to salary-calculations.ts and differing only in how it
    // looked position averages up.
    expect(ROSTERS).not.toMatch(/const increasedSalary = salary \* 1\.2/);
    expect(ROSTERS).not.toMatch(/avgSalary \* extYears\) \/ denominator/);
    expect(ROSTERS).not.toMatch(/futurePercentByYears = \{/);
    expect(ROSTERS).toMatch(/from '\.\.\/\.\.\/utils\/contract-actions-client'/);
  });

  it('delegates each helper rather than reimplementing it', () => {
    expect(ROSTERS).toMatch(/calculateFranchiseTagCore\(salary, position, seasonAverages\(season\)\)/);
    expect(ROSTERS).toMatch(/calculateVeteranExtensionCore\(/);
    expect(ROSTERS).toMatch(/calculateCutPenaltyCore\(salary, contractYears\)/);
  });
});

describe('the core does not redefine the arithmetic either', () => {
  it('imports the formulas from salary-calculations', () => {
    expect(CORE).toMatch(/from '\.\/salary-calculations'/);
    expect(CORE).toMatch(/calcFranchiseTagShared/);
    expect(CORE).toMatch(/calcVeteranExtensionShared/);
  });

  it('hardcodes no rate of its own', () => {
    const body = CORE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(body).not.toMatch(/\*\s*1\.2\b/);
    expect(body).not.toMatch(/Math\.pow\(1\.1/);
  });
});

describe('the flattened client config and MFL\'s nested shape agree', () => {
  // The one real risk in routing the page's math through the shared module:
  // the config ships `franchiseSalaries[pos]` while the shared helpers read
  // `positions[pos].top3Average`. If the adapter mapped a tier to the wrong
  // slot, every price would be quietly wrong rather than obviously broken.
  const averages = {
    franchiseSalaries: { QB: 9_000_000 },
    extensionSalaries: { QB: 7_000_000 },
    teamOptionSalaries: { QB: 4_000_000 },
  };

  it('maps franchise → top 3, extension → top 5, team option → top 10', () => {
    const mapped = toSalaryAverages(averages, 'QB');
    expect(mapped.positions.QB.top3Average).toBe(9_000_000);
    expect(mapped.positions.QB.top5Average).toBe(7_000_000);
    expect(mapped.positions.QB.top10Average).toBe(4_000_000);
    expect(getReferenceSalary(averages, 'QB', 'franchise')).toBe(9_000_000);
    expect(getReferenceSalary(averages, 'QB', 'extension')).toBe(7_000_000);
    expect(getReferenceSalary(averages, 'QB', 'team-option')).toBe(4_000_000);
  });

  it('the franchise tag matches the shared function exactly', () => {
    for (const salary of [1_000_000, 5_000_000, 8_000_000, 12_000_000]) {
      const mine = calculateFranchiseTag(salary, 'QB', averages);
      const theirs = sharedFranchiseTag(salary, 'QB', toSalaryAverages(averages, 'QB'));
      expect(mine.newSalary).toBe(theirs.newSalary);
      expect(mine.newYears).toBe(1);
    }
  });

  it('takes the greater of a 20% raise and the top-3 average', () => {
    // Below the top-3 line the tag pulls UP to it; above it, the raise wins.
    expect(calculateFranchiseTag(1_000_000, 'QB', averages).newSalary).toBe(9_000_000);
    expect(calculateFranchiseTag(10_000_000, 'QB', averages).newSalary).toBe(12_000_000);
  });

  it('the veteran extension matches the shared function exactly', () => {
    for (const [years, ext, salary] of [[2, 2, 1_000_000], [3, 1, 2_500_000], [1, 4, 800_000]] as const) {
      const mine = calculateVeteranExtension(years, 'QB', ext, salary, averages);
      const theirs = sharedVeteranExtension(years, 'QB', ext, salary, toSalaryAverages(averages, 'QB'));
      expect(mine).toEqual(theirs);
    }
  });

  it('escalates the extension 10% a year across its full term', () => {
    const r = calculateVeteranExtension(2, 'QB', 2, 1_000_000, averages);
    expect(r.newYears).toBe(4);
    // (7M * 2 / 4) + 1M = 4.5M, then +10% compounding.
    expect(r.newSalary).toBe(4_500_000);
    expect(r.salaryBreakdown.year0).toBe(4_500_000);
    expect(r.salaryBreakdown.year3).toBe(Math.round(4_500_000 * 1.1 ** 3));
  });

  it('a team option is a flat one-year buy at the top-10 average', () => {
    expect(calculateTeamOption('QB', averages)).toEqual({ newSalary: 4_000_000, newYears: 1 });
  });

  it('an unpriced position yields 0 rather than NaN', () => {
    // A position missing from the averages must not produce NaN and ship it
    // into a declaration body.
    expect(getReferenceSalary(averages, 'PK', 'extension')).toBe(0);
    expect(calculateTeamOption('PK', undefined).newSalary).toBe(0);
    expect(Number.isFinite(calculateFranchiseTag(500_000, 'PK', undefined).newSalary)).toBe(true);
  });
});

describe('the declaration body carries the letters MFL shows on a roster', () => {
  const ctx = { leagueId: '13522', franchiseId: '0001', franchiseName: 'Pacific Pigskins' };
  const base = {
    playerId: '1234',
    playerName: 'Test, Player',
    originalYears: 3,
    originalSalary: 2_000_000,
    newYears: 5,
    newSalary: 4_000_000,
  };

  it("a franchise tag is one year, marked 'F'", () => {
    const body = toDeclarationRequest({ ...base, type: 'franchise' }, ctx);
    expect(body.type).toBe('franchise-tag');
    expect(body.requestedYears).toBe(1);
    expect(body.requestedContractInfo).toBe('F');
  });

  it("an extension keeps its term, marked 'E'", () => {
    const body = toDeclarationRequest({ ...base, type: 'extension' }, ctx);
    expect(body.type).toBe('veteran-extension');
    expect(body.requestedYears).toBe(5);
    expect(body.requestedContractInfo).toBe('E');
  });

  it('carries the CURRENT contract alongside the requested one', () => {
    // The commissioner's review screen diffs the two; dropping the current
    // side makes an extension unreviewable.
    const body = toDeclarationRequest({ ...base, type: 'extension' }, ctx);
    expect(body.currentYears).toBe(3);
    expect(body.currentSalary).toBe(2_000_000);
  });
});
