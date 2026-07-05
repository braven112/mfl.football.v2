import { describe, it, expect } from 'vitest';
import {
  castRookieModel,
  castEnhancementModel,
  castRosterModel,
  castTopFreeAgentModel,
  castBestScoredModel,
  castClosingAuctionModel,
  castRookiesOnBoard,
} from '../src/utils/hero-casting';
import type { PlayerIdentity } from '../src/utils/player-map';

const ESPN = (id: string) => `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;
const MFL = (id: string) => `https://www49.myfantasyleague.com/player_photos_big_2014/${id}_thumb.jpg`;

function player(overrides: Partial<PlayerIdentity> & { mflId: string }): PlayerIdentity {
  return {
    name: `Player ${overrides.mflId}`,
    position: 'WR',
    nflTeam: 'CIN',
    headshot: ESPN(overrides.mflId),
    espnId: overrides.mflId,
    draftYear: '',
    ...overrides,
  };
}

function mapOf(...players: PlayerIdentity[]): Map<string, PlayerIdentity> {
  return new Map(players.map((p) => [p.mflId, p]));
}

const JUL_4 = new Date('2026-07-04T12:00:00-07:00');

describe('castRookieModel', () => {
  it('casts only from the most recent draft class', () => {
    const players = mapOf(
      player({ mflId: '1', draftYear: '2026' }),
      player({ mflId: '2', draftYear: '2025' }),
      player({ mflId: '3', draftYear: '2024' }),
    );
    expect(castRookieModel(players, JUL_4)?.mflId).toBe('1');
  });

  it('falls back to the previous class when the reference year class is absent', () => {
    const players = mapOf(
      player({ mflId: '2', draftYear: '2025' }),
      player({ mflId: '3', draftYear: '2024' }),
    );
    // Feb 2026, before the 2026 NFL Draft exists in the feed
    expect(castRookieModel(players, new Date('2026-02-20T12:00:00-08:00'))?.mflId).toBe('2');
  });

  it('ignores future draft classes (bad data)', () => {
    const players = mapOf(
      player({ mflId: '9', draftYear: '2027' }),
      player({ mflId: '1', draftYear: '2026' }),
    );
    expect(castRookieModel(players, JUL_4)?.mflId).toBe('1');
  });

  it('excludes DEF and players without ESPN cutouts', () => {
    const players = mapOf(
      player({ mflId: '1', draftYear: '2026', position: 'DEF' }),
      player({ mflId: '2', draftYear: '2026', headshot: MFL('2') }),
      player({ mflId: '3', draftYear: '2026' }),
    );
    expect(castRookieModel(players, JUL_4)?.mflId).toBe('3');
  });

  it('prefers rostered rookies when a roster set is provided', () => {
    const players = mapOf(
      player({ mflId: '1', draftYear: '2026' }),
      player({ mflId: '2', draftYear: '2026' }),
    );
    expect(castRookieModel(players, JUL_4, new Set(['2']))?.mflId).toBe('2');
    // Roster set with no rookies → falls back to the full class
    expect(castRookieModel(players, JUL_4, new Set(['99']))).not.toBeNull();
  });

  it('is deterministic within a PT day and rotates across days', () => {
    const players = mapOf(
      ...Array.from({ length: 20 }, (_, i) => player({ mflId: String(i + 1), draftYear: '2026' })),
    );
    const a = castRookieModel(players, JUL_4);
    const b = castRookieModel(players, new Date('2026-07-04T21:00:00-07:00'));
    expect(a?.mflId).toBe(b?.mflId);

    const picks = new Set(
      Array.from({ length: 10 }, (_, d) =>
        castRookieModel(players, new Date(`2026-07-${String(5 + d).padStart(2, '0')}T12:00:00-07:00`))?.mflId,
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('returns null when no rookies exist', () => {
    expect(castRookieModel(mapOf(player({ mflId: '1' })), JUL_4)).toBeNull();
    expect(castRookieModel(new Map(), JUL_4)).toBeNull();
  });
});

describe('castEnhancementModel', () => {
  it('casts only rostered players from the last five draft classes', () => {
    const players = mapOf(
      player({ mflId: '1', draftYear: '2026' }),
      player({ mflId: '2', draftYear: '2022' }),
      player({ mflId: '3', draftYear: '2021' }), // 6th year — out of window
      player({ mflId: '4', draftYear: '2024' }), // in window but unrostered
    );
    const picks = new Set(
      Array.from({ length: 20 }, (_, d) =>
        castEnhancementModel(
          players,
          new Date(`2026-07-${String(4 + d).padStart(2, '0')}T12:00:00-07:00`),
          new Set(['1', '2', '3']),
        )?.mflId,
      ),
    );
    expect([...picks].sort()).toEqual(['1', '2']);
  });

  it('labels the pick with the year descriptor', () => {
    const players = mapOf(player({ mflId: '2', draftYear: '2024' }), player({ mflId: '9', draftYear: '2026' }));
    const model = castEnhancementModel(players, JUL_4, new Set(['2']));
    expect(model).toMatchObject({ mflId: '2', descriptor: '3rd Year' });

    const rookiePick = castEnhancementModel(players, JUL_4, new Set(['9']));
    expect(rookiePick).toMatchObject({ mflId: '9', descriptor: 'Rookie' });
  });

  it('returns null when nothing is rostered — no unrostered fallback', () => {
    const players = mapOf(player({ mflId: '1', draftYear: '2026' }));
    expect(castEnhancementModel(players, JUL_4, new Set())).toBeNull();
    expect(castEnhancementModel(players, JUL_4, new Set(['99']))).toBeNull();
  });
});

describe('castTopFreeAgentModel', () => {
  const players = mapOf(
    player({ mflId: '1' }),
    player({ mflId: '2' }),
    player({ mflId: '3' }),
    player({ mflId: '4', position: 'DEF' }),
    player({ mflId: '5', headshot: MFL('5') }),
    player({ mflId: '6' }),
    player({ mflId: '7' }),
    player({ mflId: '8' }),
  );
  const ranked = ['1', '2', '3', '4', '5', '6', '7', '8'];

  it('pools the top N available in rank order, skipping rostered and non-compositable', () => {
    // rostered: 1, 2 · non-compositable: 4 (DEF), 5 (MFL photo) → pool = 3, 6, 7 (poolSize 3)
    const picks = new Set(
      Array.from({ length: 15 }, (_, d) =>
        castTopFreeAgentModel(
          players,
          new Date(`2026-03-${String(10 + d).padStart(2, '0')}T12:00:00-07:00`),
          new Set(['1', '2']),
          ranked,
          3,
        )?.mflId,
      ),
    );
    expect([...picks].sort()).toEqual(['3', '6', '7']);
  });

  it('labels the pick Best Available and is day-stable', () => {
    const a = castTopFreeAgentModel(players, JUL_4, new Set(), ranked);
    const b = castTopFreeAgentModel(players, new Date('2026-07-04T21:00:00-07:00'), new Set(), ranked);
    expect(a?.descriptor).toBe('Best Available');
    expect(a?.mflId).toBe(b?.mflId);
  });

  it('returns null when nothing ranked is available', () => {
    expect(castTopFreeAgentModel(players, JUL_4, new Set(ranked), ranked)).toBeNull();
    expect(castTopFreeAgentModel(players, JUL_4, new Set(), [])).toBeNull();
  });
});

describe('castRookiesOnBoard', () => {
  const players = mapOf(
    player({ mflId: '1', draftYear: '2026' }),
    player({ mflId: '2', draftYear: '2026' }),
    player({ mflId: '3', draftYear: '2026' }),
    player({ mflId: '4', draftYear: '2025' }), // not a rookie
    player({ mflId: '5', draftYear: '2026', headshot: MFL('5') }), // no cutout
    player({ mflId: '6', draftYear: '2026' }),
  );
  const ranked = ['4', '1', '5', '2', '3', '6'];

  it('returns the top-N unrostered rookies in rank order', () => {
    const models = castRookiesOnBoard(players, new Set(['2']), ranked, 4, JUL_4);
    expect(models.map((m) => m.mflId)).toEqual(['1', '3', '6']);
    expect(models[0].descriptor).toBe('UDFA');
  });

  it('caps at count and returns empty when the class is drafted out', () => {
    expect(castRookiesOnBoard(players, new Set(), ranked, 2, JUL_4).map((m) => m.mflId)).toEqual(['1', '2']);
    expect(castRookiesOnBoard(players, new Set(['1', '2', '3', '6']), ranked, 4, JUL_4)).toEqual([]);
  });
});

describe('castClosingAuctionModel', () => {
  const players = mapOf(
    player({ mflId: '1' }),
    player({ mflId: '2' }),
    player({ mflId: '3', headshot: MFL('3') }),
  );

  it('picks the auction with the oldest last-bid anchor (closes first)', () => {
    const auctions = [
      { playerId: '1', anchorTimestamp: 2000 },
      { playerId: '2', anchorTimestamp: 1000 },
    ];
    const model = castClosingAuctionModel(auctions, players);
    expect(model).toMatchObject({ mflId: '2', descriptor: 'Closing Soon' });
  });

  it('falls through to the next-soonest when the player has no cutout', () => {
    const auctions = [
      { playerId: '3', anchorTimestamp: 1000 }, // MFL photo — skipped
      { playerId: '1', anchorTimestamp: 2000 },
    ];
    expect(castClosingAuctionModel(auctions, players)?.mflId).toBe('1');
  });

  it('returns null when nothing resolves', () => {
    expect(castClosingAuctionModel([], players)).toBeNull();
    expect(castClosingAuctionModel([{ playerId: '3', anchorTimestamp: 1 }], players)).toBeNull();
  });
});

describe('castBestScoredModel', () => {
  const players = mapOf(
    player({ mflId: '1' }),
    player({ mflId: '2' }),
    player({ mflId: '3' }),
    player({ mflId: '4', headshot: MFL('4') }),
  );

  it('picks the highest-scored candidate', () => {
    const candidates = [
      { playerId: '1', franchiseId: '0002', score: 18.2 },
      { playerId: '2', franchiseId: '0003', score: 24.6 },
      { playerId: '3', franchiseId: '', score: 21.1 },
    ];
    expect(castBestScoredModel(candidates, players, undefined, 'Kickoff Night')?.mflId).toBe('2');
  });

  it("prefers the signed-in owner's best even when the pool has a higher score", () => {
    const candidates = [
      { playerId: '1', franchiseId: '0001', score: 12.0 },
      { playerId: '2', franchiseId: '0002', score: 24.6 },
      { playerId: '3', franchiseId: '0001', score: 15.5 },
    ];
    expect(castBestScoredModel(candidates, players, '0001', 'Kickoff Night')?.mflId).toBe('3');
    // Owner with nobody in the pool falls back to the overall best
    expect(castBestScoredModel(candidates, players, '0009', 'Kickoff Night')?.mflId).toBe('2');
  });

  it('skips non-compositable candidates and returns null on empty pools', () => {
    expect(
      castBestScoredModel([{ playerId: '4', franchiseId: '', score: 99 }, { playerId: '1', franchiseId: '', score: 1 }], players, undefined, 'x')?.mflId,
    ).toBe('1');
    expect(castBestScoredModel([], players, undefined, 'x')).toBeNull();
  });
});

describe('castRosterModel', () => {
  const players = mapOf(
    player({ mflId: '10' }),
    player({ mflId: '11' }),
    player({ mflId: '12', position: 'DEF' }),
    player({ mflId: '13', headshot: MFL('13') }),
  );

  it('prefers a candidate from the signed-in owner\'s franchise', () => {
    const candidates = [
      { playerId: '10', franchiseId: '0002' },
      { playerId: '11', franchiseId: '0001' },
    ];
    expect(castRosterModel(candidates, players, '0001', JUL_4)?.mflId).toBe('11');
  });

  it('falls back to the league-wide pool for guests and ownerless matches', () => {
    const candidates = [{ playerId: '10', franchiseId: '0002' }];
    expect(castRosterModel(candidates, players, undefined, JUL_4)?.mflId).toBe('10');
    expect(castRosterModel(candidates, players, '0005', JUL_4)?.mflId).toBe('10');
  });

  it('skips unresolvable and non-compositable candidates', () => {
    const candidates = [
      { playerId: '12', franchiseId: '0001' }, // DEF
      { playerId: '13', franchiseId: '0001' }, // MFL photo
      { playerId: '99', franchiseId: '0001' }, // unknown
      { playerId: '10', franchiseId: '0002' },
    ];
    expect(castRosterModel(candidates, players, '0001', JUL_4)?.mflId).toBe('10');
    expect(castRosterModel([{ playerId: '99', franchiseId: '0001' }], players, undefined, JUL_4)).toBeNull();
  });
});
