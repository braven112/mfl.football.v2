/**
 * The phone as a remote for a paired TV (docs/plans/broadcast-handheld.md,
 * Phase 4). Pins what keeps it display-only and owner-only: a closed command
 * list, re-checked on the way out; a TV addressed only through the sending
 * owner's own list; the TV's fast check switched on only while a remote is
 * open. See src/utils/broadcast-tv-remote.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  approvePairing,
  listPasses,
  ownerKeyFor,
  passHashOfToken,
  PASS_TTL_S,
  pollPairing,
  startPairing,
} from '../src/utils/broadcast-tv-pairing';
import { memoryPairingStore } from '../src/utils/broadcast-tv-store';
import {
  formatRemoteCommand,
  parseRemoteCommand,
  readRemoteState,
  REMOTE_ACTIVE_MS,
  sendRemoteCommand,
} from '../src/utils/broadcast-tv-remote';
import type { AuthUser } from '../src/utils/auth';

const owner: AuthUser = { id: 'MFL_COOKIE_A', name: 'Owner A', franchiseId: '0001', leagueId: '13522', role: 'owner' };
const other: AuthUser = { id: 'MFL_COOKIE_B', name: 'Owner B', franchiseId: '0001', leagueId: '19621', role: 'owner' };

function clockStore() {
  let now = 1_700_000_000_000;
  const store = memoryPairingStore(() => now);
  return { store, advance: (ms: number) => (now += ms), now: () => now };
}

/** Pair a TV for `user` and return its cookie token and public pass id. */
async function pairTv(store: ReturnType<typeof memoryPairingStore>, user: AuthUser, now: number) {
  const { userCode, deviceCode } = await startPairing(store, { device: 'Fire TV', now });
  await approvePairing(store, userCode, user, { leagues: null, now });
  const polled = await pollPairing(store, deviceCode);
  if (polled.status !== 'approved') throw new Error('pairing failed');
  const passes = await listPasses(store, ownerKeyFor(user));
  return { token: polled.passToken, id: passes[passes.length - 1].id };
}

describe('the command list is closed', () => {
  it('accepts exactly the display commands', () => {
    for (const raw of ['page:next', 'page:prev', 'sound:on', 'sound:off', 'reset', 'pin-league:13522']) {
      const parsed = parseRemoteCommand(raw);
      expect(parsed).not.toBeNull();
      expect(formatRemoteCommand(parsed!)).toBe(raw);
    }
  });

  it('refuses anything else, whole', () => {
    for (const raw of [
      'page:up',
      'PAGE:NEXT',
      'page:next ',
      'reset;page:next',
      'pin-league:',
      'pin-league:abc',
      'pin-league:13522/../x',
      'pin-league:https://example.com',
      'navigate:/x',
      '<script>',
      'open',
      `pin-league:${'1'.repeat(40)}`,
      42,
      null,
      { kind: 'reset' },
    ]) {
      expect(parseRemoteCommand(raw)).toBeNull();
    }
  });
});

describe('sending', () => {
  it("reaches the owner's own TV and is read back once by it", async () => {
    const { store, now } = clockStore();
    const tv = await pairTv(store, owner, now());
    expect(await sendRemoteCommand(store, ownerKeyFor(owner), tv.id, 'pin-league:13522', now())).toBe('sent');
    const state = await readRemoteState(store, passHashOfToken(tv.token), now());
    expect(state).toEqual({ active: true, seq: now(), command: 'pin-league:13522' });
  });

  it("cannot reach another owner's TV, even with its real pass id", async () => {
    const { store, now } = clockStore();
    const theirs = await pairTv(store, other, now());
    expect(await sendRemoteCommand(store, ownerKeyFor(owner), theirs.id, 'page:next', now())).toBe('not-found');
    expect((await readRemoteState(store, passHashOfToken(theirs.token), now())).command).toBeNull();
  });

  it('refuses a command off the list before touching the store', async () => {
    const { store, now } = clockStore();
    const tv = await pairTv(store, owner, now());
    expect(await sendRemoteCommand(store, ownerKeyFor(owner), tv.id, 'navigate:/admin', now())).toBe('invalid');
    expect(await readRemoteState(store, passHashOfToken(tv.token), now())).toEqual({ active: false, seq: 0, command: null });
  });

  it('cannot reach a TV whose pass has expired', async () => {
    const { store, now, advance } = clockStore();
    const tv = await pairTv(store, owner, now());
    advance(PASS_TTL_S * 1000 + 1);
    expect(await sendRemoteCommand(store, ownerKeyFor(owner), tv.id, 'reset', now())).toBe('not-found');
  });

  it('numbers every press, strictly increasing, so a TV applies each one once', async () => {
    const { store, now } = clockStore();
    const tv = await pairTv(store, owner, now());
    await sendRemoteCommand(store, ownerKeyFor(owner), tv.id, 'page:next', now());
    const first = (await readRemoteState(store, passHashOfToken(tv.token), now())).seq;
    // Same millisecond, same button: still a new press.
    await sendRemoteCommand(store, ownerKeyFor(owner), tv.id, 'page:next', now());
    expect((await readRemoteState(store, passHashOfToken(tv.token), now())).seq).toBeGreaterThan(first);
  });
});

describe('the fast check is only on while a remote is open', () => {
  it('"open" wakes the TV without sending or replaying a command', async () => {
    const { store, now, advance } = clockStore();
    const tv = await pairTv(store, owner, now());
    await sendRemoteCommand(store, ownerKeyFor(owner), tv.id, 'sound:off', now());
    const before = await readRemoteState(store, passHashOfToken(tv.token), now());
    advance(60_000);
    await sendRemoteCommand(store, ownerKeyFor(owner), tv.id, 'open', now());
    const after = await readRemoteState(store, passHashOfToken(tv.token), now());
    expect(after).toEqual({ ...before, active: true });
  });

  it('goes quiet on its own after the remote is left alone', async () => {
    const { store, now, advance } = clockStore();
    const tv = await pairTv(store, owner, now());
    await sendRemoteCommand(store, ownerKeyFor(owner), tv.id, 'open', now());
    advance(REMOTE_ACTIVE_MS + 1);
    expect((await readRemoteState(store, passHashOfToken(tv.token), now())).active).toBe(false);
  });

  it('a TV nobody has a remote for reads "inactive" and nothing else', async () => {
    const { store, now } = clockStore();
    const tv = await pairTv(store, owner, now());
    expect(await readRemoteState(store, passHashOfToken(tv.token), now())).toEqual({ active: false, seq: 0, command: null });
  });

  it('re-checks the stored command on the way out', async () => {
    const { store, now } = clockStore();
    const tv = await pairTv(store, owner, now());
    await store.set(`bctv:remote:${passHashOfToken(tv.token)}`, { activeUntil: now() + 1000, seq: 5, command: 'navigate:/x' });
    expect((await readRemoteState(store, passHashOfToken(tv.token), now())).command).toBeNull();
  });
});

describe('who may send, who may read', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('the send endpoint takes the SESSION, never a TV pass', () => {
    const src = read('src/pages/api/broadcast-tv/remote.ts');
    expect(src).toMatch(/getMflLiveUser\(request\)/);
    expect(src).not.toMatch(/readTvPassToken|getBroadcastViewer|bc_tv/);
    expect(src).toMatch(/checkRateLimit\(/);
  });

  it("the TV's check reads only its own record, never the pass's owner", () => {
    const src = read('src/pages/api/broadcast-tv/remote-poll.ts');
    expect(src).toMatch(/readRemoteState\(/);
    expect(src).not.toMatch(/readPass\(|getBroadcastViewer|getMflLiveUser|sendRemoteCommand/);
  });

  it('the TV island re-parses every command before applying it', () => {
    const src = read('src/components/shared/live-broadcast/LiveBroadcast.tsx');
    expect(src).toMatch(/parseRemoteCommand\(remote\.command\)/);
  });
});
