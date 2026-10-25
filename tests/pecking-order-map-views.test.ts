import { describe, expect, it } from 'vitest';
import {
  computeRankView,
  movers,
  sizeForRank,
  type RankMapPin,
} from '../src/components/shared/owner-map/pecking-order-map-views';

const city = (name: string) => ({ name, region: 'WA', lat: 47, lng: -122 });

const pin = (rank: number, previousRank: number | null, placed = true): RankMapPin => ({
  franchiseId: String(rank).padStart(4, '0'),
  rank,
  previousRank,
  teamName: `Team ${rank}`,
  icon: '/icon.png',
  href: `/theleague/franchises/${rank}`,
  city: placed ? city(`City ${rank}`) : null,
});

describe('Pecking Order map views', () => {
  const pins = [pin(1, 3), pin(2, 1), pin(3, 2, false), pin(4, 4), pin(5, 9), pin(6, 5)];

  it('top: spotlights the top three and fades everyone else', () => {
    const view = computeRankView(pins, 'top');
    const big = view.marks.filter((m) => !m.faded).map((m) => pins[m.index].rank);
    expect(big).toEqual([1, 2]);
    expect(view.marks.find((m) => pins[m.index].rank === 1)?.tag).toBe('1');
    expect(view.marks.filter((m) => m.faded)).toHaveLength(3);
    // No. 3 has no hometown: it is not drawn, and the caption says why.
    expect(view.marks.some((m) => pins[m.index].rank === 3)).toBe(false);
    expect(view.caption).toContain("Team 3 hasn't picked a hometown yet.");
  });

  it('order: every placed team, sized by rank, ringed by movement', () => {
    const view = computeRankView(pins, 'order');
    expect(view.marks).toHaveLength(5);
    const byRank = new Map(view.marks.map((m) => [pins[m.index].rank, m]));
    expect(byRank.get(1)!.size).toBeGreaterThan(byRank.get(6)!.size);
    expect(byRank.get(1)!.ring).toBe('up');
    expect(byRank.get(2)!.ring).toBe('down');
    expect(byRank.get(4)!.ring).toBeNull();
    expect(view.caption).toContain("1 haven't picked");
  });

  it('movers: only big moves, biggest climb first', () => {
    expect(movers(pins).map((i) => pins[i].rank)).toEqual([5, 1]);
    const view = computeRankView(pins, 'movers');
    expect(view.marks.find((m) => pins[m.index].rank === 5)?.tag).toBe('▲4');
    expect(view.marks.find((m) => pins[m.index].rank === 2)?.faded).toBe(true);
  });

  it('movers: at most three climbers and three fallers', () => {
    const busy = [pin(1, 9), pin(2, 8), pin(3, 7), pin(4, 6), pin(5, 1), pin(6, 2), pin(7, 3), pin(8, 4), pin(9, 5)];
    expect(movers(busy).map((i) => busy[i].rank)).toEqual([1, 2, 3, 5, 6, 7]);
    expect(computeRankView(busy, 'movers').caption).toBe(
      'Climbing: Team 1, Team 2 and Team 3. Falling: Team 5, Team 6 and Team 7.',
    );
  });

  it('movers: falls back to one-place moves when nobody moved two', () => {
    const quiet = [pin(1, 2), pin(2, 1), pin(3, 3)];
    expect(movers(quiet).map((i) => quiet[i].rank)).toEqual([1, 2]);
    expect(computeRankView([pin(1, 1), pin(2, 2)], 'movers').caption).toBe('Nobody moved this week.');
  });

  it('sizes run from largest at No. 1 to smallest in last place', () => {
    expect(sizeForRank(1, 16)).toBe(46);
    expect(sizeForRank(16, 16)).toBe(26);
    expect(sizeForRank(1, 1)).toBe(46);
  });
});
