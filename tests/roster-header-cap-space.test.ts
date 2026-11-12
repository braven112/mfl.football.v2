/**
 * The roster header's "Cap space" must be the table's Cap Space cell — the
 * same cap charges PLUS dead money — and must follow simulated moves.
 *
 * Sept 2026: the header computed `capLimit - totals.totalSalary`. That total
 * carries no dead money, so every club's header overstated its room by its
 * drop penalties (Pacific Pigskins: $4,139,075 shown, $1,978,075 real) while
 * the table below showed the right figure. And because the header was only
 * server-rendered, a simulated cut or trade moved the table and not the plate.
 *
 * The page's output is produced by hydration, so this is a scan guard on the
 * source shapes that keep the two numbers one number.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/pages/theleague/rosters.astro'), 'utf8');
const nameplate = fs.readFileSync(
  path.join(root, 'src/components/shared/roster-header/RosterNameplate.astro'),
  'utf8',
);

describe('roster header cap space', () => {
  it('never derives cap space from totals.totalSalary (no dead money in it)', () => {
    const offenders = page
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /capSpace\w*\s*[:=].*totalSalary/i.test(line));
    expect(offenders.map(({ n, line }) => `rosters.astro:${n} ${line.trim()}`)).toEqual([]);
  });

  it('computes the server-side figure with dead money, for every club', () => {
    const helper = page.match(/const headerCapSpaceFor = [\s\S]*?\n\};/)?.[0] ?? '';
    expect(helper, 'headerCapSpaceFor helper is missing').not.toBe('');
    expect(helper).toContain('calculateCapCharges(');
    expect(helper).toContain('aggregateDeadMoneyFromSeasonData(');
    expect(page).toContain('capSpace: headerCapSpaceFor(team.id)');
    expect(page).toContain('const headerCapSpace = headerCapSpaceFor(defaultTeamId)');
  });

  it('tags the cap-space stat so the client can keep it live', () => {
    const tagged = page.match(/label: 'Cap space', key: 'cap-space'/g) ?? [];
    // The current club's plate and every swap template.
    expect(tagged.length).toBe(2);
    expect(nameplate).toContain('data-rhdr-stat={stat.key}');
  });

  it('rewrites the header from the table figure on every render', () => {
    // updateView() hands the table's own per-year figures (players + dead
    // money) to the cap-surface painter, which every row render calls — so a
    // sort by a later salary year moves the header to that year (Nov 2026).
    const view = page.slice(page.indexOf('const updateView = () => {'));
    expect(view).toMatch(/capSurfaceCtx = \{[\s\S]{0,200}capCharges: capChargesWithDead,[\s\S]{0,80}capLimit: capLimitForSeason/);
    const paint = page.match(/const paintCapSurfacesForYear = [\s\S]*?\n {4}\};/)?.[0] ?? '';
    expect(paint, 'paintCapSurfacesForYear is missing').not.toBe('');
    expect(paint).toContain('const space = ctx.capLimit - (ctx.capCharges[yearIndex] ?? 0)');
    expect(paint).toMatch(/querySelector<HTMLElement>\('\[data-rhdr-stat="cap-space"\]'\)[\s\S]{0,120}_capSpaceFmt\.format\(space\)/);
    // Only the season the header is about.
    expect(paint.slice(0, paint.indexOf('[data-rhdr-stat="cap-space"]'))).toContain(
      'currentSeason === defaultSeason',
    );
    const render = page.slice(page.indexOf('const renderTableRows = '));
    expect(render.slice(0, render.indexOf('if (!rows.length)'))).toContain('paintCapSurfacesForYear(');
  });
});

describe('simulated cut dead money', () => {
  it("is scoped to the viewed club's roster, never summed page-wide", () => {
    const view = page.slice(page.indexOf('const updateView = () => {'));
    const block = view.slice(0, view.indexOf('updateYearTotals(rows, deadMoney)'));
    // Either inline, or through rosters/sim-summary.ts's addSimDeadMoney with
    // the row ids as its `onRoster` scope (the phone layout's shared rule).
    expect(block, 'cut penalties must be filtered to players in `rows`').toMatch(
      /action\.type === 'cut' && rowIds\.has\(|addSimDeadMoney\([^;]*contractActions,\s*rowIds\)/,
    );
    expect(block).not.toMatch(/Object\.values\(contractActions\)\.forEach/);
  });
});
