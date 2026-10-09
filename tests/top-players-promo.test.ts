/**
 * The homepage Top Players poster (src/utils/top-players-promo.ts): who gets
 * cast. It reads the Top Players page's own derived file, so these pin the
 * casting rules, not the data.
 */
import { describe, it, expect } from 'vitest';
import { pickBannerPlayer, pickTopPlayersPromo } from '../src/utils/top-players-promo';
import type { TopPlayerRow, TopPlayersFile } from '../src/types/top-players';

const row = (id: string, position: string, posRank: number, total: number, espnId: string | null = id): TopPlayerRow => ({
  id, name: `Player ${id}`, position, team: 'BUF', espnId, owners: [], weeks: {}, total, avg: 0, games: 4, best: 0, rank: 0, posRank,
});

const file = (players: TopPlayerRow[], completedWeeks = [1, 2, 3, 4]): TopPlayersFile => ({
  seasonYear: 2026, startWeek: 1, endWeek: 17, lastRegularSeasonWeek: 14, completedWeeks, positions: [], players,
});

describe('pickTopPlayersPromo', () => {
  it('casts the No. 1 QB, RB, WR and TE in that order, and the top scorer as the headline', () => {
    const promo = pickTopPlayersPromo(file([
      row('1', 'WR', 1, 100), row('2', 'QB', 1, 123), row('3', 'RB', 1, 101), row('4', 'TE', 1, 69),
      row('5', 'QB', 2, 110), row('6', 'PK', 1, 200),
    ]))!;
    expect(promo.players.map((p) => p.id)).toEqual(['2', '3', '1', '4']);
    expect(promo.leader.id).toBe('2');
    expect(promo.throughWeek).toBe(4);
  });

  it('skips a position leader with no ESPN photo for the next one down', () => {
    const promo = pickTopPlayersPromo(file([
      row('1', 'QB', 1, 130, null), row('2', 'QB', 2, 120), row('3', 'RB', 1, 100), row('4', 'WR', 1, 90),
    ]))!;
    expect(promo.players[0].id).toBe('2');
  });

  it('shows nothing before a week is played, or with too few faces', () => {
    expect(pickTopPlayersPromo(file([row('1', 'QB', 1, 1)], []))).toBeNull();
    expect(pickTopPlayersPromo(file([row('1', 'QB', 1, 1), row('2', 'RB', 1, 1)]))).toBeNull();
    expect(pickTopPlayersPromo(null)).toBeNull();
  });
});

describe('pickBannerPlayer', () => {
  const promo = pickTopPlayersPromo(file([
    row('1', 'QB', 1, 123), row('2', 'RB', 1, 101), row('3', 'WR', 1, 100), row('4', 'TE', 1, 69),
  ]))!;

  it('can land on any of the four, and only the top scorer is "running the league"', () => {
    const seen = [0, 0.3, 0.6, 0.99].map((r) => pickBannerPlayer(promo, () => r));
    expect(seen.map((s) => s.player.position)).toEqual(['QB', 'RB', 'WR', 'TE']);
    expect(seen[0].tagline).toBe('is running the league');
    expect(seen[1].tagline).toBe('is the No. 1 RB');
  });

  it('never indexes past the end, even if random() returns 1', () => {
    expect(pickBannerPlayer(promo, () => 1).player.position).toBe('TE');
  });
});
