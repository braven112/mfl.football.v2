/**
 * AFL playoff brackets rebuilt from schedule.json.
 *
 * MFL's playoffBracket export carries seeds only for 2003-2023 — no franchise
 * ids, no points — so /afl-fantasy/playoffs rendered "Bracket data not
 * available" for every season before 2024. The GAMES were never missing:
 * schedule.json has every playoff week fully scored.
 * scripts/reconstruct-afl-playoff-brackets.mjs walks them as a
 * single-elimination tournament seeded with the conference-qualified field.
 *
 * These tests exist because a reconstruction that looks plausible and is wrong
 * is worse than an empty state. Champions are pinned against three independent
 * sources that agree: the hand-curated championship-history.json, the AFL
 * awards ledger, and the commissioner's own confirmation of the 2005-2008
 * results.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { normalizePlayoffBracket } from '../src/utils/playoffs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import reconstructed from '../data/afl-fantasy/derived/reconstructed-playoff-brackets.json';
import championshipHistory from '../data/afl-fantasy/championship-history.json';

const AFL = getLeagueBySlug('afl-fantasy');
const ROOT = path.resolve(__dirname, '..');
const FEEDS = path.join(ROOT, AFL.dataPath, 'mfl-feeds');

const SEASONS = (reconstructed as any).seasons as Record<string, any>;
const CHAMPS = new Map(
  ((championshipHistory as any).championships ?? []).map((c: any) => [String(c.year), c])
);

const readFeed = (year: string, file: string) => {
  const p = path.join(FEEDS, year, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const toArray = <T,>(v: T | T[] | null | undefined): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];

describe('reconstructed AFL brackets', () => {
  const years = Object.keys(SEASONS).sort();

  it('covers the seasons MFL left empty, and only those', () => {
    expect(years.length).toBeGreaterThanOrEqual(18);
    for (const year of years) {
      const feed = readFeed(year, 'playoff-brackets.json');
      // Never shadow a season MFL actually reported (2024-25).
      expect(
        Object.keys(feed?.brackets ?? {}).length,
        `${year} has real MFL bracket data and must not be reconstructed`
      ).toBe(0);
    }
  });

  it('produces brackets the page renderer accepts', () => {
    for (const year of years) {
      for (const [id, payload] of Object.entries<any>(SEASONS[year])) {
        const normalized = normalizePlayoffBracket(payload, { id });
        expect(normalized, `${year} bracket ${id} failed to normalize`).toBeTruthy();
        expect(normalized!.rounds.length).toBeGreaterThan(0);
        for (const round of normalized!.rounds) {
          expect(round.games.length).toBeGreaterThan(0);
          for (const game of round.games) {
            // Both sides must be concrete franchises with scores — a seed-only
            // ref is exactly what made MFL's own export useless here.
            expect(game.home.franchise_id).toMatch(/^\d{4}$/);
            expect(game.away.franchise_id).toMatch(/^\d{4}$/);
            expect(Number(game.home.points)).toBeGreaterThan(0);
            expect(Number(game.away.points)).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('every emitted game is a real game from that season’s schedule', () => {
    // The whole method rests on these being actual results, not simulated ones.
    for (const year of years) {
      const weeks = toArray<any>(readFeed(year, 'schedule.json')?.schedule?.weeklySchedule);
      for (const payload of Object.values<any>(SEASONS[year])) {
        for (const round of toArray<any>(payload.playoffBracket.playoffRound)) {
          const scheduled = toArray<any>(
            weeks.find((w) => String(w.week) === String(round.week))?.matchup
          ).map((m) => toArray<any>(m.franchise).map((f) => f.id).sort().join('|'));
          for (const game of toArray<any>(round.playoffGame)) {
            const key = [game.home.franchise_id, game.away.franchise_id].sort().join('|');
            expect(
              scheduled,
              `${year} week ${round.week}: ${key} is not a real matchup`
            ).toContain(key);
          }
        }
      }
    }
  });

  it('crowns the champion the league’s own record crowns', () => {
    for (const year of years) {
      const known = CHAMPS.get(year);
      if (!known) continue;
      const final = SEASONS[year]['1'].playoffBracket.playoffRound.at(-1).playoffGame.at(-1);
      const winner =
        Number(final.home.points) >= Number(final.away.points)
          ? final.home.franchise_id
          : final.away.franchise_id;
      expect(winner, `${year} reconstructed champion disagrees with the record`).toBe(
        known.champion
      );
    }
  });

  // Commissioner-verified from the league's own results pages (2026-08-12).
  // 2005 and 2008 are the load-bearing pair: the official placement table lists
  // a DIFFERENT second place (Da Dangsters / Dan Marino's Tan Isotoners) because
  // AFL finishing order comes from the consolation bracket, not from losing the
  // title game. The title game itself is what these pin.
  const TITLE_GAMES: Array<[string, string, string]> = [
    ['2005', '0013', '0001'], // Cougs def. Smokane
    ['2006', '0003', '0015'], // Marriedwithchildren def. The Blunt Bros.
    ['2007', '0007', '0020'], // Chatmaster def. Limp Ditkas
    ['2008', '0023', '0006'], // No Frills def. More Cowbell
    ['2019', '0005', '0014'], // Computer Jocks def. Thundering Herd
  ];

  it.each(TITLE_GAMES)('%s title game: %s beat %s', (year, champion, runnerUp) => {
    const final = SEASONS[year]['1'].playoffBracket.playoffRound.at(-1).playoffGame.at(-1);
    const [win, lose] =
      Number(final.home.points) >= Number(final.away.points)
        ? [final.home, final.away]
        : [final.away, final.home];
    expect(win.franchise_id).toBe(champion);
    expect(lose.franchise_id).toBe(runnerUp);
  });

  it('splits the modern era into AL, NL and a final; keeps the old era whole', () => {
    // 2003-2017 bracket 1 IS the 8-team field; 2018+ it is only the 2-team
    // final fed by separate conference brackets. Getting this backwards seeds
    // the walk with the top ONE team per conference and produced the wrong
    // 2019 champion during development.
    expect(Object.keys(SEASONS['2005'])).toEqual(['1']);
    expect(Object.keys(SEASONS['2019']).sort()).toEqual(['1', '2', '3']);
    const final2019 = SEASONS['2019']['1'].playoffBracket.playoffRound;
    expect(final2019).toHaveLength(1);
    expect(final2019[0].playoffGame).toHaveLength(1);
  });

  it('leaves 2003, 2004 and 2011 unreconstructed rather than guessing', () => {
    // Their playoff fields were not top-N-per-conference (2003's bracket is
    // even named "Conference Championships"). All three already have curated
    // champions, so a guess could only overwrite known-good data.
    for (const year of ['2003', '2004', '2011']) {
      expect(SEASONS[year], `${year} should not be reconstructed`).toBeUndefined();
    }
  });
});
