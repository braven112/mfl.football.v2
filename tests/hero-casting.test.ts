import { describe, it, expect } from 'vitest';
import {
  castRookieModel,
  castEnhancementModel,
  castRosterModel,
  castArticleModel,
  heroModelHasCutout,
  castTopFreeAgentModel,
  castBestScoredModel,
  castRandomStarterModel,
  castClosingAuctionModel,
  castRookiesOnBoard,
  castShowcasePanels,
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

describe('castRandomStarterModel', () => {
  // Two NFL teams: NE (1,2,3,4) and SEA (5,6,7,8), descending projection.
  const players = mapOf(
    player({ mflId: '1', nflTeam: 'NE' }),
    player({ mflId: '2', nflTeam: 'NE' }),
    player({ mflId: '3', nflTeam: 'NE' }),
    player({ mflId: '4', nflTeam: 'NE' }),
    player({ mflId: '5', nflTeam: 'SEA' }),
    player({ mflId: '6', nflTeam: 'SEA' }),
    player({ mflId: '7', nflTeam: 'SEA', headshot: MFL('7') }), // no cutout
    player({ mflId: '8', nflTeam: 'SEA' }),
  );
  const cands = (fr = '') => [
    { playerId: '1', franchiseId: fr, score: 20 },
    { playerId: '2', franchiseId: fr, score: 15 },
    { playerId: '3', franchiseId: fr, score: 3 },
    { playerId: '4', franchiseId: fr, score: 0 }, // zero projection — never a starter
    { playerId: '5', franchiseId: fr, score: 18 },
    { playerId: '6', franchiseId: fr, score: 9 },
    { playerId: '7', franchiseId: fr, score: 22 }, // top SEA but no cutout — excluded
    { playerId: '8', franchiseId: fr, score: 6 },
  ];

  it('rotates among likely starters (top perTeam by projection, both teams), excluding zero-proj and photoless', () => {
    const picks = new Set(
      Array.from({ length: 25 }, (_, d) =>
        castRandomStarterModel(
          cands(),
          players,
          undefined,
          new Date(`2026-08-${String(1 + d).padStart(2, '0')}T12:00:00-07:00`),
          'Kickoff Night',
          2, // top 2 per team
        )?.mflId,
      ),
    );
    // NE top-2 = 1,2 · SEA top-2 compositable = 5,6 (7 excluded: no cutout). 3,4,8 out.
    expect([...picks].sort()).toEqual(['1', '2', '5', '6']);
  });

  it('is deterministic within a PT day', () => {
    const a = castRandomStarterModel(cands(), players, undefined, JUL_4, 'Kickoff Night', 2);
    const b = castRandomStarterModel(cands(), players, undefined, new Date('2026-07-04T22:00:00-07:00'), 'Kickoff Night', 2);
    expect(a?.mflId).toBe(b?.mflId);
    expect(a?.descriptor).toBe('Kickoff Night');
  });

  it("narrows to the signed-in owner's likely starters, else the whole pool", () => {
    const mixed = [
      { playerId: '1', franchiseId: '0002', score: 20 },
      { playerId: '2', franchiseId: '0001', score: 15 },
      { playerId: '5', franchiseId: '0002', score: 18 },
      { playerId: '6', franchiseId: '0001', score: 9 },
    ];
    const owned = new Set(
      Array.from({ length: 20 }, (_, d) =>
        castRandomStarterModel(mixed, players, '0001', new Date(`2026-08-${String(1 + d).padStart(2, '0')}T12:00:00-07:00`), 'x', 4)?.mflId,
      ),
    );
    expect([...owned].sort()).toEqual(['2', '6']); // only 0001's players
    // Guest with no players in the game → full pool
    expect(castRandomStarterModel(mixed, players, '0099', JUL_4, 'x', 4)).not.toBeNull();
  });

  it('returns null when nothing qualifies', () => {
    expect(castRandomStarterModel([], players, undefined, JUL_4, 'x')).toBeNull();
    expect(
      castRandomStarterModel([{ playerId: '4', franchiseId: '', score: 0 }], players, undefined, JUL_4, 'x'),
    ).toBeNull();
  });

  it('excludes non-finite (NaN) projections from a malformed feed', () => {
    const cands = [
      { playerId: '1', franchiseId: '', score: NaN },
      { playerId: '2', franchiseId: '', score: 12 },
    ];
    expect(castRandomStarterModel(cands, players, undefined, JUL_4, 'x', 8)?.mflId).toBe('2');
    expect(
      castRandomStarterModel([{ playerId: '1', franchiseId: '', score: NaN }], players, undefined, JUL_4, 'x'),
    ).toBeNull();
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

describe('castArticleModel', () => {
  const players = mapOf(
    player({ mflId: '10', name: 'Ja Marr Chase', position: 'WR', nflTeam: 'CIN' }),
    player({ mflId: '12', position: 'DEF' }),           // no ESPN cutout
    player({ mflId: '13', headshot: MFL('13') }),        // MFL photo, no cutout
  );

  it('casts the exact featured player with the given descriptor', () => {
    const model = castArticleModel('10', players, 'Top Pickup');
    expect(model?.mflId).toBe('10');
    expect(model?.name).toBe('Ja Marr Chase');
    expect(model?.descriptor).toBe('Top Pickup');
  });

  it('returns null when no hero id is set (old posts)', () => {
    expect(castArticleModel(undefined, players, 'Top Pickup')).toBeNull();
    expect(castArticleModel('', players)).toBeNull();
  });

  it('returns null only for unknown ids (→ classic card fallback)', () => {
    expect(castArticleModel('99', players)).toBeNull();
  });

  it('still casts DEF / non-ESPN players — the team logo becomes the art', () => {
    // The generator named the genuinely-featured player; swapping faces would
    // betray the story. The render layer checks heroModelHasCutout.
    const def = castArticleModel('12', players);
    const mflPhoto = castArticleModel('13', players);
    expect(def?.mflId).toBe('12');
    expect(mflPhoto?.mflId).toBe('13');
    expect(heroModelHasCutout(def!)).toBe(false);
    expect(heroModelHasCutout(mflPhoto!)).toBe(false);
    expect(heroModelHasCutout(castArticleModel('10', players)!)).toBe(true);
  });

  it('is deterministic — no daily rotation, same id in → same model out', () => {
    expect(castArticleModel('10', players)?.mflId).toBe('10');
    expect(castArticleModel('10', players)?.mflId).toBe('10');
  });
});

describe('castShowcasePanels', () => {
  const players = mapOf(
    player({ mflId: '1' }),
    player({ mflId: '2', position: 'DEF' }),        // not a person
    player({ mflId: '3', headshot: MFL('3') }),      // no ESPN cutout
    player({ mflId: '4' }),
    player({ mflId: '5' }),
  );

  it('keeps compositable candidates in filed order and remembers the franchise', () => {
    const candidates = [
      { playerId: '1', franchiseId: '0001' },
      { playerId: '2', franchiseId: '0002' }, // DEF — dropped
      { playerId: '3', franchiseId: '0003' }, // MFL photo — dropped
      { playerId: '4', franchiseId: '0004' },
      { playerId: '5', franchiseId: '0005' },
    ];
    const panels = castShowcasePanels(candidates, players);
    expect(panels.map((p) => p.mflId)).toEqual(['1', '4', '5']);
    expect(panels.map((p) => p.franchiseId)).toEqual(['0001', '0004', '0005']);
    expect(panels[0].descriptor).toBe('Tagged');
  });

  it('honors a custom descriptor', () => {
    const panels = castShowcasePanels([{ playerId: '1', franchiseId: '0001' }], players, 8, 'On the Tag');
    expect(panels[0].descriptor).toBe('On the Tag');
  });

  it('caps at count and is deterministic (no rotation, filed order)', () => {
    const candidates = [
      { playerId: '1', franchiseId: '0001' },
      { playerId: '4', franchiseId: '0004' },
      { playerId: '5', franchiseId: '0005' },
    ];
    expect(castShowcasePanels(candidates, players, 2).map((p) => p.mflId)).toEqual(['1', '4']);
    expect(castShowcasePanels([], players)).toEqual([]);
  });

  it('skips unknown ids entirely', () => {
    const candidates = [
      { playerId: '99', franchiseId: '0009' }, // unknown to the map
      { playerId: '4', franchiseId: '0004' },
    ];
    expect(castShowcasePanels(candidates, players).map((p) => p.mflId)).toEqual(['4']);
  });
});
