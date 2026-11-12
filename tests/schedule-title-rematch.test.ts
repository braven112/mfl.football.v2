import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildCrossConferencePairs, divisionFinishRanks, pairKey } from '../src/utils/schedule-rules.mjs';
import { seasonShape, titleRematchPair, lastChampionshipFor, SCHEDULE_POLICY } from '../src/utils/schedule-plan.mjs';
import { getLeagueBySlug } from '../src/config/leagues';

/**
 * The AFL's Week 1 title rematch (commissioner, Nov 2026).
 *
 * The title game is the AL champion against the NL champion, and Week 1 is the
 * season's one cross-conference round, so last year's final can be replayed
 * there. The rule: the finalists meet; the two teams they would have drawn
 * under the division-finish formula play each other instead; everyone else
 * keeps the formula. The rematch outranks the protected Computer Jocks vs
 * Jewpacabra game, which sits out any year it shares a finalist.
 *
 * Pinned against REAL finishes: the 2025 final (Mariachi Ninjas vs Avenging
 * Amish) as it would have shaped 2026, and the 2024 final (Balls Deep vs
 * Computer Jocks), which is exactly the conflict case.
 */
const afl = getLeagueBySlug('afl-fantasy')!;
const root = path.resolve(__dirname, '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const feed = (year: number, name: string) => read(`${afl.dataPath}/mfl-feeds/${year}/${name}.json`);
const championships = read(`${afl.dataPath}/championship-history.json`);
const policy = SCHEDULE_POLICY['afl-fantasy'];

/** Week 1 pairs for `year`, with and without the rematch, under the AFL's policy. */
const draw = (year: number, { rematch }: { rematch: boolean }) => {
  const shape = seasonShape(feed(year, 'league'))!;
  const prev = seasonShape(feed(year - 1, 'league'))!;
  const prevRank = divisionFinishRanks(feed(year - 1, 'standings').leagueStandings.franchise, prev.divisionOf);
  const cc = policy.crossConference;
  const divisionPairing = (year - cc.anchorYear) % 2 !== 0 ? cc.alternatePairing : cc.anchorPairing;
  const byName: Record<string, string> = {};
  for (const id of shape.franchiseIds) byName[String((shape.name as Record<string, string>)[id]).trim()] = id;
  const protectedPairs = cc.protectedRivalries
    .filter(([a, b]: string[]) => byName[a] && byName[b])
    .map(([a, b]: string[]) => [byName[a], byName[b]]);
  const last = lastChampionshipFor(championships, year);
  const pairs = buildCrossConferencePairs({
    prevRank,
    divisionPairing,
    protectedPairs,
    rematchPair: (rematch ? [last.champion, last.runnerUp] : null) as any,
    conferenceOf: shape.conferenceOf,
    franchiseIds: shape.franchiseIds,
  });
  return { pairs, last, byName, keys: new Set<string>(pairs.map((p: any) => pairKey(p.away, p.home) as string)) };
};

describe('AFL Week 1 title rematch', () => {
  it('is configured, and only from 2027 (2026 is locked)', () => {
    expect(policy.crossConference.titleRematchSince).toBe(2027);
    const final = { year: 2026, champion: '0001', runnerUp: '0013' };
    expect(titleRematchPair(policy, 2027, final)).toEqual(['0001', '0013']);
    expect(titleRematchPair(policy, 2026, { ...final, year: 2025 })).toBeNull();
    // A stale entry (not last season's) never forces a pair.
    expect(titleRematchPair(policy, 2027, { ...final, year: 2024 })).toBeNull();
    expect(titleRematchPair(policy, 2027, null)).toBeNull();
  });

  it('2025 final → 2026: finalists meet, the two they displaced meet, nobody else moves', () => {
    const before = draw(2026, { rematch: false });
    const after = draw(2026, { rematch: true });
    const { champion, runnerUp } = after.last;
    expect(after.keys.has(pairKey(champion, runnerUp))).toBe(true);
    expect(after.pairs.find((p: any) => p.titleRematch)).toBeTruthy();

    const removed: string[] = [...before.keys].filter((k) => !after.keys.has(k));
    const added: string[] = [...after.keys].filter((k) => !before.keys.has(k));
    // Exactly the swap: the finalists' two formula games become the rematch
    // plus one game between their two former opponents.
    expect(removed).toHaveLength(2);
    expect(added).toHaveLength(2);
    const displaced = removed
      .flatMap((k) => k.split('-'))
      .filter((id) => id !== champion && id !== runnerUp);
    expect(added).toContain(pairKey(displaced[0], displaced[1]));
    expect(after.pairs).toHaveLength(12);
  });

  it('2024 final → 2025: the rematch outranks Computer Jocks vs Jewpacabra', () => {
    const after = draw(2025, { rematch: true });
    const jocks = after.byName['Computer Jocks'];
    const jewpacabra = after.byName.Jewpacabra;
    expect([after.last.champion, after.last.runnerUp]).toContain(jocks);
    expect(after.keys.has(pairKey(after.last.champion, after.last.runnerUp))).toBe(true);
    expect(after.keys.has(pairKey(jocks, jewpacabra))).toBe(false);
    // Everyone still plays exactly one cross-conference game.
    const seen = after.pairs.flatMap((p: any) => [p.away, p.home]);
    expect(new Set(seen).size).toBe(24);
  });
});
