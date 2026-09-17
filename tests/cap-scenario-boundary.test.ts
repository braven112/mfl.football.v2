/**
 * The line between "simulate" and "commit", pinned mechanically.
 *
 * The Front Office hub's cap planner promises an owner they can tick
 * extend / tag / cut / walk and watch three seasons move WITHOUT filing
 * anything. That promise is the whole reason the feature is safe to put on
 * the same page as the real buttons — and it is exactly one careless
 * `fetch` away from being false. A toggle that quietly declared a contract
 * would be the worst bug this feature could ship, and a silent one: the
 * projection would look right.
 *
 * Also pins that the projection model defines no cap arithmetic of its own,
 * the same rule roster-analytics.ts follows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { project, applyScenario, diff, emptyScenario, type ProjectionPlayer } from '../src/utils/cap-projection';
import { calculateCutPenalty, SALARY_CAP } from '../src/utils/salary-calculations';

const MODEL = readFileSync('src/utils/cap-projection.ts', 'utf-8');
const TABLE = readFileSync('src/components/shared/front-office-hub/CapProjectionTable.astro', 'utf-8');
const BAR = readFileSync('src/components/shared/front-office-hub/ScenarioBar.astro', 'utf-8');
const ACTIONS = readFileSync('src/components/shared/front-office-hub/FrontOfficeActions.astro', 'utf-8');

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

describe('a what-if never reaches the network', () => {
  it('neither the projection table nor the scenario bar fetches anything', () => {
    for (const [name, src] of [['CapProjectionTable', TABLE], ['ScenarioBar', BAR]] as const) {
      const code = stripComments(src);
      expect(code, `${name} must not fetch`).not.toMatch(/\bfetch\(/);
      expect(code, `${name} must not XHR`).not.toMatch(/XMLHttpRequest/);
      expect(code, `${name} must not beacon`).not.toMatch(/sendBeacon/);
    }
  });

  it('the model itself is pure — no network, no storage, no fs', () => {
    const code = stripComments(MODEL);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/localStorage/);
    expect(code).not.toMatch(/node:fs/);
  });

  it('only the action component writes, and only to the two real endpoints', () => {
    const code = stripComments(ACTIONS);
    const urls = [...code.matchAll(/fetch\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
    // The declare POST goes through submitDeclaration, so the only literal
    // URL here should be the cut endpoint.
    expect(urls).toEqual(['/api/cut-player']);
    expect(code).toMatch(/submitDeclaration\(/);
  });

  it('filing an action clears it from the scenario', () => {
    // Otherwise the projection counts the same move twice: once as scratch
    // and once as the pending declaration it just became.
    expect(ACTIONS).toMatch(/fo:action-filed/);
    expect(BAR).toMatch(/'fo:action-filed'/);
    expect(BAR).toMatch(/moves\.filter\(\(m\) => m\.playerId !== playerId\)/);
  });
});

describe('scenario storage is league-scoped and failure-tolerant', () => {
  it('goes through scopedLocalKey, never a bare string', () => {
    // Both leagues have a franchise 0001; a bare key is genuinely ambiguous.
    expect(BAR).toMatch(/scopedLocalKey\(/);
    expect(BAR).not.toMatch(/localStorage\.(get|set)Item\(\s*['"`]fo\./);
  });

  it('re-reads the scope per call rather than capturing it', () => {
    // With the ClientRouter one module instance survives a navigation from
    // one league's hub to the other's; a captured scope writes the previous
    // league's bucket.
    expect(BAR).toMatch(/const storageKey = \(\) =>/);
    expect(BAR).toMatch(/bar\.dataset\.league/);
  });

  it('wraps every storage access — it can throw or come back empty', () => {
    // Private window, blocked site data, quota. Scratch is allowed to be
    // missing; the page must still render.
    const reads = BAR.match(/localStorage\.(get|set)Item/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect(BAR).toMatch(/try \{[\s\S]*?localStorage\.getItem[\s\S]*?\} catch/);
    expect(BAR).toMatch(/try \{[\s\S]*?localStorage\.setItem[\s\S]*?\} catch/);
  });
});

describe('cap-projection defines no cap arithmetic of its own', () => {
  it('imports every rate from salary-calculations', () => {
    expect(MODEL).toMatch(/from '\.\/salary-calculations'/);
    for (const fn of [
      'calculateCapCharges',
      'calculateCutPenalty',
      'calculateFranchiseTag',
      'calculateVeteranExtension',
    ]) {
      expect(MODEL).toMatch(new RegExp(fn));
    }
  });

  it('hardcodes no escalation rate, cap limit or penalty percentage', () => {
    const code = stripComments(MODEL);
    expect(code).not.toMatch(/1\.1\b/);
    expect(code).not.toMatch(/45[_,]?000[_,]?000/);
    expect(code).not.toMatch(/0\.15|0\.25|0\.35|0\.45/);
  });
});

describe('the projection model', () => {
  const roster: ProjectionPlayer[] = [
    { id: '1', name: 'A', position: 'QB', salary: 5_000_000, contractYears: 3, displayTag: 'active' },
    { id: '2', name: 'B', position: 'RB', salary: 2_000_000, contractYears: 1, displayTag: 'active' },
    { id: '3', name: 'C', position: 'WR', salary: 1_000_000, contractYears: 2, displayTag: 'active' },
  ];
  const base = { roster, startYear: 2026, capLimit: SALARY_CAP, salaryAverages: { positions: { QB: { top3Average: 9_000_000, top5Average: 7_000_000, top10Average: 4_000_000 } } } };

  it('projects three seasons and thins the roster as contracts run out', () => {
    const years = project({ ...base, years: 3 });
    expect(years.map((y) => y.year)).toEqual([2026, 2027, 2028]);
    // 3 under contract now, 2 next year (B expires), 1 the year after.
    expect(years.map((y) => y.playersUnderContract)).toEqual([3, 2, 1]);
  });

  it('does not clamp negative space — over the cap must read as over', () => {
    const years = project({ ...base, capLimit: 1_000_000, years: 3 });
    expect(years[0].space).toBeLessThan(0);
  });

  it('a cut removes the salary and leaves the penalty behind', () => {
    const scenario = { ...emptyScenario(), moves: [{ kind: 'cut' as const, playerId: '1' }] };
    const { rows, addedDeadMoney } = applyScenario(roster, scenario);
    expect(rows.map((r) => r.id)).toEqual(['2', '3']);
    const penalty = calculateCutPenalty(5_000_000, 3);
    expect(addedDeadMoney[0]).toBe(penalty.currentPenalty);
    expect(addedDeadMoney[1]).toBe(penalty.futurePenalty);
  });

  it('a walk costs nothing — that is the whole difference from a cut', () => {
    const scenario = { ...emptyScenario(), moves: [{ kind: 'walk' as const, playerId: '1' }] };
    const { rows, addedDeadMoney } = applyScenario(roster, scenario);
    expect(rows.map((r) => r.id)).toEqual(['2', '3']);
    expect(addedDeadMoney.every((n) => n === 0)).toBe(true);
  });

  it('a tag re-prices to one year', () => {
    const scenario = { ...emptyScenario(), moves: [{ kind: 'tag' as const, playerId: '1' }] };
    const { rows } = applyScenario(roster, scenario, base.salaryAverages);
    const tagged = rows.find((r) => r.id === '1')!;
    expect(tagged.contractYears).toBe(1);
    // max(5M × 1.2, top3 9M) = 9M
    expect(tagged.salary).toBe(9_000_000);
  });

  it('an extension lengthens the term', () => {
    const scenario = { ...emptyScenario(), moves: [{ kind: 'extend' as const, playerId: '1', years: 2 }] };
    const { rows } = applyScenario(roster, scenario, base.salaryAverages);
    expect(rows.find((r) => r.id === '1')!.contractYears).toBe(5);
  });

  it('one move per player — the last one replaces, it does not compound', () => {
    // Tagging someone you already extended is a correction, not both.
    const scenario = {
      ...emptyScenario(),
      moves: [
        { kind: 'extend' as const, playerId: '1', years: 2 },
        { kind: 'tag' as const, playerId: '1' },
      ],
    };
    const { rows } = applyScenario(roster, scenario, base.salaryAverages);
    expect(rows.find((r) => r.id === '1')!.contractYears).toBe(1);
  });

  it('never mutates the caller\'s roster — reset is just dropping the scenario', () => {
    const before = JSON.stringify(roster);
    applyScenario(roster, { ...emptyScenario(), moves: [{ kind: 'tag', playerId: '1' }] }, base.salaryAverages);
    expect(JSON.stringify(roster)).toBe(before);
  });

  it('a cut frees space in the season it happens', () => {
    const plain = project({ ...base, years: 3 });
    const withCut = project({ ...base, years: 3 }, { ...emptyScenario(), moves: [{ kind: 'cut', playerId: '1' }] });
    expect(withCut[0].space).toBeGreaterThan(plain[0].space);
  });

  it('diff reports the delta per season', () => {
    const plain = project({ ...base, years: 3 });
    const withCut = project({ ...base, years: 3 }, { ...emptyScenario(), moves: [{ kind: 'cut', playerId: '1' }] });
    const d = diff(plain, withCut);
    expect(d).toHaveLength(3);
    expect(d[0].year).toBe(2026);
    expect(d[0].space).toBeCloseTo(withCut[0].space - plain[0].space, 6);
  });

  it('an empty scenario projects exactly what no scenario does', () => {
    expect(project({ ...base, years: 3 }, emptyScenario())).toEqual(project({ ...base, years: 3 }, null));
  });
});
