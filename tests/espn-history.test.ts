import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  currentEspnSeason,
  espnSeasonUrl,
  mergeSummaries,
  parseEspnUpload,
  sortStandings,
  summarizeSeason,
  TOKEN_PATTERN,
} from '../src/utils/espn-history';

const LEAGUE = '1615685738';

/** A trimmed ESPN v3 season in the shape the /seasons endpoint returns. */
const season = (overrides: Record<string, unknown> = {}) => ({
  id: Number(LEAGUE),
  seasonId: 2025,
  settings: { name: 'Family League' },
  status: { isActive: false, currentMatchupPeriod: 17 },
  members: [
    { id: '{A}', displayName: 'dadcoach' },
    { id: '{B}', firstName: 'Sam', lastName: 'Lee' },
  ],
  teams: [
    { id: 1, name: 'Rockets', abbrev: 'RKT', owners: ['{A}'], playoffSeed: 2, rankCalculatedFinal: 1,
      record: { overall: { wins: 9, losses: 5, ties: 0, pointsFor: 1500.5, pointsAgainst: 1400 } } },
    { id: 2, location: 'Big', nickname: 'Bears', abbrev: 'BB', owners: ['{B}'], playoffSeed: 1, rankCalculatedFinal: 2,
      record: { overall: { wins: 11, losses: 3, ties: 0, pointsFor: 1600, pointsAgainst: 1300 } } },
  ],
  schedule: [
    { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 101.2 }, away: { teamId: 2, totalPoints: 99 }, winner: 'HOME', playoffTierType: 'NONE' },
    { matchupPeriodId: 16, home: { teamId: 2, totalPoints: 90 }, away: { teamId: 1, totalPoints: 120 }, winner: 'AWAY', playoffTierType: 'WINNERS_BRACKET' },
  ],
  ...overrides,
});

describe('ESPN links', () => {
  it('uses /seasons from 2018 on and /leagueHistory before', () => {
    expect(espnSeasonUrl(LEAGUE, 2026, 'mTeam')).toBe(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/${LEAGUE}?view=mTeam`,
    );
    expect(espnSeasonUrl(LEAGUE, 2016, 'mTeam')).toBe(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${LEAGUE}?seasonId=2016&view=mTeam`,
    );
  });

  it('names the season by the year it starts', () => {
    expect(currentEspnSeason(new Date('2026-09-23T12:00:00Z'))).toBe(2026);
    expect(currentEspnSeason(new Date('2027-01-10T12:00:00Z'))).toBe(2026);
    expect(currentEspnSeason(new Date('2027-08-31T12:00:00Z'))).toBe(2026);
  });
});

describe('parseEspnUpload', () => {
  it('accepts one season and translates teams, owners, games and the champion', () => {
    const result = parseEspnUpload(JSON.stringify(season()), LEAGUE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [{ summary, views }] = result.seasons;
    expect(views).toEqual(['mTeam', 'mMatchup', 'mSettings']);
    expect(summary.leagueName).toBe('Family League');
    expect(summary.teams.map((t) => t.name)).toEqual(['Rockets', 'Big Bears']);
    expect(summary.teams[1].owners).toEqual(['Sam Lee']);
    expect(summary.championTeamId).toBe(1);
    expect(summary.matchups).toHaveLength(2);
    expect(summary.matchups[1]).toMatchObject({ week: 16, playoff: true, winner: 'AWAY' });
  });

  it('accepts the /leagueHistory array of seasons', () => {
    const result = parseEspnUpload(JSON.stringify([season({ seasonId: 2016 }), season({ seasonId: 2017 })]), LEAGUE);
    expect(result.ok && result.seasons.map((s) => s.summary.seasonId)).toEqual([2016, 2017]);
  });

  it("refuses ESPN's not-authorized body with a fix the commissioner can act on", () => {
    const body = JSON.stringify({ messages: ['You are not authorized to view this League.'], details: [] });
    const result = parseEspnUpload(body, LEAGUE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Log in at espn\.com/);
  });

  it("refuses another league's data, text that isn't JSON, and a missing season", () => {
    expect(parseEspnUpload(JSON.stringify(season({ id: 42 })), LEAGUE).ok).toBe(false);
    expect(parseEspnUpload('<html>ESPN</html>', LEAGUE).ok).toBe(false);
    expect(parseEspnUpload(JSON.stringify(season({ seasonId: undefined })), LEAGUE).ok).toBe(false);
    expect(parseEspnUpload('   ', LEAGUE).ok).toBe(false);
  });

  it('has no champion until ESPN calculates final ranks', () => {
    const live = season({
      status: { isActive: true, currentMatchupPeriod: 3 },
      teams: [{ id: 1, name: 'A', rankCalculatedFinal: 0, record: { overall: { wins: 2, losses: 1 } } }],
    });
    const result = parseEspnUpload(JSON.stringify(live), LEAGUE);
    expect(result.ok && result.seasons[0].summary.championTeamId).toBeNull();
  });
});

describe('mergeSummaries', () => {
  it('keeps owners from an earlier team upload when a later upload only carries scores', () => {
    const full = summarizeSeason(season() as never, LEAGUE);
    const scoresOnly = summarizeSeason(
      season({ teams: [{ id: 1 }, { id: 2 }], settings: undefined }) as never,
      LEAGUE,
    );
    const merged = mergeSummaries(full, scoresOnly);
    expect(merged.teams[0].owners).toEqual(['dadcoach']);
    expect(merged.leagueName).toBe('Family League');
    expect(merged.matchups).toHaveLength(2);
    expect(merged.championTeamId).toBe(1);
  });
});

describe('sortStandings', () => {
  it('orders by final rank, then seed, then record', () => {
    const { teams } = summarizeSeason(season() as never, LEAGUE);
    expect(sortStandings(teams).map((t) => t.id)).toEqual([1, 2]);
    const unranked = teams.map((t) => ({ ...t, finalRank: null }));
    expect(sortStandings(unranked).map((t) => t.id)).toEqual([2, 1]);
  });
});

describe('import routes', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

  it('the upload page resolves its token before anything else and is never cached or indexed', () => {
    const route = read('src/pages/history/import/[token].astro');
    expect(route.indexOf('resolveImportToken(')).toBeLessThan(route.indexOf('storeEspnUpload('));
    expect(route.indexOf('resolveImportToken(')).toBeLessThan(route.indexOf('listSnapshots('));
    expect(route).toContain("'Cache-Control', 'private, no-store'");
    expect(route).toContain("'X-Robots-Tag', 'noindex, nofollow'");
    expect(route).toContain("'Referrer-Policy', 'no-referrer'");
    expect(route).toContain('checkRateLimit(');
  });

  it.each(['src/pages/theleague/admin/espn-history/index.astro', 'src/pages/theleague/admin/espn-history/[leagueId].astro'])(
    '%s runs the league admin gate first',
    (file) => {
      const route = read(file);
      const gate = route.indexOf('isAuthorizedForLeague(user,');
      expect(gate).toBeGreaterThan(-1);
      for (const call of ['listEspnImports(', 'createEspnImport(', 'readSeasonSummaries(']) {
        const at = route.indexOf(call);
        if (at > -1) expect(at).toBeGreaterThan(gate);
      }
    },
  );

  it('tokens are 32 random bytes in base64url', () => {
    expect(TOKEN_PATTERN.test('a'.repeat(43))).toBe(true);
    expect(TOKEN_PATTERN.test('a'.repeat(42))).toBe(false);
    expect(TOKEN_PATTERN.test('../../etc/passwd')).toBe(false);
  });
});
