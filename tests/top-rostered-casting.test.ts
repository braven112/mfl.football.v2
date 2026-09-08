/**
 * `castTopRosteredModel` — the league's best players, for a hero about the
 * LEAGUE rather than about a transaction.
 *
 * It is the mirror of `castTopFreeAgentModel`, and the mirroring is the whole
 * risk: the two walk the same dynasty-ADP list and differ only in which side
 * of `rosteredIds` they keep. Inverting that test by accident casts the
 * schedule release with whoever is unclaimed — the opposite of a marquee face,
 * and it would look completely normal on screen.
 */
import { describe, it, expect } from 'vitest';
import { castTopRosteredModel, castTopFreeAgentModel } from '../src/utils/hero-casting';
import type { PlayerIdentity } from '../src/utils/player-map';

const ESPN = (id: string) => `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;

const player = (mflId: string, name: string): PlayerIdentity =>
  ({ mflId, name, position: 'WR', nflTeam: 'CIN', headshot: ESPN(mflId) }) as PlayerIdentity;

// ADP order: best first.
const RANKED = ['1', '2', '3', '4', '5', '6', '7'];
const PLAYERS = new Map(RANKED.map((id) => [id, player(id, `Player ${id}`)]));
const AT = new Date('2026-09-08T18:00:00Z');

describe('castTopRostered — the league\'s best', () => {
  it('keeps ROSTERED players, the opposite side from the free-agent caster', () => {
    const rostered = new Set(['3', '4', '5']);
    const top = castTopRosteredModel(PLAYERS, AT, rostered, RANKED, 'Top 5 Overall');
    const fa = castTopFreeAgentModel(PLAYERS, AT, rostered, RANKED);

    expect(rostered.has(top!.mflId), 'the marquee face must be someone a club rosters').toBe(true);
    expect(rostered.has(fa!.mflId), 'the free-agent caster must pick the other side').toBe(false);
    expect(top!.mflId).not.toBe(fa!.mflId);
  });

  it('draws from the top of the ADP list, not just anyone rostered', () => {
    // 1 and 2 are rostered and are the two best players in the league. With a
    // pool of 2 the pick must be one of them, never the rostered no. 7.
    const rostered = new Set(['1', '2', '7']);
    const picks = new Set<string>();
    for (let d = 1; d <= 14; d++) {
      const m = castTopRosteredModel(PLAYERS, new Date(`2026-09-${String(d).padStart(2, '0')}T18:00:00Z`), rostered, RANKED, 'Top 5 Overall', 2);
      picks.add(m!.mflId);
    }
    expect([...picks].sort()).toEqual(['1', '2']);
  });

  it('rotates across days so one face does not own the phase', () => {
    const rostered = new Set(RANKED);
    const seen = new Set<string>();
    for (let d = 1; d <= 21; d++) {
      const m = castTopRosteredModel(PLAYERS, new Date(`2026-09-${String(d).padStart(2, '0')}T18:00:00Z`), rostered, RANKED, 'Top 5 Overall');
      seen.add(m!.mflId);
    }
    expect(seen.size, 'a daily rotation that never rotates is a constant').toBeGreaterThan(1);
  });

  it('is stable within a single Pacific day', () => {
    const rostered = new Set(RANKED);
    const morning = castTopRosteredModel(PLAYERS, new Date('2026-09-08T16:00:00Z'), rostered, RANKED, 'Top 5 Overall');
    const evening = castTopRosteredModel(PLAYERS, new Date('2026-09-08T23:00:00Z'), rostered, RANKED, 'Top 5 Overall');
    expect(morning!.mflId).toBe(evening!.mflId);
  });

  it('refuses to cast when the rosters feed is empty, rather than picking a free agent', () => {
    // An empty roster set means the feed failed to read — a real league always
    // rosters someone. Casting anyway would silently hand back the ADP leader
    // as though a club owned him.
    expect(castTopRosteredModel(PLAYERS, AT, new Set(), RANKED, 'Top 5 Overall')).toBeNull();
  });

  it('carries the descriptor the caller asked for', () => {
    const m = castTopRosteredModel(PLAYERS, AT, new Set(RANKED), RANKED, 'Top 5 Overall');
    expect(m!.descriptor).toBe('Top 5 Overall');
  });
});
