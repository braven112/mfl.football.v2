/**
 * Player escalation is scoped to the player POOL. The AFL rosters one player
 * in both conferences, so two unrelated deals for him in different
 * conferences must not count as distinct offerers for one name.
 */
import { describe, expect, it } from 'vitest';
import { playerOfferHistoryKey } from '../scripts/schefter-rumor-scan.mjs';

describe('playerOfferHistoryKey', () => {
  it('keeps the legacy key for a single-pool league (TheLeague)', () => {
    expect(playerOfferHistoryKey('12345', undefined)).toBe('schefter:player_offer_history:12345');
    expect(playerOfferHistoryKey('12345', '')).toBe('schefter:player_offer_history:12345');
  });

  it('splits a per-conference league by conference', () => {
    const al = playerOfferHistoryKey('12345', '00');
    const nl = playerOfferHistoryKey('12345', '01');
    expect(al).not.toBe(nl);
    expect(al.endsWith(':00:12345')).toBe(true);
  });
});
