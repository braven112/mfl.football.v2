/**
 * Mid-draft mock controls — set-timer + set-auto-draft (party/draft-room.ts).
 *
 * Locks in the creator's ability to (a) change the pick clock without
 * abandoning the session and (b) flip any team between CPU auto-draft and
 * creator control, including picking manually for controlled teams.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import DraftRoomServer from '../party/draft-room';

const CREATOR = '0001';
const TEAM_B = '0002';
const TEAM_C = '0003';

function makeSession(overrides: Record<string, unknown> = {}) {
  const teams = [CREATOR, TEAM_B, TEAM_C];
  const totalRounds = 2;
  const draftOrder = [...teams, ...[...teams].reverse()];
  const picks = draftOrder.map((franchiseId, i) => {
    const round = Math.ceil((i + 1) / teams.length);
    return {
      overallPickNumber: i + 1,
      round,
      pickInRound: i + 1 - (round - 1) * teams.length,
      franchiseId,
    };
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

function makeRoom(id = 'mock-testsess') {
  const store = new Map<string, unknown>();
  const broadcasts: any[] = [];
  const connections: any[] = [];
  return {
    id,
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    },
    broadcast: (msg: string) => {
      broadcasts.push(JSON.parse(msg));
    },
    getConnections: () => connections,
    _store: store,
    _broadcasts: broadcasts,
    _connections: connections,
  };
}

function makeConn(franchiseId: string) {
  const sent: any[] = [];
  return {
    id: `conn-${franchiseId}`,
    state: { franchiseId },
    setState() {},
    send: (msg: string) => {
      sent.push(JSON.parse(msg));
    },
    _sent: sent,
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

function setup(sessionOverrides: Record<string, unknown> = {}) {
  const room = makeRoom();
  room._store.set('session', makeSession(sessionOverrides));
  room._store.set('ranked-players', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  const server = new DraftRoomServer(room as any);
  return { room, server };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('set-timer', () => {
  it('lets the creator change timerSeconds mid-draft and broadcasts the session', async () => {
    const { room, server } = setup();
    const conn = makeConn(CREATOR);
    room._connections.push(conn);

    await server.onMessage(
      JSON.stringify({ type: 'set-timer', franchiseId: CREATOR, timerSeconds: 3 }),
      conn as any,
    );

    const session = room._store.get('session') as any;
    expect(session.timerSeconds).toBe(3);
    const sessionBroadcast = room._broadcasts.find((b) => b.type === 'session');
    expect(sessionBroadcast?.session.timerSeconds).toBe(3);
  });

  it('rejects non-creators and invalid values', async () => {
    const { room, server } = setup();
    const other = makeConn(TEAM_B);
    const creator = makeConn(CREATOR);
    room._connections.push(other, creator);

    await server.onMessage(
      JSON.stringify({ type: 'set-timer', franchiseId: TEAM_B, timerSeconds: 3 }),
      other as any,
    );
    expect((room._store.get('session') as any).timerSeconds).toBe(10);
    expect(other._sent.some((m) => m.type === 'error')).toBe(true);

    for (const bad of [0, -5, 3.5, 601, NaN]) {
      await server.onMessage(
        JSON.stringify({ type: 'set-timer', franchiseId: CREATOR, timerSeconds: bad }),
        creator as any,
      );
      expect((room._store.get('session') as any).timerSeconds).toBe(10);
    }
  });

  it('restarts a running clock at the new duration', async () => {
    vi.useFakeTimers();
    const { room, server } = setup();
    const conn = makeConn(CREATOR);
    room._connections.push(conn);

    // Creator on the clock (pick index 0) — start the timer as resume would.
    (server as any).startTimer(room._store.get('session'));
    room._broadcasts.length = 0;

    await server.onMessage(
      JSON.stringify({ type: 'set-timer', franchiseId: CREATOR, timerSeconds: 2 }),
      conn as any,
    );

    const clockTicks = room._broadcasts.filter((b) => b.type === 'pick-clock');
    expect(clockTicks[clockTicks.length - 1].secondsRemaining).toBe(2);
    (server as any).stopTimer();
  });
});

describe('set-auto-draft', () => {
  it('defaults to legacy behavior: every team except the creator is auto', () => {
    const { server } = setup();
    const session = makeSession();
    expect((server as any).isAutoDrafted(session, CREATOR)).toBe(false);
    expect((server as any).isAutoDrafted(session, TEAM_B)).toBe(true);
  });

  it('lets the creator flip a team to manual and back', async () => {
    const { room, server } = setup({ status: 'paused' });
    const conn = makeConn(CREATOR);
    room._connections.push(conn);

    await server.onMessage(
      JSON.stringify({
        type: 'set-auto-draft',
        franchiseId: CREATOR,
        targetFranchiseId: TEAM_B,
        autoDraft: false,
      }),
      conn as any,
    );
    let session = room._store.get('session') as any;
    expect(session.autoDraft[TEAM_B]).toBe(false);
    expect((server as any).isAutoDrafted(session, TEAM_B)).toBe(false);

    await server.onMessage(
      JSON.stringify({
        type: 'set-auto-draft',
        franchiseId: CREATOR,
        targetFranchiseId: TEAM_B,
        autoDraft: true,
      }),
      conn as any,
    );
    session = room._store.get('session') as any;
    expect((server as any).isAutoDrafted(session, TEAM_B)).toBe(true);
  });

  it('rejects non-creators and unknown teams', async () => {
    const { room, server } = setup({ status: 'paused' });
    const other = makeConn(TEAM_B);
    const creator = makeConn(CREATOR);
    room._connections.push(other, creator);

    await server.onMessage(
      JSON.stringify({
        type: 'set-auto-draft',
        franchiseId: TEAM_B,
        targetFranchiseId: TEAM_B,
        autoDraft: false,
      }),
      other as any,
    );
    expect((room._store.get('session') as any).autoDraft).toBeUndefined();

    await server.onMessage(
      JSON.stringify({
        type: 'set-auto-draft',
        franchiseId: CREATOR,
        targetFranchiseId: '9998',
        autoDraft: false,
      }),
      creator as any,
    );
    expect((room._store.get('session') as any).autoDraft).toBeUndefined();
    expect(creator._sent.some((m) => m.type === 'error' && m.message === 'Unknown team')).toBe(true);
  });

  it('starts the clock instead of insta-picking when a manual team comes on the clock', async () => {
    vi.useFakeTimers();
    // Pick index 1 → TEAM_B on the clock, flipped to manual.
    const { room, server } = setup({
      currentPickIndex: 1,
      autoDraft: { [TEAM_B]: false },
    });

    (server as any).scheduleNextPick(room._store.get('session'));
    await flushMicrotasks();

    // No pick was made for TEAM_B; the pick clock is running instead.
    const session = room._store.get('session') as any;
    expect(session.currentPickIndex).toBe(1);
    const clockTicks = room._broadcasts.filter((b) => b.type === 'pick-clock');
    expect(clockTicks[0].secondsRemaining).toBe(10);
    (server as any).stopTimer();
  });
});

describe('picks for controlled teams', () => {
  it('accepts the creator picking for a manual team and records it under that team', async () => {
    const { room, server } = setup({
      currentPickIndex: 1,
      autoDraft: { [TEAM_B]: false, [TEAM_C]: false },
    });
    const conn = makeConn(CREATOR);
    room._connections.push(conn);

    await server.onMessage(
      JSON.stringify({ type: 'pick', franchiseId: CREATOR, playerId: 'p1' }),
      conn as any,
    );
    await flushMicrotasks();

    const session = room._store.get('session') as any;
    const slot = session.picks.find((p: any) => p.overallPickNumber === 2);
    expect(slot.playerId).toBe('p1');
    expect(slot.franchiseId).toBe(TEAM_B);
    expect(slot.isAutoPick).toBe(false);
    expect(conn._sent.some((m) => m.type === 'error')).toBe(false);
    (server as any).stopTimer();
  });

  it('still rejects the creator picking for an auto-drafted team', async () => {
    const { room, server } = setup({ currentPickIndex: 1 });
    const conn = makeConn(CREATOR);
    room._connections.push(conn);

    await server.onMessage(
      JSON.stringify({ type: 'pick', franchiseId: CREATOR, playerId: 'p1' }),
      conn as any,
    );

    expect(conn._sent.some((m) => m.type === 'error' && m.message === 'Not your turn')).toBe(true);
    const session = room._store.get('session') as any;
    expect(session.picks.find((p: any) => p.overallPickNumber === 2).playerId).toBeUndefined();
  });

  it('rejects other users picking for a creator-controlled team', async () => {
    const { room, server } = setup({
      currentPickIndex: 1,
      autoDraft: { [TEAM_B]: false },
    });
    const conn = makeConn(TEAM_C);
    room._connections.push(conn);

    await server.onMessage(
      JSON.stringify({ type: 'pick', franchiseId: TEAM_C, playerId: 'p1' }),
      conn as any,
    );

    expect(conn._sent.some((m) => m.type === 'error' && m.message === 'Not your turn')).toBe(true);
  });
});
