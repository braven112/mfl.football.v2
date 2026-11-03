/**
 * Ask the History knows the AFL's all-play side competition: the AFL Cup
 * (knockout 2015-2016, one combined all-play table in 2017) and the Premier
 * League / D-League from 2018. Brandon, 2026-11-03: asked about "our Premier
 * League", it answered about soccer.
 *
 * Every fact comes from a file that already records it: the config's
 * tierCompetition, tier-history.json, awards-history.json and each season's
 * weekly-results.json.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import afl from '../data/afl-fantasy/derived/league-history.json';
import theleague from '../data/theleague/derived/league-history.json';
import tierHistory from '../data/afl-fantasy/tier-history.json';
import awardsHistory from '../data/afl-fantasy/awards-history.json';
import { QueryError, competitionStory, runQuery } from '../src/utils/league-history/ask-query.mjs';
import { askHistory } from '../src/utils/league-history/ask';
import { loadLeagueCompetitions } from '../src/utils/league-history/datasets';
import { getLeagueBySlug } from '../src/config/leagues';

const AFL_LEAGUE = getLeagueBySlug('afl-fantasy')!;
const TL_LEAGUE = getLeagueBySlug('theleague')!;

let comp: any;
beforeAll(async () => {
  comp = await loadLeagueCompetitions(AFL_LEAGUE.dataPath, AFL_LEAGUE.configPath);
});

const rows = (q: any) => {
  const r = runQuery(afl, q, { competitions: comp });
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.key, row.cells[i]])));
};

describe('loadLeagueCompetitions', () => {
  it('loads the AFL competition from its own files, from the first all-play season on', () => {
    expect(comp).not.toBeNull();
    expect(comp.tierCompetition.firstSeason).toBe(2017);
    expect(Object.keys(comp.weekly)[0]).toBe('2017');
  });

  it('finds none for a league without one', async () => {
    expect(await loadLeagueCompetitions(TL_LEAGUE.dataPath, TL_LEAGUE.configPath)).toBeNull();
  });
});

describe('competition units', () => {
  it('ranks every recorded champion first in its own table', () => {
    const seasons = (tierHistory as any).seasons as Record<string, any>;
    for (const [year, s] of Object.entries(seasons)) {
      if (!s.champions) continue;
      const firsts = rows({ unit: 'competitionSeasons', years: { from: Number(year), to: Number(year) }, where: [{ field: 'rank', op: 'eq', value: 1 }], columns: ['competition', 'champion'] });
      expect(firsts).toHaveLength(2);
      for (const r of firsts) expect(r.champion).toBe(true);
    }
  });

  it('calls 2017 the AFL Cup, one table of every team, won by the payout-confirmed winner at its week-16 cutoff', () => {
    const cup = rows({ unit: 'competitionSeasons', years: { from: 2017, to: 2017 }, columns: ['competition', 'team', 'w', 'l', 'weeks', 'tableSize', 'champion'] });
    expect(cup[0]).toEqual(expect.objectContaining({ competition: 'AFL Cup', team: 'Smokane FC', w: 259, l: 109, weeks: 16, tableSize: 24, champion: true }));
  });

  it('lists every title, the AFL Cup knockout winners included', () => {
    const titles = rows({ unit: 'competitionTitles', limit: 25, columns: ['year', 'competition', 'team', 'format'] });
    const recorded = (awardsHistory as any).seasons.flatMap((s: any) =>
      ['afl-cup', 'premier-league', 'dleague-champion'].filter((slug) => s.awards?.[slug]).map(() => s.year),
    );
    expect(titles).toHaveLength(recorded.length);
    expect(titles.filter((t) => t.format === 'knockout').map((t) => t.year)).toEqual([2015, 2016]);
  });

  it('answers "best Premier League record" from the tiers only, not the head-to-head season', () => {
    const tiers = rows({ unit: 'competitionOwners', competition: 'tiers', sort: [{ field: 'winPct', dir: 'desc' }], limit: 1, columns: ['owner', 'w', 'l', 'firstYear'] });
    expect(tiers[0].firstYear).toBeGreaterThanOrEqual(2018);
    const premier = runQuery(afl, { unit: 'competitionOwners', competition: 'Premier League', columns: ['owner', 'premierSeasons', 'dleagueSeasons'] }, { competitions: comp });
    for (const r of premier.rows) expect(r.cells[2]).toBe(0);
    expect(premier.description).toContain('Premier League');
  });

  it('counts the season being played only through its final weeks', () => {
    const latest = afl.seasons.at(-1)!;
    if (latest.done) return;
    const now = rows({ unit: 'competitionSeasons', years: { from: latest.y }, limit: 1, columns: ['weeks', 'complete', 'champion'] });
    expect(now[0]).toEqual(expect.objectContaining({ complete: false, champion: false }));
  });

  it('is a QueryError for a league without the competition', () => {
    expect(() => runQuery(theleague, { unit: 'competitionSeasons' })).toThrow(QueryError);
  });
});

describe('the prompt', () => {
  function capture() {
    const seen: any[] = [];
    return {
      seen,
      client: { messages: { create: async (body: any) => (seen.push(body), { content: [{ type: 'tool_use', id: 'a', name: 'answer', input: { answer: 'x', show: -1 } }] }) } },
    };
  }

  it("tells the model the Premier League is the league's own all-play competition, with its history", async () => {
    const { client, seen } = capture();
    await askHistory('afl-fantasy', { history: afl, competitions: comp }, 'best Premier League record ever?', { client });
    const system = JSON.stringify(seen[0].system);
    expect(system).toContain('nothing to do with soccer');
    expect(system).toContain('from 2018 the all-play table is split');
    expect(system).toContain('2017 was the last AFL Cup');
    expect(system).toContain('competitionOwners');
    expect(competitionStory(afl, comp)).toContain('2015 AFL Cup');
  });

  it('says there is no such competition for a league without one', async () => {
    const { client, seen } = capture();
    await askHistory('theleague', { history: theleague }, 'Premier League?', { client });
    expect(JSON.stringify(seen[0].system)).toContain('no all-play side competition');
  });
});
