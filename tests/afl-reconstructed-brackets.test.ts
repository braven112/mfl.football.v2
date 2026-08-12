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
import { buildBracketKindResolver, isNitTitleBracket } from '../src/utils/afl-bracket-kind.mjs';
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

const metasFor = (year: string) =>
  toArray<any>(readFeed(year, 'playoff-brackets.json')?.playoffBrackets?.playoffBracket);
const kindResolverFor = (year: string) => buildBracketKindResolver(metasFor(year));

const teamsIn = (payload: any) =>
  new Set<string>(
    toArray<any>(payload.playoffBracket.playoffRound).flatMap((r: any) =>
      toArray<any>(r.playoffGame).flatMap((g: any) => [g.home.franchise_id, g.away.franchise_id])
    )
  );

/**
 * Every scored game the schedule has in a given week that a bracket could
 * legitimately contain. Two kinds of row are excluded, both MFL artifacts that
 * `pruneRound` drops for the same reason: a `0023 vs 0023` bye, and the stray
 * extra matchup linking two teams already scheduled that week. `phantom` counts
 * the latter so the exemption cannot quietly widen.
 */
const scheduledGames = (year: string, week: number) => {
  const played = toArray<any>(
    toArray<any>(readFeed(year, 'schedule.json')?.schedule?.weeklySchedule).find(
      (w) => Number(w.week) === week
    )?.matchup
  )
    .map((m) => toArray<any>(m.franchise))
    .filter((f) => f.length === 2 && f[0].id !== f[1].id)
    .filter((f) => Number(f[0].score) || Number(f[1].score));

  const appearances = new Map<string, number>();
  for (const f of played) {
    for (const side of f) appearances.set(side.id, (appearances.get(side.id) ?? 0) + 1);
  }
  const real = played.filter(
    (f) => appearances.get(f[0].id) === 1 || appearances.get(f[1].id) === 1
  );
  return {
    games: real.map((f) => [f[0].id, f[1].id].sort().join('|')),
    phantom: played.length - real.length,
  };
};

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
  // These beat MFL's placement table, which cannot be trusted for the AFL: the
  // league used custom bracketWinnerTitle labels extensively, and MFL renders a
  // custom title as a finishing position it does not mean. That is why 2005's
  // table shows Da Dangsters 2nd when they actually finished THIRD — they won
  // the AFL Losers Bracket, whose winner takes 3rd place. Second place is the
  // title-game loser, which is what these pin.
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
    expect(SEASONS['2005']['1'].playoffBracket.playoffRound).toHaveLength(3);
    expect(SEASONS['2005']['2']).toBeTruthy(); // AFL Losers Bracket, not the AL
    expect(SEASONS['2019']['2']).toBeTruthy(); // AL Championship
    expect(SEASONS['2019']['3']).toBeTruthy(); // NL Championship
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
      // Located by NAME — the NIT is bracket 3 in 2005, 4 in 2006, 5 in
      // 2007-2017 and 6 in 2018+, and its own consolation brackets are named
      // "NIT ..." too, so only the title bracket qualifies.
      const meta = toArray<any>(
        readFeed(year, 'playoff-brackets.json')?.playoffBrackets?.playoffBracket
      ).find((b) => isNitTitleBracket(b?.name));
      const payload = SEASONS[year][String(meta?.id)];
      return { id: String(meta?.id), rounds: payload?.playoffBracket.playoffRound.length, payload };
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
      // The two tournaments partition the league's 24 franchises. Their own
      // consolation brackets are drawn from their own side, so compare sides,
      // not individual brackets.
      for (const year of years) {
        const kindOf = kindResolverFor(year);
        const sideTeams = { nit: new Set<string>(), championship: new Set<string>() };
        for (const [id, payload] of Object.entries<any>(SEASONS[year])) {
          const bucket = kindOf(id) === 'nit' ? 'nit' : 'championship';
          for (const team of teamsIn(payload)) sideTeams[bucket].add(team);
        }
        expect(sideTeams.nit.size, `${year} NIT side`).toBe(16);
        expect(sideTeams.championship.size, `${year} championship side`).toBe(8);
        for (const team of sideTeams.nit) {
          expect(
            sideTeams.championship.has(team),
            `${year}: ${team} plays on both sides of the postseason`
          ).toBe(false);
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

  describe('the consolation and placement brackets', () => {
    // These are the brackets that decide where a team actually FINISHED, and
    // for the NIT side they decide draft order. They cannot be seeded from the
    // standings — their fields are made of losers — so they are solved by
    // consuming the games the championship and NIT walks left behind. The proof
    // that the solve is right is that nothing is left over.

    it('reconstructs every postseason bracket the season declared', () => {
      for (const year of years) {
        const kindOf = kindResolverFor(year);
        const declared = metasFor(year)
          .filter((b) => kindOf(b.id) !== 'cup')
          .filter((b) => Number(b.startWeek) >= 13)
          .map((b) => String(b.id))
          .sort();
        expect(Object.keys(SEASONS[year]).sort(), `${year} bracket coverage`).toEqual(declared);
      }
    });

    it('assigns every playoff game to exactly one bracket, and invents none', () => {
      // The whole method rests on this. A game claimed twice means two brackets
      // are showing the same matchup; a game left over means a bracket is
      // missing a round, or the wrong teams were seeded into one.
      let phantomRows = 0;
      for (const year of years) {
        const claimed = new Map<string, string[]>();
        let firstWeek = Infinity;
        let lastWeek = 0;
        for (const [id, payload] of Object.entries<any>(SEASONS[year])) {
          for (const round of toArray<any>(payload.playoffBracket.playoffRound)) {
            const week = Number(round.week);
            firstWeek = Math.min(firstWeek, week);
            lastWeek = Math.max(lastWeek, week);
            for (const g of toArray<any>(round.playoffGame)) {
              const key = `${week}:${[g.home.franchise_id, g.away.franchise_id].sort().join('|')}`;
              claimed.set(key, [...(claimed.get(key) ?? []), id]);
            }
          }
        }
        for (const [key, ids] of claimed) {
          expect(ids, `${year} ${key} claimed by multiple brackets`).toHaveLength(1);
        }
        for (let week = firstWeek; week <= lastWeek; week++) {
          const { games, phantom } = scheduledGames(year, week);
          phantomRows += phantom;
          for (const pair of games) {
            expect(
              claimed.has(`${week}:${pair}`),
              `${year} week ${week}: ${pair} was played but belongs to no bracket`
            ).toBe(true);
          }
        }
      }
      // 2013, 2014 and 2015 week 14. If this number moves, a real game is being
      // written off as an artifact — check the schedule before touching it.
      expect(phantomRows, 'schedule rows excluded as duplicates').toBe(3);
    });

    it('gives each bracket the number of teams MFL says it has', () => {
      for (const year of years) {
        const metas = new Map(metasFor(year).map((b) => [String(b.id), b]));
        for (const [id, payload] of Object.entries<any>(SEASONS[year])) {
          const expected = Number(metas.get(id)?.teamsInvolved);
          if (!expected) continue;
          expect(teamsIn(payload).size, `${year} bracket ${id} (${metas.get(id)?.name})`).toBe(
            expected
          );
        }
      }
    });

    // The load-bearing pins, and the reason to trust the solve. The AFL's own
    // results pages list Da Dangsters 2nd in 2005 and Dan Marino's Tan Isotoners
    // 2nd in 2008 — both wrong, an artifact of MFL rendering the league's custom
    // bracket titles as finishing positions. Each actually won the consolation
    // bracket, i.e. finished THIRD. The reconstruction lands on exactly those
    // two teams from the schedule alone, which is independent corroboration of
    // both the solve and the commissioner's correction.
    it.each([
      ['2005', '2', '0021'], // AFL Losers Bracket — Da Dangsters
      ['2008', '2', '0013'], // AFL Consolation Bracket — Dan Marino's Tan Isotoners
    ])('%s bracket %s is won by %s', (year, bracketId, winner) => {
      const final = SEASONS[year][bracketId].playoffBracket.playoffRound.at(-1).playoffGame.at(-1);
      const won =
        Number(final.home.points) >= Number(final.away.points) ? final.home : final.away;
      expect(won.franchise_id).toBe(winner);
      // ...and they are NOT the team that lost the title game, which is 2nd.
      const title = SEASONS[year]['1'].playoffBracket.playoffRound.at(-1).playoffGame.at(-1);
      const runnerUp =
        Number(title.home.points) >= Number(title.away.points) ? title.away : title.home;
      expect(runnerUp.franchise_id).not.toBe(winner);
    });

    it('never reads a finishing position out of MFL bracket titles', () => {
      // The AFL wrote custom bracketWinnerTitle strings for years ("#1 Pick in
      // 2nd Round", "*NIT 3rd Place or 6th Place"), and MFL renders them as
      // placements they do not mean. The solver must key off games only.
      const script = readFileSync(
        path.join(ROOT, 'scripts/reconstruct-afl-playoff-brackets.mjs'),
        'utf8'
      );
      const code = script.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(code).not.toContain('bracketWinnerTitle');
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
