/**
 * Trade-proposal beats — the drip layer's guard.
 *
 * Every assertion here is a claim Schefter would otherwise be free to publish
 * about a real owner's roster or about the league as a whole. The two that
 * matter most:
 *
 *   - The lane sees only the proposals owners self-reported (`commish sourced 0`
 *     on every scan since the league-wide read went quiet), so any count over
 *     "all proposals" is a FLOOR. A counting beat without `atLeast` invites the
 *     prompt to print "exactly three teams have asked", which we cannot know.
 *   - A player can only be listed on his OWN owner's block, so "not on anybody's
 *     block" is exact when we hold that franchise's block and a fabrication when
 *     we don't. `blockByFid` is a Map for that reason and a missing franchise
 *     must DROP the beat, never default it to "not listed".
 */
import { describe, it, expect } from 'vitest';
import {
  BEAT_KINDS,
  buildDealShape,
  buildExpiryBeat,
  buildMarketBeats,
  planBeats,
  plannedPlayerCount,
  unlockedBeatCount,
} from '../scripts/lib/schefter-offer-beats.mjs';
import { redactTradeOffer } from '../scripts/lib/redact-trade-offer.mjs';

const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const chase = { kind: 'player', playerId: '13116', name: "Ja'Marr Chase", position: 'WR' };
const hall = { kind: 'player', playerId: '14833', name: 'Breece Hall', position: 'RB' };
const bench = { kind: 'player', playerId: '99999', name: 'Some Bench Guy', position: 'TE' };
const pick = { kind: 'pick', label: '2027 3rd' };

describe('plannedPlayerCount — a name every other signal', () => {
  it('holds names back on the even signals', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(plannedPlayerCount)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });

  it('never un-reveals a name that has already shipped', () => {
    let previous = 0;
    for (let signal = 1; signal <= 24; signal += 1) {
      const count = plannedPlayerCount(signal);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it('unlocks one beat per even signal, in step with the held-back names', () => {
    expect([1, 2, 3, 4, 5, 6].map(unlockedBeatCount)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('buildDealShape — the deal from the NAMED team\'s side', () => {
  it('keeps each side attached to the franchise giving it up', () => {
    const shape = buildDealShape({
      namedFid: '0001',
      sidesByFid: { '0001': [chase], '0003': [pick] },
    });
    expect(shape).toMatchObject({
      direction: 'selling',
      sends: { players: 1, positions: ['WR'], picks: [] },
      gets: { players: 0, positions: [], picks: ['2027 3rd'] },
    });
  });

  it('reads as buying from the other side of the same proposal', () => {
    const shape = buildDealShape({
      namedFid: '0003',
      sidesByFid: { '0001': [chase], '0003': [pick] },
    });
    expect(shape!.direction).toBe('buying');
    expect(shape!.gets.positions).toEqual(['WR']);
  });

  it('calls players-both-ways a swap', () => {
    const shape = buildDealShape({
      namedFid: '0001',
      sidesByFid: { '0001': [chase], '0003': [hall] },
    });
    expect(shape!.direction).toBe('swap');
  });

  it('returns null without a named team — nobody to describe', () => {
    expect(buildDealShape({ namedFid: null, sidesByFid: { '0001': [chase] } })).toBeNull();
  });
});

describe('buildExpiryBeat — MFL\'s own clock on the proposal', () => {
  it('grades urgency by hours remaining', () => {
    const at = (hours: number) =>
      buildExpiryBeat({
        rawOffer: { expires: String(Math.round((NOW + hours * HOUR) / 1000)) },
        nowMs: NOW,
      });
    expect(at(6)!.urgency).toBe('today');
    expect(at(36)!.urgency).toBe('soon');
    expect(at(120)!.urgency).toBe('this_week');
  });

  it('drops an expiry that has passed or is beyond any felt horizon', () => {
    const at = (hours: number) =>
      buildExpiryBeat({
        rawOffer: { expires: String(Math.round((NOW + hours * HOUR) / 1000)) },
        nowMs: NOW,
      });
    expect(at(-1)).toBeNull();
    expect(at(15 * 24)).toBeNull();
    expect(buildExpiryBeat({ rawOffer: { expires: '0' }, nowMs: NOW })).toBeNull();
    expect(buildExpiryBeat({ rawOffer: {}, nowMs: NOW })).toBeNull();
  });
});

describe('buildMarketBeats — only what the feeds can actually see', () => {
  const sidesByFid = { '0001': [chase, hall], '0003': [bench] };

  it('reports "in talks, not listed" only for a franchise whose block we hold', () => {
    const beats = buildMarketBeats({
      namedFid: '0001',
      sidesByFid,
      // 0003's block is absent — we cannot say whether Some Bench Guy is listed.
      blockByFid: new Map([['0001', new Set(['14833'])]]),
      playerHistory: new Map(),
      positionRuns: new Map(),
      nameablePlayerIds: new Set(),
    });
    const subjects = beats.filter((b: any) => b.kind === BEAT_KINDS.IN_TALKS_NOT_LISTED);
    // Chase is unlisted on a block we DO hold → beat. Hall is listed → no beat.
    // Bench Guy's owner is unknown to us → no beat, despite being unlisted in
    // every block we hold.
    expect(subjects).toHaveLength(1);
    expect(subjects[0].subject).toEqual({ position: 'WR' });
  });

  it('never prints a player name outside the nameable set', () => {
    const beats = buildMarketBeats({
      namedFid: '0001',
      sidesByFid,
      blockByFid: new Map([['0001', new Set()], ['0003', new Set()]]),
      playerHistory: new Map([['13116', 4], ['14833', 3], ['99999', 5]]),
      positionRuns: new Map(),
      nameablePlayerIds: new Set(['13116']),
    });
    const named = beats
      .map((b: any) => b.subject?.name)
      .filter(Boolean);
    expect(named.every((n: string) => n === "Ja'Marr Chase")).toBe(true);
    expect(named).not.toContain('Breece Hall');
    expect(named).not.toContain('Some Bench Guy');
  });

  it('marks every count as a floor — the lane cannot see all proposals', () => {
    const beats = buildMarketBeats({
      namedFid: '0001',
      sidesByFid,
      blockByFid: new Map(),
      playerHistory: new Map([['13116', 3]]),
      positionRuns: new Map([['WR', 5]]),
      nameablePlayerIds: new Set(),
    });
    const counting = beats.filter((b: any) =>
      b.kind === BEAT_KINDS.THIRD_DESK || b.kind === BEAT_KINDS.POSITION_RUN,
    );
    expect(counting.length).toBeGreaterThan(0);
    for (const beat of counting) expect(beat.atLeast).toBe(true);
  });

  it('holds counting beats below their floor', () => {
    const beats = buildMarketBeats({
      namedFid: '0001',
      sidesByFid,
      blockByFid: new Map(),
      playerHistory: new Map([['13116', 1]]),
      positionRuns: new Map([['WR', 2]]),
      nameablePlayerIds: new Set(),
    });
    expect(beats.some((b: any) => b.kind === BEAT_KINDS.THIRD_DESK)).toBe(false);
    expect(beats.some((b: any) => b.kind === BEAT_KINDS.POSITION_RUN)).toBe(false);
  });

  it('block_stale states what is listed and never that nobody called', () => {
    const beats = buildMarketBeats({
      namedFid: '0001',
      sidesByFid,
      blockByFid: new Map([['0001', new Set(['14833', '55555'])]]),
      playerHistory: new Map(),
      positionRuns: new Map(),
      nameablePlayerIds: new Set(),
    });
    const stale = beats.find((b: any) => b.kind === BEAT_KINDS.BLOCK_STALE);
    expect(stale).toBeDefined();
    // 55555 is listed and not in this deal; 14833 is listed but IS in the deal.
    expect(stale!.notInThisDealCount).toBe(1);
    expect(stale!.listedCount).toBe(2);
    // No field asserts anything about interest — absence of a proposal we can
    // see is not absence of a call.
    expect(Object.keys(stale!).sort()).toEqual(['kind', 'listedCount', 'notInThisDealCount']);
  });
});

describe('planBeats — the rotation', () => {
  const dealShape = { direction: 'selling', sends: {}, gets: {} } as any;
  const expiryBeat = { kind: BEAT_KINDS.EXPIRY, urgency: 'this_week', hoursRemaining: 100, daysRemaining: 4 };
  const marketBeats = [
    { kind: BEAT_KINDS.IN_TALKS_NOT_LISTED, subject: { position: 'WR' } },
    { kind: BEAT_KINDS.THIRD_DESK, subject: { position: 'RB' }, deskCount: 3, atLeast: true },
  ];

  it('reveals one new beat per even signal and never takes one back', () => {
    let previous = 0;
    for (let signal = 1; signal <= 8; signal += 1) {
      const { beats } = planBeats({ signal, dealShape, expiryBeat, marketBeats });
      expect(beats.length).toBeGreaterThanOrEqual(previous);
      previous = beats.length;
    }
  });

  it('leads on the team, then the shape, then a name, then a beat', () => {
    const lead = (signal: number) =>
      planBeats({ signal, dealShape, expiryBeat, marketBeats }).leadKind;
    expect(lead(1)).toBe('team');
    expect(lead(2)).toBe(BEAT_KINDS.DEAL_SHAPE);
    expect(lead(3)).toBe('player');
    expect(lead(4)).toBe(BEAT_KINDS.IN_TALKS_NOT_LISTED);
    expect(lead(5)).toBe('player');
    expect(lead(6)).toBe(BEAT_KINDS.THIRD_DESK);
  });

  it('never leads on the same fact twice running', () => {
    const leads = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (signal) => planBeats({ signal, dealShape, expiryBeat, marketBeats }).leadKind,
    );
    for (let i = 1; i < leads.length; i += 1) {
      expect(leads[i]).not.toBe(leads[i - 1]);
    }
  });

  it('lets a deadline inside two days jump the queue', () => {
    const urgent = { ...expiryBeat, urgency: 'soon' };
    const { leadKind } = planBeats({ signal: 4, dealShape, expiryBeat: urgent, marketBeats });
    expect(leadKind).toBe(BEAT_KINDS.EXPIRY);
  });
});

describe('redactTradeOffer — beats reach the tip without widening the names', () => {
  const playerMap = new Map([
    ['13116', { name: "Ja'Marr Chase", position: 'WR' }],
    ['14833', { name: 'Breece Hall', position: 'RB' }],
    ['15255', { name: 'Dylan Laube', position: 'RB' }],
  ]);
  const teamMap = new Map([
    ['0001', { name: 'Pacific Pigskins', division: 'East' }],
    ['0003', { name: 'Maverick', division: 'West' }],
  ]);
  const args = (exposureCount: number) => ({
    rawOffer: {
      id: 'beat_test_1',
      franchise: '0001',
      franchise2: '0003',
      franchise1_gave_up: '13116,14833',
      franchise2_gave_up: '15255',
      // Five days out: far enough that the expiry beat takes its rotation slot
      // rather than jumping the queue.
      expires: String(Math.round((NOW + 120 * HOUR) / 1000)),
    },
    offeringFid: '0001',
    playerMap,
    teamMap,
    counts: { ownerOfferCount7d: 1, divisionOfferCount7d: 0, playerHistory: new Map() },
    currentYear: 2026,
    exposureCount,
    adpRankByPlayerId: new Map([['13116', 1], ['14833', 8], ['15255', 40]]),
    // Both blocks held and empty: every player in the proposal is genuinely
    // unlisted, so the cross-reference beat fires for both sides.
    blockByFid: new Map([['0001', new Set<string>()], ['0003', new Set<string>()]]),
    positionRuns: new Map(),
    nowMs: NOW,
  });

  it('ships a beat on the signal that ships no new name', () => {
    const { tip } = redactTradeOffer(args(1) as any);
    expect(tip.exposure!.players).toEqual([]);
    expect(tip.beats!.length).toBeGreaterThan(0);
    expect(tip.leadKind).not.toBe('player');
  });

  it('never names, inside a beat, a player exposure has not already printed', () => {
    // The invariant that matters: `exposure.players` is the authoritative name
    // surface, and the drip layer must not become a second one. The other
    // franchise's players are never in it at any signal, so they must stay at
    // position level however far the ladder runs.
    for (let exposureCount = 0; exposureCount <= 10; exposureCount += 1) {
      const { tip } = redactTradeOffer(args(exposureCount) as any);
      const allowed = new Set((tip.exposure?.players ?? []).map((p: any) => p.name));
      for (const beat of tip.beats ?? []) {
        const name = (beat as any).subject?.name;
        if (name) expect(allowed.has(name)).toBe(true);
      }
      // Dylan Laube is on the other side of the deal — never nameable here.
      expect(JSON.stringify(tip.beats ?? [])).not.toContain('Dylan Laube');
    }
  });

  it('lets a beat use a name once exposure has printed it', () => {
    const { tip } = redactTradeOffer(args(5) as any);
    const printed = (tip.exposure!.players ?? []).map((p: any) => p.name);
    expect(printed.length).toBeGreaterThan(0);
    const named = (tip.beats ?? [])
      .map((b: any) => b.subject?.name)
      .filter(Boolean);
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((n: string) => printed.includes(n))).toBe(true);
  });

  it('leaves the exposure block at exactly its three published fields', () => {
    const { tip } = redactTradeOffer(args(4) as any);
    expect(Object.keys(tip.exposure!).sort()).toEqual(['players', 'signal', 'team']);
  });
});
