/**
 * TheLeague roster → player sheet payload (src/utils/rosters/phone-sheet.ts).
 *
 * Pins the parts of docs/plans/rosters-mobile-layout.md § 4-5 that are pure
 * decisions: what the Salary tab says about a contract, which actions the hero
 * and More actions offer to whom, the default tab per mode (Q3), and that every
 * write action routes to the CDM rather than growing a second implementation.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildRosterSheetFields,
  buildSalarySheet,
  buildQuickActions,
  buildMoreActions,
  createRosterSheetActionHandler,
  simulatedCapDelta,
  formatDeadline,
  liftYearCells,
  CDM_ROUTES,
  type RosterSheetFacts,
  type RosterSheetPricing,
  type LiftedYearCell,
} from '../src/utils/rosters/phone-sheet';
import { getCdmActionDescriptors } from '../src/utils/cdm-action-descriptors';
import { calculateCutPenalty } from '../src/utils/salary-calculations';

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const pricing: RosterSheetPricing = {
  cutPenalty: (s, y) => calculateCutPenalty(s, y),
  franchiseTag: (s) => ({ newSalary: Math.round(s * 1.2), basis: '20% increase' }),
  teamOption: () => ({ newSalary: 9_000_000 }),
  extension: (_y, _p, ext, s) => ({ newSalary: s + ext * 1_000_000 }),
  formatCurrency: usd,
  formatCompact: (n) => '$' + (n / 1e6).toFixed(2) + 'M',
};

const cell = (text: string, ...state: string[]): LiftedYearCell => ({
  text,
  classes: ['salary-cell', 'gm-col', ...state.map((s) => `salary-cell--${s}`)],
});

function facts(over: Partial<RosterSheetFacts> & { player?: Partial<RosterSheetFacts['player']> } = {}): RosterSheetFacts {
  const player = {
    id: '1234', position: 'QB', salary: 5_000_000, years: 3, contractInfo: '', tradeBait: false, displayTag: 'active',
    ...(over.player ?? {}),
  };
  const eligibility = { playerId: player.id, currentYears: player.years, contractInfo: player.contractInfo, displayTag: player.displayTag };
  const base: RosterSheetFacts = {
    player,
    salaryYears: [2026, 2027, 2028, 2029, 2030],
    yearCells: [
      cell('$5,000,000'), cell('$5,500,000'), cell('$6,050,000'), cell('UFA', 'ufa'), cell('—', 'future-ufa'),
    ],
    totalRemaining: 16_550_000,
    thisWeek: null,
    myRank: null,
    mode: 'gm',
    viewer: { signedIn: true, isOwnTeam: true },
    activeActionType: null,
    capSpaceNow: 1_980_000,
    descriptors: getCdmActionDescriptors(eligibility, {
      isOwnTeam: over.viewer?.isOwnTeam ?? true,
      autocut: () => null,
      watch: { signedOut: false, watched: false },
    }),
    eligibility,
    now: Date.UTC(2026, 8, 25),
  };
  return { ...base, ...over, player };
}

describe('Salary tab', () => {
  it('lifts the row’s year cells verbatim and marks the escalation', () => {
    const s = buildSalarySheet(facts(), pricing);
    expect(s.years.map((y) => [y.year, y.text, y.kind])).toEqual([
      ['2026', '$5,000,000', 'salary'],
      ['2027', '$5,500,000', 'salary'],
      ['2028', '$6,050,000', 'salary'],
      ['2029', 'UFA', 'ufa'],
      ['2030', '—', 'future-ufa'],
    ]);
    expect(s.years.map((y) => !!y.escalated)).toEqual([false, true, true, false, false]);
  });

  it('carries the row’s simulated / declared / TO states', () => {
    const s = buildSalarySheet(facts({
      yearCells: [cell('$5,000,000'), cell('$6,000,000', 'declared'), cell('$7,200,000', 'simulated'), cell('TO', 'team-option', 'team-option-eligible'), cell('$9,000,000', 'team-option', 'team-option-expired')],
    }), pricing);
    expect(s.years[1].declared).toBe(true);
    expect(s.years[2].simulated).toBe(true);
    expect(s.years[3].kind).toBe('to-eligible');
    expect(s.years[4].kind).toBe('to-expired');
  });

  it('If cut: 50% now, then the future spread next year, from calculateCutPenalty', () => {
    const s = buildSalarySheet(facts(), pricing);
    const p = calculateCutPenalty(5_000_000, 3);
    expect(s.years[0].ifCut).toBe(usd(p.currentPenalty));
    expect(s.years[1].ifCut).toBe(usd(p.futurePenalty));
    expect(s.years[2].ifCut).toBeNull();
  });

  it('tiles: salary, years thru, designation, remaining', () => {
    const s = buildSalarySheet(facts({ player: { contractInfo: 'RC' } as never }), pricing);
    expect(s.tiles).toEqual([
      { label: '2026 salary', value: '$5.00M' },
      { label: 'Thru 2028', value: '3 yrs' },
      { label: 'Designation', value: 'Rookie (RC)' },
      { label: 'Remaining', value: '$16.55M' },
    ]);
  });

  it('Remaining totals the year table, not the escalation-free payload figure', () => {
    // The payload's totalRemaining is salary x years ($15M here); the rows
    // escalate 10% a year, so the table says $16.55M and the tile must too.
    const s = buildSalarySheet(facts({ totalRemaining: 15_000_000 }), pricing);
    expect(s.tiles.find((t) => t.label === 'Remaining')?.value).toBe('$16.55M');
  });

  it('Extend or tag: eligible options priced, the rest disabled with a reason', () => {
    const s = buildSalarySheet(facts(), pricing);
    const byId = Object.fromEntries(s.options.map((o) => [o.id, o]));
    expect(byId.extension.disabled).toBeFalsy();
    expect(byId.extension.cost).toBe('+1 yr $6,000,000 · +2 yrs $7,000,000');
    expect(byId.franchise).toMatchObject({ disabled: true, detail: 'Opens in his final year (2028)' });
    expect(byId['team-option']).toMatchObject({ disabled: true });
    expect(byId['rookie-extension']).toMatchObject({ disabled: true, detail: 'Only on rookie (RC / TO) contracts' });
    // Declare Contract is a window, not an attribute — never listed as missing.
    expect(byId['declare-contract']).toBeUndefined();
  });

  it('a 1-year contract prices the tag for the year after it', () => {
    const s = buildSalarySheet(facts({ player: { years: 1 } as never }), pricing);
    const tag = s.options.find((o) => o.id === 'franchise');
    expect(tag).toMatchObject({ cost: '$6,000,000 for 2027', detail: '120% of his salary' });
  });

  it('Simulate previews the current-year cap effect', () => {
    const s = buildSalarySheet(facts(), pricing);
    expect(s.simulations.map((o) => o.id)).toEqual(['cut-simulate', 'trade-simulate']);
    // Cut: +$5M charge back, -$2.5M dead money.
    expect(s.simulations[0].detail).toBe('2026 space $1.98M → $4.48M · +$2,500,000');
    expect(s.simulations[1].detail).toBe('2026 space $1.98M → $6.98M · +$5,000,000');
  });

  it('after a simulation it offers Undo instead (Q5)', () => {
    const s = buildSalarySheet(facts({ activeActionType: 'cut' }), pricing);
    expect(s.simulated).toBe('Simulated cut');
    expect(s.simulations).toEqual([expect.objectContaining({ id: 'undo-simulation', state: 'on' })]);
  });
});

describe('cap delta', () => {
  it('a practice-squad player counts half this year, so cutting him frees nothing now', () => {
    const f = facts({ player: { displayTag: 'practice' } as never });
    expect(simulatedCapDelta('cut', f, pricing)).toBe(0);
    expect(simulatedCapDelta('trade', f, pricing)).toBe(2_500_000);
  });
});

describe('hero quick actions (Q7)', () => {
  it('own team: Simulate cut, trade block, More', () => {
    expect(buildQuickActions(facts()).map((a) => a.id)).toEqual(['cut-simulate', 'trade-block', 'more']);
  });
  it('after a simulated cut: "Simulated · Undo" (Q5)', () => {
    const [first] = buildQuickActions(facts({ activeActionType: 'cut' }));
    expect(first).toMatchObject({ id: 'undo-simulation', label: 'Simulated · Undo', state: 'on' });
  });
  it('trade block shows its state', () => {
    const tb = buildQuickActions(facts({ player: { tradeBait: true } as never })).find((a) => a.id === 'trade-block');
    expect(tb).toMatchObject({ state: 'on', label: 'On trade block' });
  });
  it('another owner’s player: only More — Trade for him and Watch are the sheet’s built-ins', () => {
    expect(buildQuickActions(facts({ viewer: { signedIn: true, isOwnTeam: false } })).map((a) => a.id)).toEqual(['more']);
  });
});

describe('More actions', () => {
  it('own team: roster moves from the CDM list, the Trade Builder, then Release (danger)', () => {
    const more = buildMoreActions(facts());
    expect(more.map((a) => a.id)).toEqual(['move-to-ir', 'trade-builder', 'release']);
    expect(more.at(-1)).toMatchObject({ tone: 'danger' });
  });
  it('another team: no roster moves and no Release', () => {
    expect(buildMoreActions(facts({ viewer: { signedIn: true, isOwnTeam: false } })).map((a) => a.id)).toEqual(['trade-builder']);
  });
});

describe('default tab (Q3)', () => {
  it('GM opens Salary, Coach opens Summary', () => {
    expect(buildRosterSheetFields(facts({ mode: 'gm' }), pricing).sheetTab).toBe('salary');
    expect(buildRosterSheetFields(facts({ mode: 'coach' }), pricing).sheetTab).toBe('summary');
  });
});

describe('routing — one implementation per action', () => {
  const api = () => ({ rerender: vi.fn(), close: vi.fn(), announce: vi.fn() });
  const deps = () => ({
    simulate: vi.fn(),
    undo: vi.fn(),
    toggleTradeBlock: vi.fn(async () => ({ ok: true, onBlock: true })),
    openCdm: vi.fn(),
    rebuild: vi.fn(() => ({ name: 'next' })),
  });

  it('a simulation applies locally and re-renders the OPEN sheet', async () => {
    const d = deps(); const a = api();
    await createRosterSheetActionHandler(d)('cut-simulate', a);
    expect(d.simulate).toHaveBeenCalledWith('cut');
    expect(a.rerender).toHaveBeenCalledWith({ name: 'next' });
    expect(a.close).not.toHaveBeenCalled();
  });

  it('undo removes and re-renders', async () => {
    const d = deps(); const a = api();
    await createRosterSheetActionHandler(d)('undo-simulation', a);
    expect(d.undo).toHaveBeenCalled();
    expect(a.rerender).toHaveBeenCalled();
  });

  it('write actions close the sheet and open the CDM on that option', async () => {
    const d = deps(); const a = api();
    const handle = createRosterSheetActionHandler(d);
    await handle('franchise', a);
    expect(a.close).toHaveBeenCalled();
    expect(d.openCdm).toHaveBeenLastCalledWith(['franchise']);
    await handle('release', a);
    expect(d.openCdm).toHaveBeenLastCalledWith(['cut']);
    await handle('trade-builder', a);
    expect(d.openCdm).toHaveBeenLastCalledWith(['trade', 'trade-builder']);
  });

  it('Release goes to the cut REVIEW, never straight to the irreversible button', () => {
    expect(CDM_ROUTES.release).toEqual(['cut']);
    expect(Object.values(CDM_ROUTES).flat()).not.toContain('cut-real');
  });

  it('every contract and More action the sheet can show has a route', () => {
    const f = facts();
    const shown = [
      ...buildMoreActions(f).map((a) => a.id),
      ...buildSalarySheet(f, pricing).options.map((o) => o.id),
      'team-option', 'declare-contract', 'more',
    ];
    for (const id of shown) expect(CDM_ROUTES[id], id).toBeDefined();
  });
});

describe('deadline copy', () => {
  it('counts down like the years chip', () => {
    const now = Date.UTC(2026, 8, 25, 0, 0, 0);
    expect(formatDeadline(now / 1000 + 52 * 3600, now)).toBe('Deadline in 2d 4h');
    expect(formatDeadline(now / 1000 + 5 * 3600, now)).toBe('Deadline in 5h');
    expect(formatDeadline(now / 1000 + 60, now)).toBe('Deadline in under an hour');
    expect(formatDeadline(now / 1000 - 60, now)).toBeNull();
  });
});

describe('lifting reads the row at click time', () => {
  it('reads each year cell by data-column, text and classes', () => {
    const cells: Record<string, { textContent: string; classList: string[] }> = {
      '[data-column="year1"]': { textContent: ' $5,000,000 ', classList: ['salary-cell', 'salary-cell--simulated'] },
      '[data-column="year2"]': { textContent: 'UFA', classList: ['salary-cell', 'salary-cell--ufa'] },
    };
    const row = { querySelector: (sel: string) => cells[sel] ?? null } as unknown as ParentNode;
    expect(liftYearCells(row, 3)).toEqual([
      { text: '$5,000,000', classes: ['salary-cell', 'salary-cell--simulated'] },
      { text: 'UFA', classes: ['salary-cell', 'salary-cell--ufa'] },
      null,
    ]);
  });

  it('the page passes the builder a row it looked up at click time', () => {
    const page = readFileSync('src/pages/theleague/rosters.astro', 'utf8');
    expect(page).toMatch(/initPlayerModalTrigger\(rosterTbody, \{[\s\S]*?enrich:/);
  });
});
