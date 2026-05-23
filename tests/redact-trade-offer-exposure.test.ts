/**
 * Phase 6c — Trade-offer graduated exposure ladder.
 *
 * Each time the dice roll lands on the same offer, Schefter reveals more:
 *   signal 1 → name 1 team only
 *   signal 2 → team + 1 marquee player (highest ADP dynasty rank)
 *   signal 3 → team + 2 players
 *   signal N → team + (N-1) players in marquee order
 *
 * Tests exercise the redactor directly (not source-string grep) so the
 * ladder math is locked in even if the prompt text drifts.
 */
import { describe, it, expect } from 'vitest';
import { redactTradeOffer } from '../scripts/lib/redact-trade-offer.mjs';

type RedactorArgs = Parameters<typeof redactTradeOffer>[0];

function buildArgs(overrides: Partial<RedactorArgs> = {}): RedactorArgs {
  const rawOffer = {
    id: 'offer_test_1',
    franchise: '0001',
    franchise2: '0002',
    // Side 1 (franchise 0001 gives) — two players + a future 1st
    franchise1_gave_up: '17472,15201,FP_2027_0001_1',
    // Side 2 (franchise 0002 gives) — one player + a current pick
    franchise2_gave_up: '16161,DP_01_03',
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const playerMap = new Map<string, { name: string; position: string; nflTeam: string }>([
    ['17472', { name: "Ja'Marr Chase", position: 'WR', nflTeam: 'CIN' }],
    ['15201', { name: 'Breece Hall', position: 'RB', nflTeam: 'NYJ' }],
    ['16161', { name: 'Some Bench Guy', position: 'TE', nflTeam: 'CHI' }],
  ]);
  const teamMap = new Map<string, { name: string; nameShort: string; division: string }>([
    ['0001', { name: 'Pacific Pigskins', nameShort: 'Pigskins', division: 'Pacific' }],
    ['0002', { name: 'Midwestside Connection', nameShort: 'Midwestside', division: 'Central' }],
  ]);
  // Chase is rank 1 (best), Hall is rank 5, Bench Guy is rank 100.
  const adpRankByPlayerId = new Map<string, number>([
    ['17472', 1],
    ['15201', 5],
    ['16161', 100],
  ]);
  return {
    rawOffer,
    offeringFid: '0001',
    playerMap,
    teamMap,
    counts: {
      ownerOfferCount7d: 1,
      divisionOfferCount7d: 0,
      playerHistory: new Map(),
    },
    currentYear: 2026,
    framingHint: 'fresh',
    offerAgeMs: 0,
    exposureCount: 0,
    adpRankByPlayerId,
    ...overrides,
  } as RedactorArgs;
}

describe('redactTradeOffer — exposure ladder', () => {
  it('signal 1 (priorExposure=0): names exactly one team, zero players', () => {
    const { tip } = redactTradeOffer(buildArgs({ exposureCount: 0 }));
    expect(tip.exposure).toBeDefined();
    expect(tip.exposure!.signal).toBe(1);
    expect(tip.exposure!.team.name).toMatch(/Pigskins|Midwestside/);
    expect(tip.exposure!.players).toEqual([]);
  });

  it('signal 2 (priorExposure=1): team + marquee player (highest ADP)', () => {
    const { tip } = redactTradeOffer(buildArgs({ exposureCount: 1 }));
    expect(tip.exposure!.signal).toBe(2);
    expect(tip.exposure!.players).toHaveLength(1);
    // Chase (rank 1) is the marquee piece.
    expect(tip.exposure!.players[0].name).toBe("Ja'Marr Chase");
    expect(tip.exposure!.players[0].position).toBe('WR');
  });

  it('signal 3 (priorExposure=2): team + top 2 players in marquee order', () => {
    const { tip } = redactTradeOffer(buildArgs({ exposureCount: 2 }));
    expect(tip.exposure!.signal).toBe(3);
    expect(tip.exposure!.players.map((p: any) => p.name)).toEqual([
      "Ja'Marr Chase",
      'Breece Hall',
    ]);
  });

  it('signal N: caps at the number of players actually in the offer', () => {
    // Only 3 players in this offer; signal=10 should expose all 3, not synthesize.
    const { tip } = redactTradeOffer(buildArgs({ exposureCount: 9 }));
    expect(tip.exposure!.signal).toBe(10);
    expect(tip.exposure!.players).toHaveLength(3);
    expect(tip.exposure!.players[0].name).toBe("Ja'Marr Chase");
    expect(tip.exposure!.players[2].name).toBe('Some Bench Guy');
  });

  it('team pick is deterministic across signal levels (same offerId → same team)', () => {
    const args1 = buildArgs({ exposureCount: 0 });
    const args2 = buildArgs({ exposureCount: 1 });
    const args3 = buildArgs({ exposureCount: 5 });
    const t1 = redactTradeOffer(args1).tip.exposure!.team.name;
    const t2 = redactTradeOffer(args2).tip.exposure!.team.name;
    const t3 = redactTradeOffer(args3).tip.exposure!.team.name;
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
  });

  it('different offerIds can pick different teams (coin-flip is per-offer)', () => {
    // Try a handful of offer ids and confirm we see both franchises represented
    // somewhere. The hash is deterministic, so this either passes or fails for
    // every run consistently — but with 20 offers we'd expect a near-even split.
    const teams = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const args = buildArgs({
        rawOffer: {
          id: `offer_${i}`,
          franchise: '0001',
          franchise2: '0002',
          franchise1_gave_up: '17472',
          franchise2_gave_up: '16161',
          timestamp: '0',
        } as RedactorArgs['rawOffer'],
        exposureCount: 0,
      });
      teams.add(redactTradeOffer(args).tip.exposure!.team.name);
    }
    expect(teams.size).toBe(2);
  });

  it('falls back gracefully when ADP rank map is absent', () => {
    const { tip } = redactTradeOffer(
      buildArgs({ exposureCount: 1, adpRankByPlayerId: undefined }),
    );
    expect(tip.exposure!.players).toHaveLength(1);
    // Without ADP, ordering tie-breaks on playerId — exact pick doesn't matter,
    // just that we got a valid named player from the offer.
    expect(tip.exposure!.players[0].name).toMatch(/Chase|Hall|Some Bench Guy/);
  });

  it('omits exposure block when both franchises are missing from teamMap', () => {
    const { tip } = redactTradeOffer(
      buildArgs({
        exposureCount: 0,
        teamMap: new Map(),
      }),
    );
    expect(tip.exposure).toBeUndefined();
  });
});
