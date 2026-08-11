/**
 * Guards the "don't credit a division title mid-season" rule.
 *
 * scripts/compute-afl-awards.mjs takes the first row of each division in MFL's
 * official standings order as that division's champion. Standings exist from
 * week 1, so without this guard the weekly afl-tier-rollover workflow — which
 * COMMITS awards-history.json — would write four in-progress division titles
 * onto the trophy wall and churn them every Monday until the season ended.
 */
import { describe, it, expect } from 'vitest';
import { isSeasonComplete } from '../scripts/lib/afl-season-complete.mjs';

const CHAMP = { 'afl-championship': { franchiseId: '0015' } };

describe('isSeasonComplete', () => {
  it('treats any past season as complete, brackets or not', () => {
    expect(isSeasonComplete(2025, {}, 2026)).toBe(true);
    expect(isSeasonComplete(2004, null, 2026)).toBe(true);
    expect(isSeasonComplete(2004, undefined, 2026)).toBe(true);
    // Pre-2016 seasons never carry auto-derived brackets — they must still pass.
    expect(isSeasonComplete(2015, {}, 2026)).toBe(true);
  });

  it('withholds the CURRENT season until its playoffs resolve a champion', () => {
    // Kickoff through the regular season: standings exist, titles must not.
    expect(isSeasonComplete(2026, {}, 2026)).toBe(false);
    expect(isSeasonComplete(2026, null, 2026)).toBe(false);
    // Other brackets resolving is not enough — the championship decides it.
    expect(isSeasonComplete(2026, { nit: { franchiseId: '0012' } }, 2026)).toBe(false);
    // A bracket entry with no winner yet (unplayed final) does not count.
    expect(isSeasonComplete(2026, { 'afl-championship': { franchiseId: null } }, 2026)).toBe(false);
  });

  it('releases the current season the moment a champion is crowned', () => {
    expect(isSeasonComplete(2026, CHAMP, 2026)).toBe(true);
  });

  it('never credits a FUTURE season', () => {
    expect(isSeasonComplete(2027, {}, 2026)).toBe(false);
  });

  it('compares numerically, not as strings', () => {
    // hostFor()/JSON round-trips can hand back string years; "2025" < "2026"
    // happens to work lexically but "999" < "2026" would not.
    expect(isSeasonComplete('2025' as unknown as number, {}, 2026)).toBe(true);
    expect(isSeasonComplete(2026, {}, '2026' as unknown as number)).toBe(false);
  });
});
