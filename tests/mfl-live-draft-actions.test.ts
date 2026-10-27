/**
 * The MFL Football app's draft room writes (package R step 2): saving your MFL
 * pre-draft list and making your pick.
 *
 * Pinned here: a list edited on MFL's website is never overwritten blind, a
 * pick is only ever sent for the slot that is the owner's on the LIVE board,
 * and "made" means the board shows it — a sent pick the board doesn't show yet
 * is never reported as success.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MflLiveAppDraftRoom } from '../packages/shared-types/src/mfl-live-app-draft';

const readMflLiveDraft = vi.fn();
const pushDraftList = vi.fn();
const mflFetch = vi.fn();
const notifyLeagueEvent = vi.fn(async (_event: unknown) => 1);

vi.mock('../src/utils/live/mfl-live-draft', async (orig) => ({
  ...(await orig<typeof import('../src/utils/live/mfl-live-draft')>()),
  readMflLiveDraft: (...a: unknown[]) => readMflLiveDraft(...a),
  identityFor: async () => (id: string) => ({ name: `Name ${id}`, position: 'RB', nflTeam: 'KC' }),
}));
vi.mock('../src/utils/mfl-draft-list', async (orig) => ({
  ...(await orig<typeof import('../src/utils/mfl-draft-list')>()),
  pushDraftList: (...a: unknown[]) => pushDraftList(...a),
}));
vi.mock('../src/utils/mfl-fetch', async (orig) => ({
  ...(await orig<typeof import('../src/utils/mfl-fetch')>()),
  mflFetch: (...a: unknown[]) => mflFetch(...a),
}));

vi.mock('../src/utils/push-events', () => ({
  notifyLeagueEvent: (...a: unknown[]) => notifyLeagueEvent(a[0]),
}));

const { saveDraftQueue, makeDraftPick, refusePick, pickLanded, buildDraftPickRequest } = await import(
  '../src/utils/live/mfl-live-draft-actions'
);
const { OutboundBlockedError } = await import('../src/utils/deploy-environment');

const league = {
  leagueId: '55555',
  leagueName: 'Work league',
  franchiseId: '0002',
  franchiseName: 'Desk Jockeys',
  year: 2026,
  host: 'https://www49.myfantasyleague.com',
};

const player = (id: string) => ({ id, name: `Name ${id}`, position: 'RB', nflTeam: 'KC' });

function room(over: Partial<MflLiveAppDraftRoom> = {}): MflLiveAppDraftRoom {
  return {
    ok: true,
    leagueId: '55555',
    leagueName: 'Work league',
    year: 2026,
    franchiseId: '0002',
    kind: 'email',
    status: 'live',
    rounds: 1,
    teams: [],
    slots: [
      { overall: 1, round: 1, pick: 1, label: '1.01', franchiseId: '0001', player: player('100') },
      { overall: 2, round: 1, pick: 2, label: '1.02', franchiseId: '0002' },
      { overall: 3, round: 1, pick: 3, label: '1.03', franchiseId: '0003' },
    ],
    onClock: { overall: 2, label: '1.02', franchiseId: '0002', mine: true },
    queue: [player('200'), player('201')],
    generatedAt: '2026-05-02T20:00:00.000Z',
    pollAfterMs: 20_000,
    ...over,
  };
}

const withPick = (r: MflLiveAppDraftRoom, overall: number, id: string): MflLiveAppDraftRoom => ({
  ...r,
  slots: r.slots.map((s) => (s.overall === overall ? { ...s, player: player(id) } : s)),
});

beforeEach(() => {
  readMflLiveDraft.mockReset();
  pushDraftList.mockReset();
  mflFetch.mockReset();
  notifyLeagueEvent.mockClear();
});

describe('saveDraftQueue', () => {
  it('writes the new order when MFL still holds the list the app started from', async () => {
    readMflLiveDraft.mockResolvedValue(room());
    pushDraftList.mockResolvedValue({ ok: true });
    const r = await saveDraftQueue(league, 'cookie', { playerIds: ['201', '200'], basedOn: ['200', '201'] });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.queue.map((p) => p.id)).toEqual(['201', '200']);
    const call = pushDraftList.mock.calls[0][0];
    expect(call.playerIds).toEqual(['201', '200']);
    expect(call.mflUserCookie).toBe('cookie');
    // The league's own host, not the registry's: this is any MFL league.
    expect(call.league).toEqual({ id: '55555', mflHost: 'www49.myfantasyleague.com' });
  });

  it('writes NOTHING when the list changed on MFL, and hands back MFL’s list', async () => {
    readMflLiveDraft.mockResolvedValue(room({ queue: [player('200'), player('300')] }));
    const r = await saveDraftQueue(league, 'cookie', { playerIds: ['201', '200'], basedOn: ['200', '201'] });
    expect(r).toMatchObject({ ok: false, error: 'changed-on-mfl' });
    expect(!r.ok && 'queue' in r && r.queue.map((p) => p.id)).toEqual(['200', '300']);
    expect(pushDraftList).not.toHaveBeenCalled();
  });

  it('writes nothing when MFL would not show the current list', async () => {
    readMflLiveDraft.mockResolvedValue(room({ queue: null }));
    const r = await saveDraftQueue(league, 'cookie', { playerIds: ['200'], basedOn: ['200', '201'] });
    expect(r).toMatchObject({ ok: false, error: 'unavailable' });
    expect(pushDraftList).not.toHaveBeenCalled();
  });

  it('refuses to empty the list, which would erase it on MFL', async () => {
    const r = await saveDraftQueue(league, 'cookie', { playerIds: [], basedOn: ['200'] });
    expect(r).toMatchObject({ ok: false, error: 'empty' });
    expect(readMflLiveDraft).not.toHaveBeenCalled();
  });

  it('says a test build refused to send, rather than blaming MFL', async () => {
    readMflLiveDraft.mockResolvedValue(room());
    pushDraftList.mockResolvedValue({ ok: false, blocked: true, error: 'Nothing was sent to MFL' });
    const r = await saveDraftQueue(league, 'cookie', { playerIds: ['200'], basedOn: ['200', '201'] });
    expect(r).toMatchObject({ ok: false, error: 'blocked' });
  });
});

describe('refusePick — a stale screen never drafts into the wrong slot', () => {
  it('allows your pick in your slot', () => {
    expect(refusePick(room(), 2, '300')).toBeNull();
  });

  it('refuses when the board has moved past the slot the phone showed', () => {
    const r = refusePick(room({ onClock: { overall: 4, label: '2.01', franchiseId: '0002', mine: true } }), 2, '300');
    expect(r?.error).toBe('not-on-clock');
  });

  it('refuses when it is not your pick', () => {
    expect(refusePick(room({ onClock: { overall: 2, label: '1.02', franchiseId: '0003', mine: false } }), 2, '300')?.error).toBe(
      'not-on-clock',
    );
    expect(refusePick(room({ onClock: undefined, status: 'complete' }), 2, '300')?.error).toBe('not-on-clock');
  });

  it('refuses a player already taken', () => {
    expect(refusePick(room(), 2, '100')?.error).toBe('taken');
  });

  it('refuses in an auction league', () => {
    expect(refusePick(room({ kind: 'auction' }), 2, '300')?.error).toBe('not-on-clock');
  });
});

describe('pickLanded', () => {
  it('needs the right player, by the right team, in the right slot', () => {
    expect(pickLanded(withPick(room(), 2, '300'), 2, '300', '0002')).toBe(true);
    expect(pickLanded(withPick(room(), 2, '301'), 2, '300', '0002')).toBe(false);
    expect(pickLanded(withPick(room(), 3, '300'), 2, '300', '0002')).toBe(false);
    expect(pickLanded(withPick(room(), 2, '300'), 2, '300', '0001')).toBe(false);
  });
});

describe('buildDraftPickRequest', () => {
  it('sends CMD=DRAFT to the league’s own host as the owner’s team', () => {
    const r = buildDraftPickRequest(
      { leagueId: '55555', year: 2026, franchiseId: '0002', host: 'www49.myfantasyleague.com' },
      { playerId: '300', round: 1, pick: 2 },
    );
    expect(r.url).toBe('https://www49.myfantasyleague.com/2026/live_draft?L=55555');
    const body = new URLSearchParams(r.body);
    expect(body.get('CMD')).toBe('DRAFT');
    expect(body.get('PLAYER_PICK')).toBe('300');
    expect(body.get('FRANCHISE_PICK')).toBe('0002');
  });
});

describe('makeDraftPick', () => {
  const fast = { confirmDelaysMs: [0, 0] };

  it('is made only once the board shows it', async () => {
    readMflLiveDraft.mockResolvedValueOnce(room()).mockResolvedValueOnce(withPick(room(), 2, '300'));
    mflFetch.mockResolvedValue(new Response('<status>OK</status>'));
    const r = await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(r.ok).toBe(true);
    const call = mflFetch.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.mflUserCookie).toBe('cookie');
  });

  it('alerts the team the pick put on the clock, once the board shows the pick', async () => {
    const after = { ...withPick(room(), 2, '300'), onClock: { overall: 3, label: '1.03', franchiseId: '0003', mine: false } };
    readMflLiveDraft.mockResolvedValueOnce(room()).mockResolvedValueOnce(after);
    mflFetch.mockResolvedValue(new Response('<status>OK</status>'));
    await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(notifyLeagueEvent).toHaveBeenCalledWith({
      kind: 'draft-on-clock',
      leagueId: '55555',
      franchiseId: '0003',
      overall: 3,
      round: 1,
      pick: 3,
    });
  });

  it('names the conference board, so two boards’ same-numbered picks don’t share an alert', async () => {
    const before = room({ unit: 'CONFERENCE01' });
    const after = { ...withPick(before, 2, '300'), onClock: { overall: 3, label: '1.03', franchiseId: '0003', mine: false } };
    readMflLiveDraft.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    mflFetch.mockResolvedValue(new Response('<status>OK</status>'));
    await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(notifyLeagueEvent.mock.calls[0][0]).toMatchObject({ unit: 'CONFERENCE01', overall: 3 });
  });

  it('sends no alert for a pick the board does not show, or after the last pick', async () => {
    readMflLiveDraft.mockResolvedValue(room());
    mflFetch.mockResolvedValue(new Response('<html>ok</html>'));
    await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(notifyLeagueEvent).not.toHaveBeenCalled();

    readMflLiveDraft.mockReset();
    readMflLiveDraft
      .mockResolvedValueOnce(room())
      .mockResolvedValueOnce({ ...withPick(room(), 2, '300'), onClock: undefined, status: 'complete' });
    const r = await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(r.ok).toBe(true);
    expect(notifyLeagueEvent).not.toHaveBeenCalled();
  });

  it('never calls a pick the board does not show a success', async () => {
    readMflLiveDraft.mockResolvedValue(room());
    mflFetch.mockResolvedValue(new Response('<html>ok</html>'));
    const r = await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(r).toMatchObject({ ok: false, error: 'not-confirmed' });
  });

  it('sends nothing when the live board says it is not your pick', async () => {
    readMflLiveDraft.mockResolvedValue(room({ onClock: { overall: 3, label: '1.03', franchiseId: '0003', mine: false } }));
    const r = await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(r).toMatchObject({ ok: false, error: 'not-on-clock' });
    expect(mflFetch).not.toHaveBeenCalled();
  });

  it('sends nothing when the board could not be read', async () => {
    readMflLiveDraft.mockResolvedValue(null);
    const r = await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(r).toMatchObject({ ok: false, error: 'unavailable' });
    expect(mflFetch).not.toHaveBeenCalled();
  });

  it('reports MFL’s own error', async () => {
    readMflLiveDraft.mockResolvedValue(room());
    mflFetch.mockResolvedValue(new Response('<error>Not your pick</error>'));
    const r = await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(r).toMatchObject({ ok: false, error: 'rejected' });
    expect(!r.ok && r.message).toContain('Not your pick');
  });

  it('says a test build refused to send', async () => {
    readMflLiveDraft.mockResolvedValue(room());
    mflFetch.mockRejectedValue(new OutboundBlockedError('MFL write'));
    const r = await makeDraftPick(league, 'cookie', { playerId: '300', overall: 2 }, fast);
    expect(r).toMatchObject({ ok: false, error: 'blocked' });
  });

  it('refuses a malformed pick without reading anything', async () => {
    const r = await makeDraftPick(league, 'cookie', { playerId: 'abc', overall: 2 }, fast);
    expect(r).toMatchObject({ ok: false, error: 'rejected' });
    expect(readMflLiveDraft).not.toHaveBeenCalled();
  });
});
