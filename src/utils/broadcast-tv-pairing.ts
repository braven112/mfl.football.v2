/**
 * Pairing a television to the broadcast board — the device-code flow.
 *
 * The same shape Netflix and YouTube use to sign a TV in (OAuth's "device
 * authorization grant", RFC 8628), cut down to what one board needs:
 *
 *   1. The TV opens `/tv`. The server starts a PAIRING: a short USER code the
 *      owner can read off the screen (and a QR code carrying it), plus a long
 *      DEVICE code only that TV ever sees.
 *   2. The owner scans the QR with a phone that is already signed in to MFL
 *      Live, and approves. That mints a TV PASS.
 *   3. The TV, polling with its device code, collects the pass as an HttpOnly
 *      cookie and goes to the board.
 *
 * ── WHY A PASS, AND NOT THE SESSION ──────────────────────────────────────
 * The session JWT is signed, not encrypted, and its `userId` IS the owner's
 * MFL cookie (`cross-league-live.ts` reads MFL with it). Copying a session to
 * a TV would put a credential that can set lineups and accept trades on a
 * shared screen in someone's living room. A pass is an opaque random token.
 * The TV holds only that; the owner's identity, MFL cookie included, stays
 * in Redis under the token's HASH and is read back only by the two broadcast
 * surfaces (`broadcast-viewer.ts` names them). A stolen pass watches a
 * scoreboard, and the owner can revoke it from the broadcast page.
 *
 * ── WHAT IS STORED, AND FOR HOW LONG ─────────────────────────────────────
 *   bctv:pair:<USERCODE>      the pairing           PAIRING_TTL_S (5 min)
 *   bctv:device:<sha(dev)>    device code → code    PAIRING_TTL_S
 *   bctv:pass:<sha(token)>    the pass              PASS_TTL_S (30 days)
 *   bctv:owner:<owner>        that owner's TVs      PASS_TTL_S, refreshed
 *
 * Every secret is stored as a SHA-256, never in the clear, with ONE exception:
 * an approved pairing holds the new pass token until the TV collects it, which
 * is at most five minutes and is deleted on collection. A Redis dump therefore
 * yields no working TV cookie that has already been delivered.
 *
 * PURE over a minimal store, so the flow is unit-tested against a Map without
 * Redis (tests/broadcast-tv-pairing.test.ts).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { AuthUser } from './auth';

/** The TV's cookie. HttpOnly — no script on the page ever needs to read it. */
export const TV_PASS_COOKIE = 'bc_tv';

/** How long a code on the TV stays good. Long enough to find a phone. */
export const PAIRING_TTL_S = 5 * 60;

/** How long a TV stays paired. A season is ~20 weeks; this is re-paired monthly. */
export const PASS_TTL_S = 30 * 24 * 60 * 60;

/** The most TVs one owner can have paired at once — the oldest drops off. */
export const MAX_PASSES_PER_OWNER = 8;

/**
 * No 0/O, 1/I/L or U/V: the code is read off a television from across a room
 * and typed on a phone, and every pair here is one somebody will misread.
 */
export const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
export const USER_CODE_LENGTH = 6;

/** The subset of the Redis client this file uses. Upstash (de)serializes JSON. */
export interface PairingStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface Pairing {
  status: 'pending' | 'approved';
  createdAt: number;
  /** A human label for the device, from its user agent ("Xbox", "Fire TV"). */
  device: string;
  /** Set on approval, cleared when the TV collects it. */
  passToken?: string;
}

export interface TvPass {
  /** Public, short — what the remove button names. Never the token. */
  id: string;
  user: AuthUser;
  /** The phone's broadcast league selection at the moment of pairing. */
  leagues: string | null;
  device: string;
  createdAt: number;
}

export interface PassSummary {
  id: string;
  device: string;
  createdAt: number;
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

const pairKey = (code: string) => `bctv:pair:${code}`;
const deviceKey = (deviceCode: string) => `bctv:device:${sha(deviceCode)}`;
const passKey = (token: string) => `bctv:pass:${sha(token)}`;
const passKeyFromHash = (hash: string) => `bctv:pass:${hash}`;
const ownerIndexKey = (owner: string) => `bctv:owner:${owner}`;
// One-shot claims and the per-owner lock. Each is an `nx` write, which is the
// only atomic primitive the store offers: whoever's write lands owns the step.
const approveClaimKey = (code: string) => `bctv:approve:${code}`;
const collectClaimKey = (deviceCode: string) => `bctv:collect:${sha(deviceCode)}`;
const ownerLockKey = (owner: string) => `bctv:lock:${owner}`;

/** True for exactly one caller per key while it lives. */
async function claimOnce(store: PairingStore, key: string, ttlS: number): Promise<boolean> {
  return (await store.set(key, 1, { ex: ttlS, nx: true })) !== null;
}

const OWNER_LOCK_TTL_S = 10;
const OWNER_LOCK_TRIES = 40;
const OWNER_LOCK_WAIT_MS = 50;

/**
 * Serialize every read-modify-write of one owner's TV index. Without it, two
 * approvals (or an approval and a Remove) each write back their own snapshot
 * and one TV drops out of the list while its pass keeps working — a TV the
 * owner can no longer see or unpair. The lock expires on its own, so a crashed
 * holder blocks the next caller for seconds, not forever.
 */
async function withOwnerLock<T>(store: PairingStore, owner: string, fn: () => Promise<T>): Promise<T> {
  const key = ownerLockKey(owner);
  for (let i = 0; i < OWNER_LOCK_TRIES; i++) {
    if (await claimOnce(store, key, OWNER_LOCK_TTL_S)) {
      try {
        return await fn();
      } finally {
        await store.del(key);
      }
    }
    await new Promise((r) => setTimeout(r, OWNER_LOCK_WAIT_MS));
  }
  throw new Error('broadcast TV list is busy');
}

/**
 * Whose TVs these are. League id + franchise id, never franchise id alone:
 * every MFL league has a franchise 0001, and both of ours do.
 */
export function ownerKeyFor(user: Pick<AuthUser, 'leagueId' | 'franchiseId'>): string {
  return `${user.leagueId}:${user.franchiseId}`;
}

/** Upper-case, strip spaces and dashes, and refuse anything off the alphabet. */
export function normalizeUserCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== USER_CODE_LENGTH) return null;
  for (const ch of code) if (!USER_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** "K7Q4M2" → "K7Q 4M2", the way the TV prints it. */
export function formatUserCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function newUserCode(): string {
  let out = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++) out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return out;
}

/** A coarse, human name for a device, from its user agent. Display only. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (/Xbox/i.test(ua)) return 'Xbox';
  if (/PlayStation/i.test(ua)) return 'PlayStation';
  if (/AFT[A-Z]|Silk\//.test(ua)) return 'Fire TV';
  if (/Tizen|SMART-TV.*Samsung|SamsungBrowser.*TV/i.test(ua)) return 'Samsung TV';
  if (/Web0S|webOS|NetCast/i.test(ua)) return 'LG TV';
  if (/CrKey/i.test(ua)) return 'Chromecast';
  if (/Android.*TV|GoogleTV|BRAVIA/i.test(ua)) return 'Android TV';
  if (/Roku/i.test(ua)) return 'Roku';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  return 'TV';
}

/**
 * Start a pairing. Retries a handful of times on the (one in 594 million)
 * chance the code is already live; `nx` makes the claim atomic.
 */
export async function startPairing(
  store: PairingStore,
  opts: { device: string; now?: number },
): Promise<{ userCode: string; deviceCode: string; expiresAt: number }> {
  const now = opts.now ?? Date.now();
  const deviceCode = randomBytes(32).toString('base64url');
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = newUserCode();
    const pairing: Pairing = { status: 'pending', createdAt: now, device: opts.device };
    const claimed = await store.set(pairKey(userCode), pairing, { ex: PAIRING_TTL_S, nx: true });
    // Upstash answers "OK" on success and null when `nx` refused.
    if (claimed === null) continue;
    await store.set(deviceKey(deviceCode), userCode, { ex: PAIRING_TTL_S });
    return { userCode, deviceCode, expiresAt: now + PAIRING_TTL_S * 1000 };
  }
  throw new Error('could not allocate a pairing code');
}

/** What the phone shows before approving: is this code live, and for what? */
export async function peekPairing(store: PairingStore, userCode: string): Promise<Pairing | null> {
  return store.get<Pairing>(pairKey(userCode));
}

export type ApproveResult = 'approved' | 'expired' | 'already-used';

/**
 * The owner said yes. Mint the pass and park its token on the pairing for
 * the TV to collect.
 */
export async function approvePairing(
  store: PairingStore,
  userCode: string,
  user: AuthUser,
  opts: { leagues: string | null; now?: number },
): Promise<ApproveResult> {
  const now = opts.now ?? Date.now();
  const pairing = await store.get<Pairing>(pairKey(userCode));
  if (!pairing) return 'expired';
  if (pairing.status !== 'pending') return 'already-used';
  // Two phones approving the same code at once both read `pending`; only the
  // one that lands this claim mints a pass, so the TV can never end up on the
  // broadcast of whichever owner happened to write last.
  if (!(await claimOnce(store, approveClaimKey(userCode), PAIRING_TTL_S))) return 'already-used';

  const token = randomBytes(32).toString('base64url');
  const pass: TvPass = {
    id: randomBytes(6).toString('base64url'),
    user,
    leagues: opts.leagues,
    device: pairing.device,
    createdAt: now,
  };
  const owner = ownerKeyFor(user);
  await withOwnerLock(store, owner, async () => {
    // The pass is written inside the lock too, so no pass exists that the
    // owner's index does not list.
    await store.set(passKey(token), pass, { ex: PASS_TTL_S });
    const index = (await store.get<(PassSummary & { hash: string })[]>(ownerIndexKey(owner))) ?? [];
    index.push({ id: pass.id, device: pass.device, createdAt: now, hash: sha(token) });
    // Oldest out first. Its pass is deleted too, so a dropped TV is really gone
    // rather than invisible-but-working.
    while (index.length > MAX_PASSES_PER_OWNER) {
      const dropped = index.shift()!;
      await store.del(passKeyFromHash(dropped.hash));
    }
    await store.set(ownerIndexKey(owner), index, { ex: PASS_TTL_S });
  });

  const approved: Pairing = { ...pairing, status: 'approved', passToken: token };
  // Keep the pairing's own remaining life; a fresh full TTL is close enough
  // and simpler than reading the TTL back.
  await store.set(pairKey(userCode), approved, { ex: PAIRING_TTL_S });
  return 'approved';
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'approved'; passToken: string };

/**
 * The TV asking "am I in yet?". The pass token is handed over ONCE: the
 * pairing and the device mapping are deleted on collection.
 */
export async function pollPairing(store: PairingStore, deviceCode: string): Promise<PollResult> {
  if (!deviceCode) return { status: 'expired' };
  const userCode = await store.get<string>(deviceKey(deviceCode));
  if (!userCode) return { status: 'expired' };
  const pairing = await store.get<Pairing>(pairKey(userCode));
  if (!pairing) return { status: 'expired' };
  if (pairing.status !== 'approved' || !pairing.passToken) return { status: 'pending' };
  // Two overlapping polls can both read the approved pairing; only the one
  // that lands this claim is handed the token.
  if (!(await claimOnce(store, collectClaimKey(deviceCode), PAIRING_TTL_S))) return { status: 'pending' };
  await store.del(pairKey(userCode));
  await store.del(deviceKey(deviceCode));
  return { status: 'approved', passToken: pairing.passToken };
}

/** The pass behind a TV's cookie, or null when it is unknown, expired or revoked. */
export async function readPass(store: PairingStore, token: string | null | undefined): Promise<TvPass | null> {
  if (!token || token.length > 128) return null;
  return store.get<TvPass>(passKey(token));
}

/** The TVs an owner has paired — for the list with the Remove buttons. */
export async function listPasses(store: PairingStore, owner: string): Promise<PassSummary[]> {
  const index = (await store.get<(PassSummary & { hash: string })[]>(ownerIndexKey(owner))) ?? [];
  // Drop entries whose pass has expired on its own, so the list never shows a
  // TV that is no longer paired.
  const live: PassSummary[] = [];
  for (const entry of index) {
    if (await store.get(passKeyFromHash(entry.hash))) {
      live.push({ id: entry.id, device: entry.device, createdAt: entry.createdAt });
    }
  }
  return live;
}

/**
 * The stored hash of one of THIS owner's passes, by its public id — the only
 * way the phone remote addresses a TV (`broadcast-tv-remote.ts`). An id not
 * in this owner's own index answers null, so no owner can reach another's TV.
 */
export async function passHashForOwner(store: PairingStore, owner: string, id: string): Promise<string | null> {
  const index = (await store.get<(PassSummary & { hash: string })[]>(ownerIndexKey(owner))) ?? [];
  const entry = index.find((e) => e.id === id);
  if (!entry) return null;
  // An expired pass is not a TV any more, even while its index row lingers.
  return (await store.get(passKeyFromHash(entry.hash))) ? entry.hash : null;
}

/** The hash a TV's own cookie is stored under. Never the pass itself. */
export function passHashOfToken(token: string): string {
  return sha(token);
}

/** Unpair one TV. Only ever reaches the passes in THIS owner's index. */
export async function revokePass(store: PairingStore, owner: string, id: string): Promise<boolean> {
  return withOwnerLock(store, owner, async () => {
    const index = (await store.get<(PassSummary & { hash: string })[]>(ownerIndexKey(owner))) ?? [];
    const entry = index.find((e) => e.id === id);
    if (!entry) return false;
    await store.del(passKeyFromHash(entry.hash));
    await store.set(
      ownerIndexKey(owner),
      index.filter((e) => e.id !== id),
      { ex: PASS_TTL_S },
    );
    return true;
  });
}

/** Unpair the TV holding this token — its own "Unpair this TV" button. */
export async function revokePassByToken(store: PairingStore, token: string): Promise<void> {
  const pass = await readPass(store, token);
  if (!pass) return;
  await revokePass(store, ownerKeyFor(pass.user), pass.id);
  await store.del(passKey(token));
}
