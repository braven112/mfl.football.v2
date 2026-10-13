import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  countGroups,
  formatGroupStat,
  groupHeaderRowHtml,
  groupStatSpec,
  readCollapsedGroups,
  readGrouping,
  rosterGroupKey,
  toggleCollapsedGroup,
} from '../src/utils/rosters/position-groups';

const UFA = Number.MAX_SAFE_INTEGER - 1;
const DASH = Number.MAX_SAFE_INTEGER;

describe('rosterGroupKey', () => {
  it('bands the active roster by position and the practice squad / IR as one band each', () => {
    expect(rosterGroupKey({ position: 'QB' })).toBe('QB');
    expect(rosterGroupKey({ position: 'Def' })).toBe('DEF');
    expect(rosterGroupKey({ position: 'K' })).toBe('PK');
    expect(rosterGroupKey({ position: 'Coach' })).toBe('OTHER');
    expect(rosterGroupKey({ position: 'WR', displayTag: 'practice' })).toBe('PS');
    expect(rosterGroupKey({ position: 'RB', displayTag: 'injured' })).toBe('IR');
  });

  it('counts each band', () => {
    const counts = countGroups([{ position: 'QB' }, { position: 'QB' }, { position: 'RB', displayTag: 'injured' }]);
    expect(counts.get('QB')).toBe(2);
    expect(counts.get('IR')).toBe(1);
  });
});

describe('groupStatSpec — the band figure follows the sort', () => {
  it('totals the mode headline on the default sort', () => {
    expect(groupStatSpec('position', 'coach')).toMatchObject({ key: 'projectedPoints', agg: 'sum', label: 'proj' });
    expect(groupStatSpec('position', 'gm', () => '2026 salary')).toMatchObject({ key: 'salary_0', format: 'money', label: '2026 salary' });
  });

  it('switches to the sorted stat (user: "update the group proj if I choose Avg")', () => {
    expect(groupStatSpec('avgSeason', 'coach')).toMatchObject({ key: 'avgSeason', agg: 'sum', label: 'avg' });
    expect(groupStatSpec('oppRank', 'coach')).toMatchObject({ agg: 'avg', format: 'rank' });
    expect(groupStatSpec('salary_2', 'gm', () => '2028 salary')).toMatchObject({ key: 'salary_2', label: '2028 salary' });
  });

  it('shows no figure for a sort with no meaningful group total', () => {
    expect(groupStatSpec('spreadAmount', 'coach')).toBeNull();
    expect(groupStatSpec('temperature', 'coach')).toBeNull();
    expect(groupStatSpec('topRanking', 'gm')).toBeNull();
  });
});

describe('formatGroupStat', () => {
  it('leaves a player with no contract that year OUT of the figure', () => {
    const spec = groupStatSpec('salary_2', 'gm')!;
    // Two under contract in that year, one UFA, one dash (gone).
    expect(formatGroupStat([2_000_000, 1_500_000, UFA, DASH], spec)).toBe('$3.5M');
    const years = groupStatSpec('contractYears', 'gm')!;
    expect(formatGroupStat([3, 1, Infinity], years)).toBe('2.0');
  });

  it('averages and formats per kind', () => {
    expect(formatGroupStat([3, 30], groupStatSpec('oppRank', 'coach')!)).toBe('#17');
    expect(formatGroupStat([10.26, 5], groupStatSpec('projectedPoints', 'coach')!)).toBe('15.3');
  });

  it('prints nothing, never "0.0", when no row has a value', () => {
    expect(formatGroupStat([], groupStatSpec('projectedPoints', 'coach')!)).toBeNull();
    expect(formatGroupStat([0, 0], groupStatSpec('projectedPoints', 'coach')!)).toBeNull();
    expect(formatGroupStat([UFA, DASH], groupStatSpec('salary_3', 'gm')!)).toBeNull();
  });
});

describe('state attributes', () => {
  it('reads Grouped as the default', () => {
    expect(readGrouping(undefined)).toBe('grouped');
    expect(readGrouping('junk')).toBe('grouped');
    expect(readGrouping('all')).toBe('all');
  });

  it('toggles a collapsed group in a space-separated, CSS ~= friendly list', () => {
    let v = toggleCollapsedGroup('', 'RB');
    expect(v).toBe('RB');
    v = toggleCollapsedGroup(v, 'QB');
    expect(v).toBe('QB RB');
    expect(readCollapsedGroups(v).has('RB')).toBe(true);
    expect(toggleCollapsedGroup(v, 'RB')).toBe('QB');
  });
});

describe('groupHeaderRowHtml', () => {
  it('is one button that names, counts and totals the band', () => {
    const html = groupHeaderRowHtml({
      key: 'QB',
      count: 3,
      colspan: 11,
      collapsed: false,
      stat: { value: '46.2', label: 'proj' },
    });
    expect(html).toContain('data-group-header="QB"');
    expect(html).toContain('colspan="11"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Quarterbacks');
    expect(html).toContain('3<span class="roster-group-row__sr"> players</span>');
    expect(html).toContain('46.2');
  });

  it('says collapsed, and escapes a key it does not know', () => {
    const html = groupHeaderRowHtml({ key: '"><x' as never, count: 1, colspan: 3, collapsed: true });
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('"><x');
    expect(html).toContain(' player</span>');
  });
});

describe('AFL-family roster styles reach the page', () => {
  // Every AFL-family rule in roster-position-groups.css is scoped to
  // [data-controller='afl-family']; with the attribute missing, the phone band
  // shrink-wrapped and the sort chips spilled out of their card (2026-10-07).
  const css = readFileSync('src/styles/roster-position-groups.css', 'utf8');
  const page = readFileSync('src/components/shared/rosters/RostersPage.astro', 'utf8');

  it('the shared roster page sets the controller the CSS is scoped to', () => {
    expect(css).toContain("[data-controller='afl-family']");
    expect(page).toMatch(/<section class="roster-page"[^>]*data-controller="afl-family"/);
  });

  it('the AFL phone band is a full-width block', () => {
    // The row AND its cell: a block cell inside a table-row still shrink-wraps.
    const row = ".roster-page[data-controller='afl-family'] .roster-table--afl > tbody > tr.roster-group-row";
    expect(css).toContain(`${row},\n  ${row} > .roster-group-row__cell {\n    display: block;`);
  });
});
