/**
 * TV pairing — the device-code flow behind mfl.football/tv.
 *
 * Pins the properties that make a TV pass safe to hand to a living-room
 * screen: the token is delivered ONCE, nothing secret is stored in the clear
 * once delivered, a code cannot be approved twice, and an owner can only ever
 * revoke their own TVs. See src/utils/broadcast-tv-pairing.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  approvePairing,
  deviceLabel,
  formatUserCode,
  listPasses,
  MAX_PASSES_PER_OWNER,
  normalizeUserCode,
  ownerKeyFor,
  PAIRING_TTL_S,
  pollPairing,
  readPass,
  revokePass,
  revokePassByToken,
  startPairing,
  USER_CODE_ALPHABET,
} from '../src/utils/broadcast-tv-pairing';
import { memoryPairingStore } from '../src/utils/broadcast-tv-store';
import type { AuthUser } from '../src/utils/auth';

const owner: AuthUser = { id: 'MFL_COOKIE_A', name: 'Owner A', franchiseId: '0001', leagueId: '13522', role: 'owner' };
const other: AuthUser = { id: 'MFL_COOKIE_B', name: 'Owner B', franchiseId: '0001', leagueId: '19621', role: 'owner' };

function clockStore() {
  let now = 1_700_000_000_000;
  const store = memoryPairingStore(() => now);
  return { store, advance: (ms: number) => (now += ms), now: () => now };
}

/** Every value the store holds, serialized — for "is X stored in the clear?". */
async function dump(store: ReturnType<typeof memoryPairingStore>, keys: string[]) {
  const out: string[] = [];
  for (const k of keys) out.push(JSON.stringify(await store.get(k)));
  return out.join('\n');
}

describe('user codes', () => {
  it('are six characters off an alphabet with no look-alikes', () => {
    for (const ch of '01OILUV') expect(USER_CODE_ALPHABET).not.toContain(ch);
  });

  it('normalize what a person types', () => {
    expect(normalizeUserCode(' k7q-4m2 ')).toBe('K7Q4M2');
    expect(normalizeUserCode('K7Q 4M2')).toBe('K7Q4M2');
    expect(normalizeUserCode('K7Q4M')).toBeNull();
    expect(normalizeUserCode('K7Q4M0')).toBeNull();
    expect(normalizeUserCode(null)).toBeNull();
    expect(formatUserCode('K7Q4M2')).toBe('K7Q 4M2');
  });
});

describe('the pairing flow', () => {
  it('pending until approved, then hands the pass over exactly once', async () => {
    const { store } = clockStore();
    const { userCode, deviceCode } = await startPairing(store, { device: 'Xbox' });
    expect(normalizeUserCode(userCode)).toBe(userCode);

    expect(await pollPairing(store, deviceCode)).toEqual({ status: 'pending' });
    expect(await approvePairing(store, userCode, owner, { leagues: '13522' })).toBe('approved');

    const first = await pollPairing(store, deviceCode);
    expect(first.status).toBe('approved');
    const token = first.status === 'approved' ? first.passToken : '';
    expect(await pollPairing(store, deviceCode)).toEqual({ status: 'expired' });

    const pass = await readPass(store, token);
    expect(pass?.user).toEqual(owner);
    expect(pass?.leagues).toBe('13522');
    expect(pass?.device).toBe('Xbox');
  });

  it('a code cannot be approved twice', async () => {
    const { store } = clockStore();
    const { userCode } = await startPairing(store, { device: 'TV' });
    expect(await approvePairing(store, userCode, owner, { leagues: null })).toBe('approved');
    expect(await approvePairing(store, userCode, other, { leagues: null })).toBe('already-used');
  });

  it('codes expire', async () => {
    const { store, advance } = clockStore();
    const { userCode, deviceCode } = await startPairing(store, { device: 'TV' });
    advance(PAIRING_TTL_S * 1000 + 1);
    expect(await approvePairing(store, userCode, owner, { leagues: null })).toBe('expired');
    expect(await pollPairing(store, deviceCode)).toEqual({ status: 'expired' });
  });

  it('an unknown device code learns nothing', async () => {
    const { store } = clockStore();
    expect(await pollPairing(store, 'not-a-device')).toEqual({ status: 'expired' });
    expect(await pollPairing(store, '')).toEqual({ status: 'expired' });
    expect(await readPass(store, 'not-a-token')).toBeNull();
  });

  it('once delivered, neither the pass token nor the device code is stored in the clear', async () => {
    const { store } = clockStore();
    const { userCode, deviceCode } = await startPairing(store, { device: 'TV' });
    await approvePairing(store, userCode, owner, { leagues: null });
    const res = await pollPairing(store, deviceCode);
    const token = res.status === 'approved' ? res.passToken : '';
    const everything = await dump(store, [
      `bctv:pair:${userCode}`,
      `bctv:owner:${ownerKeyFor(owner)}`,
    ]);
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(deviceCode);
  });
});

describe('managing paired TVs', () => {
  async function pair(store: ReturnType<typeof memoryPairingStore>, user: AuthUser, device = 'TV') {
    const { userCode, deviceCode } = await startPairing(store, { device });
    await approvePairing(store, userCode, user, { leagues: null });
    const res = await pollPairing(store, deviceCode);
    return res.status === 'approved' ? res.passToken : '';
  }

  it('lists an owner’s TVs and revokes one', async () => {
    const { store } = clockStore();
    const t1 = await pair(store, owner, 'Xbox');
    const t2 = await pair(store, owner, 'Fire TV');
    const list = await listPasses(store, ownerKeyFor(owner));
    expect(list.map((p) => p.device)).toEqual(['Xbox', 'Fire TV']);

    expect(await revokePass(store, ownerKeyFor(owner), list[0].id)).toBe(true);
    expect(await readPass(store, t1)).toBeNull();
    expect(await readPass(store, t2)).not.toBeNull();
  });

  it('an owner cannot revoke another owner’s TV, even with franchise 0001 in both leagues', async () => {
    const { store } = clockStore();
    const theirs = await pair(store, other);
    const [their] = await listPasses(store, ownerKeyFor(other));
    expect(ownerKeyFor(owner)).not.toBe(ownerKeyFor(other));
    expect(await revokePass(store, ownerKeyFor(owner), their.id)).toBe(false);
    expect(await readPass(store, theirs)).not.toBeNull();
  });

  it('a TV can unpair itself', async () => {
    const { store } = clockStore();
    const token = await pair(store, owner);
    await revokePassByToken(store, token);
    expect(await readPass(store, token)).toBeNull();
    expect(await listPasses(store, ownerKeyFor(owner))).toEqual([]);
  });

  it('keeps at most MAX_PASSES_PER_OWNER, and the dropped oldest really stops working', async () => {
    const { store } = clockStore();
    const tokens: string[] = [];
    for (let i = 0; i <= MAX_PASSES_PER_OWNER; i++) tokens.push(await pair(store, owner, `TV ${i}`));
    expect(await listPasses(store, ownerKeyFor(owner))).toHaveLength(MAX_PASSES_PER_OWNER);
    expect(await readPass(store, tokens[0])).toBeNull();
    expect(await readPass(store, tokens[MAX_PASSES_PER_OWNER])).not.toBeNull();
  });
});

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) Edg/120', 'Xbox'],
    ['Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) Silk/120', 'Fire TV'],
    ['Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) SamsungBrowser/4.0 TV', 'Samsung TV'],
    ['Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36', 'LG TV'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Mac'],
    ['', 'TV'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});
