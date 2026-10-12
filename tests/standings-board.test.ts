/**
 * The standings board's view models (src/utils/standings-board.ts, the AFL's
 * tier rows in src/utils/tier-board.ts) and the site-theme preview switch
 * (src/utils/site-theme.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  buildAllPlayRows,
  buildSeedField,
  shortDivision,
  toBoardTeam,
  type BoardTeam,
} from '../src/utils/standings-board';
import { buildNitRows, buildProRelRows, buildTierRows } from '../src/utils/tier-board';
import { TIERING } from '../src/components/shared/standings/standings-table-config';
import { parseSiteTheme, resolveSiteTheme, resolveThemePreview } from '../src/utils/site-theme';
import { leagueSiteTheme } from '../src/config/leagues';
import type { TeamStanding } from '../src/types/standings';

function standing(id: string, over: Partial<TeamStanding> = {}): TeamStanding {
  return {
    id,
    fname: `Team ${id}`,
    teamName: `Team ${id}`,
    teamIcon: '',
    teamBanner: '',
    division: 'North',
    h2hw: '4',
    h2hl: '2',
    h2ht: '0',
    all_play_wlt: '40-20-0',
    pf: '500',
    pa: '400',
    ...over,
  } as TeamStanding;
}

const opts = {
  leagueSlug: 'theleague',
  usesVictoryPoints: false,
  hrefFor: () => undefined,
  configFor: () => undefined,
};

describe('toBoardTeam', () => {
  it('reads the seed and badge on the ladder it is given (a conference ladder for the AFL)', () => {
    const t = standing('0001', { seed: 6, conferenceSeed: 2 });
    const conf = toBoardTeam(t, { ...opts, badgeSeeding: TIERING.conferenceSeed(2) });
    expect(conf.seed).toBe(2);
    expect(conf.badge).toBe('division_winner');
    const league = toBoardTeam(t, { ...opts, badgeSeeding: TIERING.leagueSeed });
    expect(league.seed).toBe(6);
    expect(league.badge).toBe('wild_card');
  });

  it('prints a tie column only when there is a tie', () => {
    expect(toBoardTeam(standing('0001'), opts).record).toBe('4-2');
    expect(toBoardTeam(standing('0001', { h2ht: '1' }), opts).record).toBe('4-2-1');
  });

  it('falls back to the full name when the league has no shorter one', () => {
    const t = toBoardTeam(standing('0001'), opts);
    expect(t.nameMedium).toBe('Team 0001');
    expect(t.nameShort).toBe('Team 0001');
  });
});

describe('buildSeedField', () => {
  const teams: BoardTeam[] = Array.from({ length: 12 }, (_, i) =>
    toBoardTeam(standing(String(i + 1).padStart(4, '0'), { seed: i + 1 }), { ...opts, badgeSeeding: TIERING.leagueSeed })
  );

  it('groups the ladder in seed order and draws the playoff line before the first band outside the field', () => {
    const groups = buildSeedField(teams, TIERING.leagueSeed);
    expect(groups.map((g) => g.kind)).toEqual(['tiles', 'tiles', 'chips', 'line', 'chase']);
    expect(groups[0].range).toBe('seeds 1–4');
    expect(groups[3].note).toBe('Seeds 10–12 play the Toilet Bowl');
  });

  it('never reorders the rows it was given', () => {
    const ids = buildSeedField(teams, TIERING.leagueSeed)
      .flatMap((g) => g.teams.map((t) => t.team.id));
    expect(ids).toEqual(teams.map((t) => t.id));
  });

  it('caps the chase list where the league asks it to', () => {
    const chase = buildSeedField(teams, TIERING.leagueSeed, { chaseLimit: 2 }).find((g) => g.kind === 'chase');
    expect(chase?.teams).toHaveLength(2);
  });
});

describe('buildAllPlayRows', () => {
  it('scores luck as actual wins minus the wins the all-play rate predicts', () => {
    // 4-2 against a .500 all-play rate: one win better than expected.
    const [row] = buildAllPlayRows([toBoardTeam(standing('0001', { all_play_wlt: '30-30-0' }), opts)]);
    expect(row.luck).toBe(1);
  });
});

describe('shortDivision', () => {
  it('keeps the last word for phones', () => {
    expect(shortDivision('Lawrence Taylor Division')).toBe('Taylor');
    expect(shortDivision('Northwest')).toBe('Northwest');
  });
});

describe('buildTierRows (the AFL tier competition)', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => toBoardTeam(standing(String(i + 1).padStart(4, '0')), opts));

  it('Premier League: the paid ranks medalled and "In the money", relegation playoff 9-10, relegated 11-12', () => {
    const rows = buildTierRows(twelve, { tier: 'Premier League', leagueSlug: 'afl-fantasy' });
    expect(rows[0].rank).toEqual({ kind: 'medal', n: 1, medals: 4 });
    expect(rows.slice(0, 5).map((r) => r.zone)).toEqual(['money', 'money', 'money', 'money', undefined]);
    expect(rows[0].zoneLabel).toEqual({ tone: 'money', text: 'In the money' });
    expect(rows.map((r) => Boolean(r.lead))).toEqual([true, ...Array(11).fill(false)]);
    expect(rows[8].zone).toBe('danger');
    expect(rows[8].zoneLabel?.text).toBe('Relegation playoff');
    expect(rows[9].zoneLabel).toBeUndefined();
    expect(rows[11].zone).toBe('down');
  });

  it('D-League: 1-2 promoted, 3-4 in the promotion playoff, no medals', () => {
    const rows = buildTierRows(twelve, { tier: 'D-League', leagueSlug: 'afl-fantasy' });
    expect(rows[0].rank.kind).toBe('num');
    expect(rows.slice(0, 4).map((r) => r.zone)).toEqual(['up', 'up', 'danger', 'danger']);
  });

  it('D-League: last place gets the name-change band, and only last place', () => {
    const rows = buildTierRows(twelve, { tier: 'D-League', leagueSlug: 'afl-fantasy' });
    expect(rows.filter((r) => r.zone === 'rename')).toEqual([rows[11]]);
    expect(rows[11].zoneLabel).toEqual({ tone: 'rename', text: 'Name change' });
    expect(rows[11].cells.at(-1)?.arrow).toBeUndefined();
  });

  it('a declared movement wins over the AFL defaults', () => {
    const rows = buildTierRows(twelve, { tier: 'Premier League', leagueSlug: 'afl-fantasy', movement: { promote: 0, relegate: 3 } });
    expect(rows.filter((r) => r.zone === 'down')).toHaveLength(3);
    expect(rows.some((r) => r.zone === 'danger')).toBe(false);
  });

  it('prices ranks from the league payout table', () => {
    const rows = buildTierRows(twelve, { tier: 'Premier League', leagueSlug: 'afl-fantasy' });
    expect(rows[0].cells.at(-1)?.prize).toMatch(/^\$\d+/);
  });
});

describe('buildProRelRows (the promotion/relegation playoff)', () => {
  it('top two play in the Premier League next season, bottom two in the D-League', () => {
    const four = Array.from({ length: 4 }, (_, i) => toBoardTeam(standing(String(i + 1).padStart(4, '0')), opts));
    const rows = buildProRelRows(four);
    expect(rows.map((r) => r.zone)).toEqual(['up', 'up', 'down', 'down']);
    expect(rows.map((r) => r.zoneLabel?.text)).toEqual(['Premier League', undefined, 'D-League', undefined]);
    expect(rows.map((r) => r.team.id)).toEqual(four.map((t) => t.id));
  });
});

describe('buildNitRows (the NIT)', () => {
  it('keeps the producer order and shows the conference seed and power rank', () => {
    const two = ['0007', '0003'].map((id) => toBoardTeam(standing(id), opts));
    const rows = buildNitRows([{ team: two[0], seed: 6, pwr: '41.2' }, { team: two[1], pwr: '' }]);
    expect(rows.map((r) => r.team.id)).toEqual(['0007', '0003']);
    expect(rows[0].cells.map((c) => c.text)).toEqual(['6', '4-2', '41.20']);
    expect(rows[1].cells[0].text).toBe('—');
  });
});

describe('site theme preview', () => {
  it('Archie’s wears Primetime; the full-management leagues stay Editorial', () => {
    expect(leagueSiteTheme('archies')).toBe('primetime');
    expect(leagueSiteTheme('theleague')).toBe('editorial');
    expect(leagueSiteTheme('afl-fantasy')).toBe('editorial');
  });

  it('?theme= sets, ?theme=default clears, anything else keeps the cookie', () => {
    expect(resolveThemePreview('primetime', null)).toEqual({ kind: 'set', theme: 'primetime' });
    expect(resolveThemePreview('Editorial', 'primetime')).toEqual({ kind: 'set', theme: 'editorial' });
    expect(resolveThemePreview('default', 'primetime')).toEqual({ kind: 'clear' });
    expect(resolveThemePreview('neon', 'primetime')).toEqual({ kind: 'keep', theme: 'primetime' });
    expect(resolveThemePreview(null, 'bogus')).toEqual({ kind: 'keep', theme: null });
  });

  it('a preview overrides the league’s own theme, and only a known theme parses', () => {
    expect(resolveSiteTheme('theleague', 'primetime')).toBe('primetime');
    expect(resolveSiteTheme('archies', null)).toBe('primetime');
    expect(parseSiteTheme('classic')).toBeNull();
  });
});
