/**
 * The playoff field: how many teams each league seeds, and whether the derived
 * data agrees with MFL's own declaration of it.
 *
 * This is the check that was missing when the AFL restructured its postseason
 * in 2018. Every playoff appearance in the repo — the division report's berth
 * counts, `franchise-history`'s `playoffAppearances`, owner tenures, badges —
 * is derived from ONE set of bracket ids, and that set was hardcoded to `1`.
 * From 2018 the AFL seeds its eight teams through `2 AL Championship` and
 * `3 NL Championship`, leaving `1 AFL Championship` as the two-team final, so
 * the derived data reported FOUR OR FIVE berths a season in a league that has
 * seeded exactly eight every year since 2003. It rendered as a plausible
 * number on every page that consumes it — the failure mode this file exists
 * to make impossible.
 *
 * The assertion is a conservation law, not a policy claim: berths counted in
 * the ledger must equal the field MFL's own bracket metadata declares. A
 * league that genuinely changes its playoff size stays green.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import {
  getChampionshipFieldSize,
  getEntryBracketIds,
  hasDeclaredEntryBrackets,
} from '../src/utils/playoff-entry-brackets.mjs';

const ROOT = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const leagues = (ALL_LEAGUES as any[])
  .map((league) => ({
    league,
    ledgerPath: path.join(ROOT, league.dataPath, 'derived/season-ledger.json'),
    feedsDir: path.join(ROOT, league.dataPath, 'mfl-feeds'),
  }))
  .filter((l) => existsSync(l.ledgerPath) && existsSync(l.feedsDir));

it('has leagues to check', () => {
  expect(leagues.length).toBeGreaterThan(0);
});

describe.each(leagues)('$league.slug playoff field', ({ league, ledgerPath, feedsDir }) => {
  const ledger = readJson(ledgerPath);
  const played: any[] = ledger.rows.filter((r: any) => !r.seasonNotStarted);
  const years: number[] = [...new Set<number>(played.map((r) => Number(r.year)))].sort(
    (a, b) => a - b
  );

  const bracketsFor = (year: number) => {
    const p = path.join(feedsDir, String(year), 'playoff-brackets.json');
    return existsSync(p) ? readJson(p) : null;
  };

  it('seeds exactly as many teams as MFL says it does, every season', () => {
    const mismatches: string[] = [];
    for (const year of years) {
      const brackets = bracketsFor(year);
      const declared = brackets ? getChampionshipFieldSize(league.slug, brackets) : 0;
      // A season whose export declares no field cannot be checked against one.
      if (!declared) continue;
      const berths = played.filter(
        (r: any) => r.year === year && r.playoffResult && r.playoffResult !== 'missed'
      ).length;
      // Zero berths is an in-progress season, not a disagreement: winners are
      // only recorded once the season completes.
      if (berths === 0) continue;
      if (berths !== declared) {
        mismatches.push(
          `${year}: ${berths} berths in the ledger, ${declared} seats in brackets ` +
            `[${getEntryBracketIds(league.slug, brackets).join(', ')}]`
        );
      }
    }
    expect(mismatches, 'derived playoff berths disagree with the declared field').toEqual([]);
  });

  it('never routes a team into the playoffs through a placement or consolation bracket', () => {
    // The entry brackets decide who "made the playoffs". A 3rd-place game or a
    // losers' bracket is somewhere a team arrives after entering, so counting
    // its seats would inflate the field — the mirror of the bug above.
    const offenders: string[] = [];
    for (const year of years) {
      const brackets = bracketsFor(year);
      if (!brackets) continue;
      const metas = new Map(
        ([] as any[])
          .concat(brackets.playoffBrackets?.playoffBracket ?? [])
          .map((b: any) => [String(b.id), String(b.name ?? '')])
      );
      for (const id of getEntryBracketIds(league.slug, brackets)) {
        const name = metas.get(id);
        if (name === undefined) continue;
        if (/place|consolation|loser|toilet|NIT|AFL Cup/i.test(name)) {
          offenders.push(`${year}: entry bracket ${id} is "${name}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The resolver's own edges, on synthetic payloads.
 *
 * These cases cannot be reached through the committed feeds — which is exactly
 * why they need their own test. The predicted-bracket payload below is
 * generated at FETCH time and only lands on disk when a season has no real
 * bracket data, so a suite that only reads what is committed would never see
 * it and would report the hazard as covered.
 */
describe('entry-bracket resolution edges', () => {
  /** Verbatim shape of `generatePredictedBrackets` in scripts/fetch-mfl-feeds.mjs. */
  const THELEAGUE_SHAPE = [
    { startWeek: '15', teamsInvolved: '7', id: '1', name: 'The League Championship' },
    { startWeek: '17', teamsInvolved: '2', id: '2', name: 'The Consolation Bracket' },
    { startWeek: '15', teamsInvolved: '5', id: '3', name: "The Loser's Bracket" },
    { startWeek: '15', teamsInvolved: '7', id: '5', name: 'The Toilet Bowl Challenge' },
    { startWeek: '17', teamsInvolved: '2', id: '6', name: 'The Toilet Bowl Consolation' },
    { startWeek: '16', teamsInvolved: '4', id: '7', name: 'The Toilet Bowl Consolation 2' },
  ];
  const AFL_MODERN = [
    { startWeek: '17', teamsInvolved: '2', id: '1', name: 'AFL Championship' },
    { startWeek: '15', teamsInvolved: '4', id: '2', name: 'AL Championship' },
    { startWeek: '15', teamsInvolved: '4', id: '3', name: 'NL Championship' },
    { startWeek: '17', teamsInvolved: '2', id: '4', name: 'AFL 3rd Place Game' },
    { startWeek: '16', teamsInvolved: '4', id: '5', name: 'AFL 5th Place Game' },
    { startWeek: '15', teamsInvolved: '16', id: '6', name: 'NIT Championship' },
  ];
  const payload = (metas: unknown[], extra: object = {}) => ({
    playoffBrackets: { playoffBracket: metas },
    ...extra,
  });

  it('never seeds a playoff field through a consolation or toilet bowl bracket', () => {
    // generatePredictedBrackets hardcodes TheLeague's shape and writes it into
    // whichever league is being fetched — roster-sync.yml runs the AFL through
    // the same script. Before the name filter, the AFL resolver answered
    // ['1','3','5'] here: a nineteen-team field in a league that seeds eight.
    for (const slug of ['afl-fantasy', 'theleague']) {
      const ids = getEntryBracketIds(slug, payload(THELEAGUE_SHAPE));
      expect(ids, `${slug} entry brackets`).toEqual(['1']);
      expect(getChampionshipFieldSize(slug, payload(THELEAGUE_SHAPE))).toBe(7);
    }
  });

  it('reads no field at all from a predicted payload', () => {
    // Predicted brackets carry no franchise ids, so they can never name a
    // participant; all they can contribute is a guessed field size. Refusing
    // them means an unplayed season earns nobody a playoff appearance.
    for (const slug of ['afl-fantasy', 'theleague']) {
      const predicted = payload(THELEAGUE_SHAPE, { predicted: true });
      expect(getChampionshipFieldSize(slug, predicted), slug).toBe(0);
      expect(hasDeclaredEntryBrackets(slug, predicted), slug).toBe(false);
    }
  });

  it('splits the modern AFL field across both conference brackets', () => {
    expect(getEntryBracketIds('afl-fantasy', payload(AFL_MODERN))).toEqual(['2', '3']);
    expect(getChampionshipFieldSize('afl-fantasy', payload(AFL_MODERN))).toBe(8);
    expect(hasDeclaredEntryBrackets('afl-fantasy', payload(AFL_MODERN))).toBe(true);
  });

  it('reports an unreadable export as undeclared rather than guessing bracket 1', () => {
    // The reconstruction fallback keys off this: with no metadata the ids
    // default to ['1'], which for a modern AFL season is the two-team final.
    for (const empty of [null, {}, payload([])]) {
      expect(hasDeclaredEntryBrackets('afl-fantasy', empty as any)).toBe(false);
      expect(getEntryBracketIds('afl-fantasy', empty as any)).toEqual(['1']);
    }
  });
});
