/**
 * Guards the "don't credit a division title mid-season" rule for TheLeague.
 *
 * scripts/compute-franchise-history.mjs takes the first row of each division in
 * MFL's official standings order as that division's winner. Standings exist
 * from week 1, so without this guard the nightly schefter-trade-speculation
 * workflow — which COMMITS franchise-history.json to main — would write four
 * in-progress division titles onto the franchise pages and churn them every
 * night until the season ended (and emit Schefter milestone posts as it did).
 *
 * TheLeague's signal differs from the AFL's: it resolves a `champResult`
 * object (MFL brackets, falling back to the hand-curated
 * championship-history.json), not a bracket-derived awards map.
 */
import { describe, it, expect } from 'vitest';
import { isSeasonComplete } from '../scripts/lib/theleague-season-complete.mjs';

const CHAMP = { champion: '0012', runnerUp: '0009', thirdPlace: '0001' };

describe('isSeasonComplete (TheLeague)', () => {
  it('treats any past season as complete, champion resolved or not', () => {
    expect(isSeasonComplete(2025, CHAMP, 2026)).toBe(true);
    expect(isSeasonComplete(2025, {}, 2026)).toBe(true);
    expect(isSeasonComplete(2007, null, 2026)).toBe(true);
    expect(isSeasonComplete(2007, undefined, 2026)).toBe(true);
  });

  it('withholds the CURRENT season until a champion is crowned', () => {
    // Kickoff through the regular season: standings exist, titles must not.
    expect(isSeasonComplete(2026, {}, 2026)).toBe(false);
    expect(isSeasonComplete(2026, null, 2026)).toBe(false);
    // A result object that exists but names no champion does not count.
    // getChampionshipResult itself returns null outright mid-bracket, but this
    // shape IS reachable: the championship-history.json fallback builds
    // `{ champion: manual.champion ?? null, ... }` whenever an entry has a
    // runnerUp, so a hand-curated year missing its champion lands here.
    expect(isSeasonComplete(2026, { champion: null }, 2026)).toBe(false);
    // Runner-up/third place resolving is not enough on its own.
    expect(isSeasonComplete(2026, { champion: null, thirdPlace: '0001' }, 2026)).toBe(false);
  });

  it('releases the current season the moment a champion is crowned', () => {
    expect(isSeasonComplete(2026, CHAMP, 2026)).toBe(true);
  });

  it('never credits a FUTURE season off standings alone', () => {
    expect(isSeasonComplete(2027, {}, 2026)).toBe(false);
    expect(isSeasonComplete(2027, null, 2026)).toBe(false);
    // NOTE: a future year that somehow carries a resolved champion DOES pass —
    // the champion signal is deliberately not year-gated, same as the AFL's
    // helper. That state is unreachable in practice (MFL cannot crown a
    // champion for a season that has not been played) and treating a resolved
    // champion as authoritative is the whole point of signal 2.
    expect(isSeasonComplete(2027, CHAMP, 2026)).toBe(true);
  });

  it('compares numerically, not as strings', () => {
    // JSON round-trips hand back string years; "2025" < "2026" works lexically
    // but the comparison must not depend on that.
    expect(isSeasonComplete('2025' as unknown as number, {}, 2026)).toBe(true);
    expect(isSeasonComplete(2026, {}, '2026' as unknown as number)).toBe(false);
  });
});
