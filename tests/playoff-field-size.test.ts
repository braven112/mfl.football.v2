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
  getBracketFinalWinner,
  getChampionshipFieldSize,
  getEntryBracketIds,
  getEntryBracketParticipants,
  getThirdPlaceBracketId,
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

  /** The AFL's rebuilt brackets; null for a league that has none. */
  const reconstructedPath = path.join(
    ROOT,
    league.dataPath,
    'derived/reconstructed-playoff-brackets.json'
  );
  const reconstructed = existsSync(reconstructedPath)
    ? readJson(reconstructedPath).seasons ?? {}
    : {};
  const reconstructedFor = (year: number) => reconstructed[String(year)] ?? null;

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

  it('never crowns the champion or runner-up its own third place', () => {
    // The invariant whose violation WAS the bug. `getChampionshipResult` read
    // third place out of a hardcoded `brackets['2']`, which for the AFL from
    // 2018 is `AL Championship` — a conference semifinal whose winner always
    // goes on to win or lose the final. A third-place finisher lost before the
    // final by definition, so a value equal to either is proof the wrong
    // bracket was read. It stayed invisible for eight seasons because the
    // caller's champion/runner-up branches claimed the row first, and the
    // symptom was silence: third place recorded in 0 of the AFL's 23 seasons.
    const offenders: string[] = [];
    for (const year of years) {
      const rows = played.filter((r: any) => r.year === year);
      const third = rows.filter((r: any) => r.playoffResult === 'third-place');
      // At most one per season, and never the top two.
      expect(third.length, `${year}: ${third.length} third-place finishers`).toBeLessThanOrEqual(1);
      if (!third.length) continue;
      const id = third[0].franchiseId;
      const top = rows
        .filter((r: any) => r.playoffResult === 'champion' || r.playoffResult === 'runner-up')
        .map((r: any) => r.franchiseId);
      if (top.includes(id)) offenders.push(`${year}: ${id} is third AND ${top.join('/')}`);
      // A third place with no final above it is incoherent — you cannot lose
      // before a game that was never played. (Asserting the row is not
      // 'missed' would be tautological: `third` is filtered on that value.)
      expect(top.length, `${year}: third place recorded with no champion/runner-up`).toBe(2);
      // And they have to have been IN the playoffs, which the row's own label
      // cannot tell us: compute-franchise-history adds champResult.thirdPlace
      // to playoffParticipants unconditionally and then stamps the row, so a
      // franchise resolved out of the wrong bracket would award itself both
      // the berth and the label. Ask the entry brackets instead.
      const brackets = bracketsFor(year);
      const field = brackets
        ? getEntryBracketParticipants(brackets, getEntryBracketIds(league.slug, brackets))
        : new Set<string>();
      if (field.size) {
        expect([...field], `${year}: third place ${id} was not in the playoff field`).toContain(id);
      }
    }
    expect(offenders, 'third place collides with the top two').toEqual([]);
  });

  it('resolves third place from a bracket that decides third place', () => {
    // Resolved by NAME, so assert the name — an id-keyed reader is what this
    // whole file exists to catch, and it fails silently rather than loudly.
    const offenders: string[] = [];
    for (const year of years) {
      const brackets = bracketsFor(year);
      if (!brackets) continue;
      const id = getThirdPlaceBracketId(league.slug, brackets);
      if (!id) continue;
      const meta = ([] as any[])
        .concat(brackets.playoffBrackets?.playoffBracket ?? [])
        .find((b: any) => String(b.id) === id);
      const name = String(meta?.name ?? '');
      // Either it says "3rd place", or it is the championship-side
      // consolation/losers bracket whose final decides third. Never the NIT's
      // or the Toilet Bowl's — those run their own placement games.
      const ok =
        /3rd place/i.test(name) || /\b(consolation|loser'?s?)\b/i.test(name);
      if (!ok || /NIT|AFL Cup|toilet/i.test(name)) {
        offenders.push(`${year}: bracket ${id} is "${name}"`);
      }
    }
    expect(offenders, 'third place read from a bracket that does not decide it').toEqual([]);
  });

  it('recovers every third place the brackets can actually resolve', () => {
    // A regression here means a season quietly stopped being recoverable — the
    // failure mode that hid this bug is silence, so the seasons are pinned
    // rather than left to "well, some of them have it".
    //
    // Scoped to seasons the DERIVED data already calls finished, because the
    // two sides of this comparison are refreshed on different clocks: the feed
    // is synced every few minutes and the ledger is rebuilt once a day. Without
    // the scope, the hours between week 17's third-place game scoring and that
    // night's rebuild are a red `main` — the sibling assertion above skips the
    // same window via its `berths === 0` guard.
    const settled = years.filter((year) =>
      played.some((r: any) => r.year === year && r.playoffResult === 'champion')
    );
    const unrecovered: string[] = [];
    for (const year of settled) {
      const brackets = bracketsFor(year);
      if (!brackets) continue;
      const id = getThirdPlaceBracketId(league.slug, brackets);
      if (!id) continue;
      const rec = reconstructedFor(year);
      const winner =
        getBracketFinalWinner(brackets, id) ?? (rec ? getBracketFinalWinner(rec, id) : null);
      if (!winner) continue;
      const rows = played.filter((r: any) => r.year === year);
      const top = rows
        .filter((r: any) => r.playoffResult === 'champion' || r.playoffResult === 'runner-up')
        .map((r: any) => r.franchiseId);
      // Production discards a winner that collides with the top two rather than
      // publishing it (resolveThirdPlace), so a season it legitimately rejected
      // is not an unrecovered one — asserting otherwise reports the guard
      // working as a failure.
      if (top.includes(winner)) continue;
      const recorded = rows.some((r: any) => r.playoffResult === 'third-place');
      if (!recorded) unrecovered.push(`${year}: bracket ${id} resolves ${winner}`);
    }
    // Every season the data CAN answer must be answered. Seasons it cannot
    // (TheLeague's bracket 2 is absent from the feed for 16 of 19 years, and
    // there is no reconstruction for that league) are legitimately empty.
    expect(unrecovered, 'third place is resolvable but unrecorded').toEqual([]);
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
