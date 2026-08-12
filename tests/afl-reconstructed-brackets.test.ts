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
    // (Bracket 3 in 2005 and 6 in 2019 are the NIT — covered below.)
    expect(Object.keys(SEASONS['2005']).sort()).toEqual(['1', '3']);
    expect(SEASONS['2005']['1'].playoffBracket.playoffRound).toHaveLength(3);

    expect(Object.keys(SEASONS['2019']).sort()).toEqual(['1', '2', '3', '6']);
    const final2019 = SEASONS['2019']['1'].playoffBracket.playoffRound;
    expect(final2019).toHaveLength(1);
    expect(final2019[0].playoffGame).toHaveLength(1);
  });

  it('never puts the same franchise in a round twice', () => {
    // Three archived rounds carry a stray matchup pairing two teams already
    // scheduled that week (2014 + 2015 NIT week 14), and 2012 week 14 has an
    // outright `0023 vs 0023` bye row — which rendered as a fifth
    // quarterfinal, a team playing itself. pruneRound drops them.
    for (const year of years) {
      for (const [id, payload] of Object.entries<any>(SEASONS[year])) {
        for (const round of toArray<any>(payload.playoffBracket.playoffRound)) {
          const seen = new Set<string>();
          for (const game of toArray<any>(round.playoffGame)) {
            for (const side of [game.home.franchise_id, game.away.franchise_id]) {
              expect(
                seen.has(side),
                `${year} bracket ${id} week ${round.week}: ${side} plays twice`
              ).toBe(false);
              seen.add(side);
            }
          }
        }
      }
    }
    // The case that shipped broken: 2012's quarterfinals are four games.
    expect(SEASONS['2012']['1'].playoffBracket.playoffRound[0].playoffGame).toHaveLength(4);
  });

  describe('the NIT', () => {
    // 16 of the AFL's 24 franchises, so for most owners this IS their
    // postseason. Its field is the exact complement of the championship field,
    // which is why it needs no seeding assumption of its own.
    const nitBracketFor = (year: string) => {
      // Located by round count, not id — the NIT is bracket 3 in 2005, 4 in
      // 2006, 5 in 2007-2017 and 6 in 2018+, and it is the only 4-round bracket.
      let best: any = null;
      for (const [id, payload] of Object.entries<any>(SEASONS[year])) {
        const rounds = payload.playoffBracket.playoffRound.length;
        if (!best || rounds > best.rounds) best = { id, rounds, payload };
      }
      return best;
    };

    it('is reconstructed for every season, with a full 16-team shape', () => {
      for (const year of years) {
        const nit = nitBracketFor(year);
        expect(nit.rounds, `${year} has no 4-round NIT bracket`).toBe(4);
        const games = nit.payload.playoffBracket.playoffRound.map(
          (r: any) => r.playoffGame.length
        );
        // 16 teams single-elimination: 8 -> 4 -> 2 -> 1.
        expect(games, `${year} NIT round sizes`).toEqual([8, 4, 2, 1]);
      }
    });

    it('never overlaps the championship field', () => {
      for (const year of years) {
        const nitId = nitBracketFor(year).id;
        const ids = (payload: any) =>
          new Set<string>(
            toArray<any>(payload.playoffBracket.playoffRound).flatMap((r: any) =>
              toArray<any>(r.playoffGame).flatMap((g: any) => [
                g.home.franchise_id,
                g.away.franchise_id,
              ])
            )
          );
        const nitTeams = ids(SEASONS[year][nitId]);
        for (const [id, payload] of Object.entries<any>(SEASONS[year])) {
          if (id === nitId) continue;
          for (const team of ids(payload)) {
            expect(
              nitTeams.has(team),
              `${year}: ${team} appears in both the NIT and bracket ${id}`
            ).toBe(false);
          }
        }
      }
    });

    it('crowns the NIT champion the awards ledger crowns', () => {
      // Compared by franchise id: the ledger stores each franchise's CURRENT
      // name, so 2018's winner is "Pubes" in the feed and "Suh girls, one cup"
      // in the ledger — the same team, id 0012.
      const awards = new Map(
        ((require('../data/afl-fantasy/awards-history.json') as any).seasons ?? []).map(
          (s: any) => [String(s.year), s.awards ?? {}]
        )
      );
      let checked = 0;
      for (const year of years) {
        const ref = (awards.get(year) as any)?.nit;
        if (!ref?.franchiseId) continue;
        const final = nitBracketFor(year).payload.playoffBracket.playoffRound.at(-1).playoffGame.at(-1);
        const winner =
          Number(final.home.points) >= Number(final.away.points)
            ? final.home.franchise_id
            : final.away.franchise_id;
        expect(winner, `${year} NIT champion`).toBe(ref.franchiseId);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
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
