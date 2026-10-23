/**
 * The mock-draft engine (src/utils/mock-draft-engine.ts) and its store.
 *
 * The engine replaced PartyKit's socket server: the pick clock is a stored
 * deadline and every read catches up what is overdue. These tests lock in
 * the rules PartyKit had (creator-only controls, picking for a controlled
 * team, Go Back not instantly re-picking) and the new ones the move made
 * necessary (a draft nobody watched plays out on its own clock, a stale pick
 * cannot land on the owner's next slot, the actor comes from the server).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { advance, applyAction, needsAdvance, type EngineSession, type MockDraftPool } from '../src/utils/mock-draft-engine';
import {
  __setMockDraftKvForTests,
  actOnMockDraft,
  createMockDraft,
  getMockDraftSummary,
  listMockDrafts,
  memoryMockDraftKv,
  readMockDraft,
  unlistMockDraft,
} from '../src/utils/mock-draft-store';
import { isFranchiseAutoDrafted } from '../src/types/draft-room';

const CREATOR = '0001';
const TEAM_B = '0002';
const TEAM_C = '0003';
const T0 = Date.parse('2026-10-23T12:00:00Z');

function makeSession(overrides: Partial<EngineSession> = {}): EngineSession {
  const teams = [CREATOR, TEAM_B, TEAM_C];
  const totalRounds = 2;
  const draftOrder = [...teams, ...[...teams].reverse()];
  const picks = draftOrder.map((franchiseId, i) => {
    const round = Math.ceil((i + 1) / teams.length);
    return { overallPickNumber: i + 1, round, pickInRound: i + 1 - (round - 1) * teams.length, franchiseId };
  });
  return {
    id: 'testsess',
    leagueId: '9999',
    leagueYear: 2026,
    createdBy: CREATOR,
    createdAt: '2026-07-21T00:00:00.000Z',
    status: 'active',
    draftOrder,
    picksPerRound: teams.length,
    totalRounds,
    currentPickIndex: 0,
    timerSeconds: 10,
    picks,
    participants: [],
    useRealOrder: true,
    ...overrides,
  };
}

const POOL: MockDraftPool = { rankedPlayerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'] };
const playerAt = (s: EngineSession, n: number) => s.picks.find((p) => p.overallPickNumber === n)?.playerId;

afterEach(() => __setMockDraftKvForTests(null));

describe('the clock is a stored deadline', () => {
  it('starts the creator’s clock instead of picking for them', () => {
    const s = makeSession();
    expect(advance(s, POOL, T0)).toBe(true);
    expect(s.currentPickIndex).toBe(0);
    expect(s.pickDeadline).toBe(T0 + 10_000);
    expect(needsAdvance(s, T0 + 9_999)).toBe(false);
    expect(needsAdvance(s, T0 + 10_000)).toBe(true);
  });

  it('runs the AI teams in turn until a human is on the clock', () => {
    const s = makeSession({ currentPickIndex: 1 });
    advance(s, POOL, T0);
    // Picks 2 and 3 are the AI's (B, C); pick 4 is C again, then 5 B, 6 the creator.
    expect(s.currentPickIndex).toBe(5);
    expect(s.picks.slice(1, 5).every((p) => p.isAutoPick)).toBe(true);
    expect(s.pickDeadline).toBe(T0 + 10_000);
  });

  it('plays a draft nobody watched out on its own clock', () => {
    const s = makeSession({ pickDeadline: T0 + 10_000 });
    // Nobody polls for a minute: the creator's pick 1 expires at +10s, the AI
    // takes 2–5 at that moment, and pick 6's clock runs from there.
    advance(s, POOL, T0 + 60_000);
    expect(s.status).toBe('completed');
    expect(s.picks[0].pickedAt).toBe(new Date(T0 + 10_000).toISOString());
    expect(s.picks[5].pickedAt).toBe(new Date(T0 + 20_000).toISOString());
    expect(s.picks.every((p) => p.playerId)).toBe(true);
  });

  it('pauses with the time left and resumes from it', () => {
    const s = makeSession({ pickDeadline: T0 + 10_000 });
    applyAction(s, POOL, CREATOR, { type: 'pause' }, T0 + 4_000);
    expect(s.status).toBe('paused');
    expect(s.pausedRemainingMs).toBe(6_000);
    expect(advance(s, POOL, T0 + 999_000)).toBe(false);
    applyAction(s, POOL, CREATOR, { type: 'resume' }, T0 + 100_000);
    expect(s.pickDeadline).toBe(T0 + 106_000);
  });
});

describe('set-timer', () => {
  it('lets the creator change timerSeconds and restarts a running clock at it', () => {
    const s = makeSession({ pickDeadline: T0 + 10_000 });
    const r = applyAction(s, POOL, CREATOR, { type: 'set-timer', timerSeconds: 3 }, T0 + 1_000);
    expect(r.ok).toBe(true);
    expect(s.timerSeconds).toBe(3);
    expect(s.pickDeadline).toBe(T0 + 4_000);
  });

  it('rejects non-creators and invalid values', () => {
    const s = makeSession();
    expect(applyAction(s, POOL, TEAM_B, { type: 'set-timer', timerSeconds: 3 }, T0).ok).toBe(false);
    for (const bad of [0, -5, 3.5, 601, NaN]) {
      expect(applyAction(s, POOL, CREATOR, { type: 'set-timer', timerSeconds: bad }, T0).ok).toBe(false);
    }
    expect(s.timerSeconds).toBe(10);
  });
});

describe('set-auto-draft', () => {
  it('defaults to legacy behavior: every team except the creator is auto', () => {
    const s = makeSession();
    expect(isFranchiseAutoDrafted(s, CREATOR)).toBe(false);
    expect(isFranchiseAutoDrafted(s, TEAM_B)).toBe(true);
  });

  it('lets the creator flip a team to manual and back', () => {
    const s = makeSession({ status: 'paused' });
    applyAction(s, POOL, CREATOR, { type: 'set-auto-draft', targetFranchiseId: TEAM_B, autoDraft: false }, T0);
    expect(isFranchiseAutoDrafted(s, TEAM_B)).toBe(false);
    applyAction(s, POOL, CREATOR, { type: 'set-auto-draft', targetFranchiseId: TEAM_B, autoDraft: true }, T0);
    expect(isFranchiseAutoDrafted(s, TEAM_B)).toBe(true);
  });

  it('rejects non-creators and unknown teams', () => {
    const s = makeSession({ status: 'paused' });
    expect(
      applyAction(s, POOL, TEAM_B, { type: 'set-auto-draft', targetFranchiseId: TEAM_B, autoDraft: false }, T0).ok,
    ).toBe(false);
    const r = applyAction(s, POOL, CREATOR, { type: 'set-auto-draft', targetFranchiseId: '9998', autoDraft: false }, T0);
    expect(r).toEqual({ ok: false, error: 'Unknown team' });
    expect(s.autoDraft).toBeUndefined();
  });

  it('starts the clock instead of insta-picking when a manual team comes on the clock', () => {
    const s = makeSession({ currentPickIndex: 1, autoDraft: { [TEAM_B]: false } });
    advance(s, POOL, T0);
    expect(s.currentPickIndex).toBe(1);
    expect(s.pickDeadline).toBe(T0 + 10_000);
  });
});

describe('picks', () => {
  it('accepts the creator picking for a manual team and records it under that team', () => {
    const s = makeSession({ currentPickIndex: 1, autoDraft: { [TEAM_B]: false, [TEAM_C]: false } });
    const r = applyAction(s, POOL, CREATOR, { type: 'pick', playerId: 'p1' }, T0);
    expect(r.ok).toBe(true);
    const slot = s.picks[1];
    expect(slot.playerId).toBe('p1');
    expect(slot.franchiseId).toBe(TEAM_B);
    expect(slot.isAutoPick).toBe(false);
  });

  it('never leaves an auto-drafted slot open for the creator to take', () => {
    const s = makeSession({ currentPickIndex: 1 });
    // The AI has taken pick 2 before the creator's pick is judged, so the
    // creator's pick lands on the next slot that is theirs — or is refused.
    const r = applyAction(s, POOL, CREATOR, { type: 'pick', playerId: 'p7', overallPickNumber: 2 }, T0);
    expect(r.ok).toBe(false);
    expect(playerAt(s, 2)).toBe('p1');
    expect(s.picks[1].isAutoPick).toBe(true);
  });

  it('rejects other users picking for a creator-controlled team', () => {
    const s = makeSession({ currentPickIndex: 1, autoDraft: { [TEAM_B]: false } });
    expect(applyAction(s, POOL, TEAM_C, { type: 'pick', playerId: 'p1' }, T0)).toEqual({
      ok: false,
      error: 'Not your turn',
    });
  });

  it('refuses a pick made for a slot the clock already took', () => {
    const s = makeSession({ pickDeadline: T0 + 10_000 });
    // The owner tapped pick 1 just as it expired; by now the AI has run round
    // one and the owner is on the clock again at pick 6.
    const r = applyAction(s, POOL, CREATOR, { type: 'pick', playerId: 'p7', overallPickNumber: 1 }, T0 + 10_500);
    expect(r.ok).toBe(false);
    expect(s.currentPickIndex).toBe(5);
    expect(playerAt(s, 6)).toBeUndefined();
  });

  it('refuses a player already drafted', () => {
    const s = makeSession({ currentPickIndex: 1, autoDraft: { [TEAM_B]: false } });
    s.picks[0].playerId = 'p1';
    expect(applyAction(s, POOL, CREATOR, { type: 'pick', playerId: 'p1' }, T0)).toEqual({
      ok: false,
      error: 'Player already drafted',
    });
  });
});

describe('go back', () => {
  it('holds an AI slot for the creator instead of re-picking it', () => {
    const s = makeSession({ pickDeadline: T0 + 10_000 });
    applyAction(s, POOL, CREATOR, { type: 'pick', playerId: 'p7' }, T0);
    expect(s.currentPickIndex).toBe(5);
    applyAction(s, POOL, CREATOR, { type: 'undo' }, T0 + 1);
    // Pick 5 (TEAM_B's) is open again and stays open.
    expect(s.currentPickIndex).toBe(4);
    expect(s.aiHold).toBe(true);
    expect(advance(s, POOL, T0 + 60_000)).toBe(false);
    // ...until the creator picks it themselves.
    const r = applyAction(s, POOL, CREATOR, { type: 'pick', playerId: 'p6' }, T0 + 2);
    expect(r.ok).toBe(true);
    expect(s.picks[4]).toMatchObject({ franchiseId: TEAM_B, playerId: 'p6' });
    expect(s.aiHold).toBe(false);
  });

  it('is creator-only', () => {
    const s = makeSession({ currentPickIndex: 2 });
    expect(applyAction(s, POOL, TEAM_B, { type: 'undo' }, T0).ok).toBe(false);
  });
});

describe('store', () => {
  it('creates, lists, reads with catch-up, acts and unlists', async () => {
    let now = T0;
    __setMockDraftKvForTests(memoryMockDraftKv(() => now));
    await createMockDraft(makeSession({ status: 'lobby', createdAt: new Date(T0).toISOString() }), POOL);

    expect((await listMockDrafts('9999-registry', T0)).map((e) => e.id)).toEqual(['testsess']);

    const joined = await actOnMockDraft('testsess', CREATOR, { type: 'join' }, () => now);
    expect(joined.ok && joined.session.status).toBe('active');

    now += 25_000; // both of the creator's clocks run out
    const read = await readMockDraft('testsess', now);
    expect(read?.status).toBe('completed');
    expect((await getMockDraftSummary('9999-registry', 'testsess'))?.status).toBe('completed');

    await unlistMockDraft('9999-registry', 'testsess');
    expect(await listMockDrafts('9999-registry', now)).toEqual([]);
    // A later save must not list it again.
    await actOnMockDraft('testsess', CREATOR, { type: 'reset' }, () => now);
    expect(await listMockDrafts('9999-registry', now)).toEqual([]);
  });

  it('answers 404 for a session that does not exist', async () => {
    __setMockDraftKvForTests(memoryMockDraftKv());
    expect(await readMockDraft('nope')).toBeNull();
    const r = await actOnMockDraft('nope', CREATOR, { type: 'join' });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
});
