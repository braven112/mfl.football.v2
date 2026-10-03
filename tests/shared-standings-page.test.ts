import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import archiesConfig from '../data/archies/archies.config.json';
import { getDivisionStandings } from '../src/utils/standings';
import { fillDerivedStandings, divisionRecords, lastScoredWeek } from '../src/utils/standings-derived';
import { chooseStandingsSeason, parseStandingsView } from '../src/utils/standings-page';
import { standingsPageProfile } from '../src/components/shared/standings/standings-page-profile';
import {
  COLUMNS,
  TIERING,
  resolvePlayoffBadgeStatus,
} from '../src/components/shared/standings/standings-table-config';
import type { StandingsFranchise } from '../src/types/standings';
import { madSeeds, madPlayoffSize, madQualifierTiers } from '../src/utils/mad-standings';
import { getLeagueBySlug } from '../src/config/leagues';

/**
 * The standings page is ONE shared component (StandingsPage.astro) that
 * TheLeague and the standard-package leagues (archies) render through thin
 * routes — the owner's rule: a custom league gets the real page, never a lite
 * look-alike. These pin the generalisation: TheLeague's profile is exactly
 * what its page rendered before, archies' derived columns only FILL blanks and
 * never move a row, and its DIV pills claim only what the feed proves.
 */

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const ARCHIES_DIR = 'data/archies/mfl-feeds/2026';
const archiesRows = (): StandingsFranchise[] => json(`${ARCHIES_DIR}/standings.json`).leagueStandings.franchise;
const archiesDivisionOf = (() => {
  const byId = new Map(archiesConfig.teams.map((t) => [t.franchiseId, t.division]));
  return (id: string) => byId.get(id);
})();
const archiesSeasonConfig = {
  ...archiesConfig,
  divisions: archiesConfig.divisions.map((d) => d.name),
};

describe('fillDerivedStandings', () => {
  const sources = () => ({
    weeklyResults: json(`${ARCHIES_DIR}/weekly-results.json`),
    schedule: json(`${ARCHIES_DIR}/schedule.json`),
    divisionOf: archiesDivisionOf,
  });

  it('never re-orders MFL rows', () => {
    const rows = archiesRows();
    const filled = fillDerivedStandings(rows, sources());
    expect(filled.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('fills the columns archies does not export', () => {
    const filled = fillDerivedStandings(archiesRows(), sources());
    for (const row of filled) {
      expect(row.all_play_wlt, row.id).toMatch(/^\d+-\d+-\d+$/);
      expect(row.divwlt, row.id).toMatch(/^\d+-\d+-\d+$/);
      expect(row.strk, row.id).toMatch(/^[WL]\d+$|^$/);
      expect(Number(row.pa), row.id).toBeGreaterThan(0);
    }
  });

  it('never overwrites a value MFL exported', () => {
    const rows = archiesRows().map((r) => ({ ...r, divwlt: '9-9-9', pa: '1.00', strk: 'W99', h2hpct: '.123' }));
    const filled = fillDerivedStandings(rows, sources());
    for (const row of filled) {
      expect(row.divwlt).toBe('9-9-9');
      expect(row.pa).toBe('1.00');
      expect(row.strk).toBe('W99');
      expect(row.h2hpct).toBe('.123');
    }
  });

  it('leaves a league that exports every column untouched (TheLeague 2025)', () => {
    const dir = 'data/theleague/mfl-feeds/2025';
    if (!existsSync(`${dir}/weekly-results.json`)) return;
    const rows: StandingsFranchise[] = json(`${dir}/standings.json`).leagueStandings.franchise;
    const filled = fillDerivedStandings(rows, {
      weeklyResults: json(`${dir}/weekly-results.json`),
      schedule: json(`${dir}/schedule.json`),
      divisionOf: () => 'X',
    });
    expect(filled).toEqual(rows);
  });

  it('returns the rows as-is when no week has been scored', () => {
    const rows = archiesRows();
    expect(fillDerivedStandings(rows, { ...sources(), weeklyResults: { weeks: [] } })).toBe(rows);
  });
});

describe('divisionRecords', () => {
  it('counts only same-division games, symmetrically, through the scored horizon', () => {
    const weeklyResults = json(`${ARCHIES_DIR}/weekly-results.json`);
    const through = lastScoredWeek(weeklyResults);
    const records = divisionRecords(json(`${ARCHIES_DIR}/schedule.json`), archiesDivisionOf, through);
    let w = 0;
    let l = 0;
    for (const r of records.values()) {
      w += r.w;
      l += r.l;
    }
    // Every division game is one win and one loss (or two ties).
    expect(w).toBe(l);
    // A division record can never exceed the overall record's games.
    for (const row of archiesRows()) {
      const rec = records.get(row.id);
      if (!rec) continue;
      const [ow, ol, ot] = row.h2hwlt.split('-').map(Number);
      expect(rec.w + rec.l + rec.t, row.id).toBeLessThanOrEqual(ow + ol + ot);
    }
  });

  it('ignores cross-division games', () => {
    const schedule = {
      schedule: {
        weeklySchedule: [
          {
            week: '1',
            matchup: [
              { franchise: [{ id: 'a', result: 'W' }, { id: 'b', result: 'L' }] },
              { franchise: [{ id: 'c', result: 'W' }, { id: 'd', result: 'L' }] },
            ],
          },
        ],
      },
    };
    const div: Record<string, string> = { a: 'N', b: 'N', c: 'N', d: 'S' };
    const records = divisionRecords(schedule, (id) => div[id], 1);
    expect(records.get('a')).toEqual({ w: 1, l: 0, t: 0 });
    expect(records.get('b')).toEqual({ w: 0, l: 1, t: 0 });
    expect(records.has('c')).toBe(false);
    expect(records.has('d')).toBe(false);
  });
});

describe('standingsPageProfile', () => {
  it("TheLeague keeps exactly the columns and ladder its page shipped with", () => {
    const p = standingsPageProfile('theleague', 4);
    expect(p.columns.division).toBe(COLUMNS.division);
    expect(p.columns.league).toBe(COLUMNS.leagueSeeded);
    expect(p.columns.allPlay).toBe(COLUMNS.allPlay);
    expect(p.leagueTiering).toBe(TIERING.leagueSeed);
    expect(p.badgeSeeding).toBeUndefined();
    expect(p.leagueViewOrder).toBe('seeded');
    expect(p.leagueTabLabel).toBe('Playoff');
    expect(p.franchiseBaseUrl).toBe('/theleague/franchises');
  });

  it('a package league shows no column its data cannot support', () => {
    const p = standingsPageProfile('archies', 9);
    const keys = [...p.columns.division, ...p.columns.league, ...p.columns.allPlay].map((c) => c.key);
    // No PWR in the export, and GB is a W-L measure in a league ranked on VP.
    expect(keys).not.toContain('pwr');
    expect(keys).not.toContain('gamesBack');
    // No wild cards and no seed numbers: the playoff format is not modelled.
    expect(p.badgeSeeding).toEqual(TIERING.divisionWinners(9));
    expect(p.badgeShowsSeed).toBe(false);
    expect(p.leagueTiering).toBeUndefined();
    expect(p.leagueViewOrder).toBe('feed');
  });
});

describe('archies DIV pills', () => {
  it('mark exactly the first row of each division, and no wild cards', () => {
    const divisions = getDivisionStandings(archiesRows(), archiesSeasonConfig, { preserveFeedOrder: true });
    expect(divisions).toHaveLength(archiesConfig.divisions.length);
    const tiering = TIERING.divisionWinners(divisions.length);
    for (const division of divisions) {
      const statuses = division.teams.map((t) => resolvePlayoffBadgeStatus(t, tiering));
      expect(statuses[0], division.name).toBe('division_winner');
      expect(statuses.slice(1).every((s) => s === null), division.name).toBe(true);
    }
  });

  it('groups by the config division order, rows in MFL order', () => {
    const rows = archiesRows();
    const divisions = getDivisionStandings(rows, archiesSeasonConfig, { preserveFeedOrder: true });
    expect(divisions.map((d) => d.name)).toEqual(archiesConfig.divisions.map((d) => d.name));
    const feedIndex = new Map(rows.map((r, i) => [r.id, i]));
    for (const division of divisions) {
      const idx = division.teams.map((t) => feedIndex.get(t.id)!);
      expect(idx, division.name).toEqual([...idx].sort((a, b) => a - b));
    }
  });
});

describe('chooseStandingsSeason / parseStandingsView', () => {
  const glob = { '../x/mfl-feeds/2024/standings.json': async () => ({}), '../x/mfl-feeds/2025/standings.json': async () => ({}) };

  it('defaults to the current season when it has a feed, else the newest', () => {
    expect(chooseStandingsSeason(glob, null, 2025)).toMatchObject({ selectedYear: 2025, valid: true, availableYears: [2025, 2024] });
    expect(chooseStandingsSeason(glob, null, 2026)).toMatchObject({ selectedYear: 2025, defaultYear: 2025, valid: true });
  });

  it('flags a requested year with no feed so the route redirects', () => {
    expect(chooseStandingsSeason(glob, '1999', 2025)).toMatchObject({ valid: false, defaultYear: 2025 });
  });

  it('parses the view param, defaulting to division', () => {
    expect(parseStandingsView(null)).toBe('division');
    expect(parseStandingsView('league')).toBe('league');
    expect(parseStandingsView('all_play')).toBe('all_play');
    expect(parseStandingsView('bogus')).toBe('division');
  });
});

describe('the routes render the ONE shared page', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('TheLeague and archies both render StandingsPage', () => {
    for (const route of ['src/pages/theleague/standings.astro', 'src/pages/archies/standings.astro']) {
      expect(read(route), route).toMatch(/import StandingsPage from '..\/..\/components\/shared\/standings\/StandingsPage.astro'/);
      expect(read(route), route).toMatch(/<StandingsPage\b/);
    }
  });

  it('the lite archies standings page is gone', () => {
    expect(existsSync('src/components/shared/package-league/PackageStandingsPage.astro')).toBe(false);
  });

  it('every standings producer on the shared page keeps MFL order', () => {
    const page = read('src/components/shared/standings/StandingsPage.astro');
    const calls = page.match(/get(Division|League|AllPlay)Standings\([^;]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call).toContain('preserveFeedOrder: true');
  });
});

describe('MAD POWER 99 on the site matches the league widget', () => {
  // The widget's OWN tiers() and tier sizes, lifted from the file it serves
  // on MFL (public/mfl/10105/standings.js) and run in a vm — so the site can
  // never drift from what owners see on the league's MFL home page.
  const src = readFileSync('public/mfl/10105/standings.js', 'utf8');
  const start = src.indexOf('function tiers(teams)');
  let depth = 0;
  let end = src.indexOf('{', start);
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}' && --depth === 0) break;
  }
  const constant = (name: string) => Number(new RegExp(`var ${name}\\s*=\\s*(\\d+)`).exec(src)![1]);
  const widgetTiers = new Function(
    'DIVISION_LEADER_SEEDS',
    'RUNNER_UP_SEEDS',
    'WILD_CARD_SEEDS',
    `${src.slice(start, end + 1)}; return tiers;`
  )(constant('DIVISION_LEADER_SEEDS'), constant('RUNNER_UP_SEEDS'), constant('WILD_CARD_SEEDS'));

  const seeding = getLeagueBySlug('archies')!.standingsSeeding!;

  it('the registry carries the widget’s tier sizes', () => {
    expect(seeding).toEqual({
      kind: 'mad',
      divisionLeaders: constant('DIVISION_LEADER_SEEDS'),
      runnersUp: constant('RUNNER_UP_SEEDS'),
      wildCards: constant('WILD_CARD_SEEDS'),
    });
  });

  it('seeds every team exactly as the widget does, on the committed feed', () => {
    const rows = archiesRows();
    const widget = widgetTiers(
      rows.map((r, i) => ({
        id: r.id,
        division: archiesDivisionOf(r.id),
        vp: Number(r.vp) || 0,
        pf: Number(r.pf ?? (r as unknown as { avgpf: string }).avgpf) || 0,
        feedOrder: i,
      }))
    ) as { entries: Array<{ team: { id: string }; seed: number; tier: string }> };
    const tierName: Record<string, string> = { leader: 'leader', second: 'runnerUp', wild: 'wildCard', field: 'field' };
    const ours = madSeeds(rows, archiesDivisionOf, seeding);
    expect(ours.map((s) => [s.id, s.seed, s.tier])).toEqual(
      widget.entries.map((e) => [e.team.id, e.seed, tierName[e.tier]])
    );
  });

  it('holds because MFL already sorts this league on Victory Points, then points', () => {
    // madSeeds never re-sorts; it relies on MFL's row order BEING the VP/PF
    // order. If the league changes its MFL standings sort, this fails first.
    const rows = archiesRows();
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]];
      const vpA = Number(a.vp);
      const vpB = Number(b.vp);
      expect(vpA, `${a.id} above ${b.id}`).toBeGreaterThanOrEqual(vpB);
      if (vpA === vpB) expect(Number(a.pf), `${a.id} above ${b.id}`).toBeGreaterThanOrEqual(Number(b.pf));
    }
  });

  it('puts the right number of teams in each tier, one leader and one runner-up per division', () => {
    const seeds = madSeeds(archiesRows(), archiesDivisionOf, seeding);
    const count = (t: string) => seeds.filter((s) => s.tier === t).length;
    expect([count('leader'), count('runnerUp'), count('wildCard'), count('field')]).toEqual([9, 9, 12, 69]);
    const divsOf = (t: string) => new Set(seeds.filter((s) => s.tier === t).map((s) => archiesDivisionOf(s.id)));
    expect(divsOf('leader').size).toBe(9);
    expect(divsOf('runnerUp').size).toBe(9);
    expect(madPlayoffSize(seeding)).toBe(30);
  });

  it('the homepage card shows the qualifiers only, banded by tier in seed order', () => {
    const seeds = madSeeds(archiesRows(), archiesDivisionOf, seeding);
    const tiers = madQualifierTiers(seeds);
    expect(tiers.map((t) => [t.tier, t.from, t.to, t.ids.length])).toEqual([
      ['leader', 1, 9, 9],
      ['runnerUp', 10, 18, 9],
      ['wildCard', 19, 30, 12],
    ]);
    expect(tiers.flatMap((t) => t.ids)).toEqual(seeds.slice(0, madPlayoffSize(seeding)).map((s) => s.id));
    expect(madQualifierTiers([])).toEqual([]);
  });

  it('the MAD profile bands and badges follow the seeds', () => {
    const p = standingsPageProfile('archies', 9, seeding);
    expect(p.leagueTabLabel).toBe('MAD');
    expect(p.leagueTiering).toEqual(TIERING.mad(seeding));
    const status = (seed: number) =>
      resolvePlayoffBadgeStatus({ seed } as unknown as Parameters<typeof resolvePlayoffBadgeStatus>[0], p.badgeSeeding!);
    expect([status(1), status(9), status(10), status(18), status(19), status(30), status(31)]).toEqual([
      'division_winner',
      'division_winner',
      'runner_up',
      'runner_up',
      'wild_card',
      'wild_card',
      null,
    ]);
  });
});
