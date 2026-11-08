/**
 * The phone choosing which leagues a paired TV shows (Brandon, Nov 2026: keep
 * his test leagues off the board). Pins that only the owner's own TV can be
 * set, that the set outranks the TV's own cookie, that a bad read never costs
 * the board, and that the remote's checkboxes start from what the TV shows.
 */
import { describe, it, expect } from 'vitest';
import {
  approvePairing,
  listPasses,
  ownerKeyFor,
  passHashOfToken,
  pollPairing,
  startPairing,
} from '../src/utils/broadcast-tv-pairing';
import { memoryPairingStore } from '../src/utils/broadcast-tv-store';
import {
  cleanLeagueIds,
  MAX_REMOTE_LEAGUES,
  readRemoteLeagues,
  readRemoteState,
  setRemoteLeagues,
  tvLeagueChoice,
  tvLeaguesForOwner,
} from '../src/utils/broadcast-tv-remote';
import { tvShows } from '../src/components/shared/live-broadcast/TvRemote';
import type { AuthUser } from '../src/utils/auth';

const owner: AuthUser = { id: 'MFL_COOKIE_A', name: 'Owner A', franchiseId: '0001', leagueId: '13522', role: 'owner' };
const other: AuthUser = { id: 'MFL_COOKIE_B', name: 'Owner B', franchiseId: '0001', leagueId: '19621', role: 'owner' };

async function pairTv(store: ReturnType<typeof memoryPairingStore>, user: AuthUser, leagues: string | null = null) {
  const { userCode, deviceCode } = await startPairing(store, { device: 'Android TV' });
  await approvePairing(store, userCode, user, { leagues });
  const polled = await pollPairing(store, deviceCode);
  if (polled.status !== 'approved') throw new Error('pairing failed');
  const passes = await listPasses(store, ownerKeyFor(user));
  return { token: polled.passToken, id: passes[passes.length - 1].id };
}

describe('cleanLeagueIds', () => {
  it('keeps MFL ids only, deduplicated in order', () => {
    expect(cleanLeagueIds(['13522', '19621', '13522', 'x', 5, '1'.repeat(13)])).toEqual(['13522', '19621']);
  });
  it('refuses an empty set, a non-array and an oversized one', () => {
    expect(cleanLeagueIds([])).toBeNull();
    expect(cleanLeagueIds('13522')).toBeNull();
    expect(cleanLeagueIds(Array.from({ length: MAX_REMOTE_LEAGUES + 1 }, (_, i) => String(i + 1)))).toBeNull();
  });
});

describe('setRemoteLeagues', () => {
  it("stores the set for the owner's TV and tells it to reload", async () => {
    const store = memoryPairingStore();
    const tv = await pairTv(store, owner);
    expect(await setRemoteLeagues(store, ownerKeyFor(owner), tv.id, ['13522', '19621'])).toBe('sent');
    const hash = passHashOfToken(tv.token);
    expect(await readRemoteLeagues(store, hash)).toBe('13522,19621');
    expect((await readRemoteState(store, hash)).command).toBe('leagues');
  });

  it("cannot reach another owner's TV, even with franchise 0001 in both leagues", async () => {
    const store = memoryPairingStore();
    const theirs = await pairTv(store, other);
    expect(await setRemoteLeagues(store, ownerKeyFor(owner), theirs.id, ['13522'])).toBe('not-found');
    expect(await readRemoteLeagues(store, passHashOfToken(theirs.token))).toBeNull();
  });

  it('refuses an empty set rather than blanking the board', async () => {
    const store = memoryPairingStore();
    const tv = await pairTv(store, owner);
    expect(await setRemoteLeagues(store, ownerKeyFor(owner), tv.id, [])).toBe('invalid');
  });
});

describe('tvLeagueChoice', () => {
  it("puts the phone's set ahead of the TV's cookie and the pairing set", async () => {
    const store = memoryPairingStore();
    const tv = await pairTv(store, owner, '111');
    await setRemoteLeagues(store, ownerKeyFor(owner), tv.id, ['13522']);
    expect(await tvLeagueChoice(tv.token, '222', '111', async () => store)).toBe('13522');
  });

  it("falls back to the cookie, then the pairing set, when the phone has set nothing", async () => {
    const store = memoryPairingStore();
    const tv = await pairTv(store, owner);
    expect(await tvLeagueChoice(tv.token, '222', '111', async () => store)).toBe('222');
    expect(await tvLeagueChoice(tv.token, undefined, '111', async () => store)).toBe('111');
    expect(await tvLeagueChoice(null, undefined, undefined, async () => store)).toBeNull();
  });

  it('a store that fails costs only the phone choice', async () => {
    expect(
      await tvLeagueChoice('token', '222', null, async () => {
        throw new Error('redis down');
      }),
    ).toBe('222');
  });
});

describe("the remote's checkboxes", () => {
  const leagues = [
    { id: '13522', name: 'TheLeague' },
    { id: '19621', name: 'AFL' },
    { id: '55555', name: 'Test league' },
  ];

  it('start from the set stored for that TV', async () => {
    const store = memoryPairingStore();
    const tv = await pairTv(store, owner, '13522,55555');
    const stored = await tvLeaguesForOwner(store, ownerKeyFor(owner), tv.id);
    expect(stored).toBe('13522,55555');
    await setRemoteLeagues(store, ownerKeyFor(owner), tv.id, ['19621', '13522']);
    const now = await tvLeaguesForOwner(store, ownerKeyFor(owner), tv.id);
    // Board order, whatever order the set was saved in.
    expect(tvShows({ leagues: now }, leagues, [])).toEqual(['13522', '19621']);
  });

  it('show the default set when the TV has none, or only leagues the owner left', () => {
    expect(tvShows({ leagues: null }, leagues, ['13522', '19621'])).toEqual(['13522', '19621']);
    expect(tvShows({ leagues: '99999' }, leagues, ['13522'])).toEqual(['13522']);
  });
});
