/**
 * Crowd player fixes — owners matching the Sleeper players the id join could
 * not resolve (`players.ts`) to the right MFL player.
 *
 * WHY: the join refuses to guess. A Sleeper player with no shared ESPN or
 * RotoWire id and a name that is not unique (or differs: "Hollywood" Brown)
 * scores under his Sleeper name and misses the headshot, the ticker and the
 * red-zone banner. The owner who rosters him knows exactly who he is.
 *
 * THE RULE (Brandon, Oct 2026):
 *  - An owner's pick applies to THAT owner's board at once.
 *  - It applies to EVERYONE once `AGREEMENT` (2) different owners pick the
 *    same MFL player for the same Sleeper player, or an admin approves it.
 *  - An admin can reject a pick: it is blocked for that Sleeper player, every
 *    vote for it is withdrawn (from the voters' own boards too), and it can
 *    never be agreed again. Undoing an applied fix is the same act.
 *
 * Fixes only ever FILL a blank. A player the join already resolved is never
 * re-pointed by a vote, so the crowd cannot break a match that works — and a
 * fix for a player the join later learns to resolve simply stops mattering.
 *
 * Voters are `sleeperViewerKey` (hashed MFL username), so one account is one
 * vote however many times it submits. Fixes are keyed by Sleeper player id,
 * which Sleeper keeps stable for a player's whole career, and so are not
 * per-season.
 *
 * Redis down → no fixes: the board shows the unresolved rows exactly as it
 * did before this existed.
 */

import { getRedis } from '../redis-client';
import type { SleeperPlayerMap } from './players';

/** A Sleeper player id: digits, or a defence's club code. */
export const SLEEPER_PLAYER_ID = /^[A-Z0-9]{1,12}$/;
/** An MFL player id. */
export const MFL_PLAYER_ID = /^\d{4,6}$/;

/** Distinct owners who must pick the same player before it applies to everyone. */
export const AGREEMENT = 2;

const VOTES = (sid: string) => `live:sleeper:fix:votes:${sid}`; // voter -> MFL id
const MINE = (voter: string) => `live:sleeper:fix:mine:${voter}`; // Sleeper id -> MFL id
const BLOCKED = (sid: string) => `live:sleeper:fix:blocked:${sid}`; // MFL id -> ISO time
const GLOBAL = 'live:sleeper:fix:global'; // Sleeper id -> GlobalFix
const INDEX = 'live:sleeper:fix:index'; // Sleeper id -> FixSubject

export interface GlobalFix {
  mfl: string;
  source: 'agreement' | 'admin';
  at: string;
}

/** Who a fix is ABOUT, as Sleeper describes him — kept for the admin page. */
export interface FixSubject {
  name: string;
  position: string;
  team: string;
  at: string;
}

// ── Pure ───────────────────────────────────────────────────────────────────

/**
 * The pick enough owners agree on, or null.
 *
 * Exactly one candidate may clear the bar: two different players each picked
 * by two owners is a dispute, and a dispute is the admin's to settle rather
 * than the first-counted's to win.
 */
export function agreedMatch(
  votes: Readonly<Record<string, string>>,
  blocked: ReadonlySet<string> = new Set(),
  need = AGREEMENT,
): string | null {
  const counts = new Map<string, number>();
  for (const mfl of Object.values(votes)) {
    if (!mfl || blocked.has(mfl)) continue;
    counts.set(mfl, (counts.get(mfl) ?? 0) + 1);
  }
  const agreed = [...counts].filter(([, n]) => n >= need).map(([mfl]) => mfl);
  return agreed.length === 1 ? agreed[0] : null;
}

/** Everyone's applied fixes, then this viewer's own on top. */
export function viewerFixes(
  global: Readonly<Record<string, GlobalFix>>,
  mine: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [sid, fix] of Object.entries(global)) if (fix?.mfl) out[sid] = fix.mfl;
  for (const [sid, mfl] of Object.entries(mine)) if (mfl) out[sid] = mfl;
  return out;
}

/**
 * The map with `fixes` filled in. Pure, and copy-on-write: the base map is
 * shared by every viewer in the process, so it is never mutated.
 */
export function applyPlayerFixes(
  map: SleeperPlayerMap,
  fixes: Readonly<Record<string, string>>,
): SleeperPlayerMap {
  let out = map;
  for (const [sid, mfl] of Object.entries(fixes)) {
    const entry = map[sid];
    if (!entry || entry.mfl || !mfl) continue;
    if (out === map) out = { ...map };
    out[sid] = { ...entry, mfl };
  }
  return out;
}

// ── Reads ──────────────────────────────────────────────────────────────────

const GLOBAL_TTL_MS = 60 * 1000;
let globalMemory: { at: number; fixes: Record<string, GlobalFix> } | null = null;

/** Exported for tests only. */
export function clearPlayerFixCache(): void {
  globalMemory = null;
}

async function redisOrNull() {
  return getRedis().catch(() => null);
}

/** Applied fixes, held a minute: the board reads this on every poll. */
export async function readGlobalFixes(): Promise<Record<string, GlobalFix>> {
  if (globalMemory && Date.now() - globalMemory.at < GLOBAL_TTL_MS) return globalMemory.fixes;
  const redis = await redisOrNull();
  const fixes = ((await redis?.hgetall<GlobalFix>(GLOBAL).catch(() => null)) ?? {}) as Record<string, GlobalFix>;
  globalMemory = { at: Date.now(), fixes };
  return fixes;
}

/** This viewer's own picks, applied or not. Never cached: they just made one. */
export async function readMyFixes(voter: string | null): Promise<Record<string, string>> {
  if (!voter) return {};
  const redis = await redisOrNull();
  return ((await redis?.hgetall<string>(MINE(voter)).catch(() => null)) ?? {}) as Record<string, string>;
}

/** What this viewer's board applies: everyone's fixes plus their own. */
export async function readViewerFixes(voter: string | null): Promise<Record<string, string>> {
  const [global, mine] = await Promise.all([readGlobalFixes(), readMyFixes(voter)]);
  return viewerFixes(global, mine);
}

// ── Writes ─────────────────────────────────────────────────────────────────

export type SubmitOutcome = 'saved' | 'agreed' | 'blocked' | 'error';

/**
 * Re-count one player's votes and make the applied fix match. An admin's
 * approval is never overturned by a count; only an admin act changes it.
 */
async function settle(
  redis: NonNullable<Awaited<ReturnType<typeof redisOrNull>>>,
  sid: string,
): Promise<string | null> {
  const [votes, blocked, current] = await Promise.all([
    redis.hgetall<string>(VOTES(sid)),
    redis.hgetall<string>(BLOCKED(sid)),
    redis.hget<GlobalFix>(GLOBAL, sid),
  ]);
  if (current?.source === 'admin') return current.mfl;
  const agreed = agreedMatch(
    (votes ?? {}) as Record<string, string>,
    new Set(Object.keys(blocked ?? {})),
  );
  if (agreed && agreed !== current?.mfl) {
    await redis.hset(GLOBAL, { [sid]: { mfl: agreed, source: 'agreement', at: new Date().toISOString() } });
  } else if (!agreed && current) {
    await redis.hdel(GLOBAL, sid);
  }
  globalMemory = null;
  return agreed;
}

/** One owner picks `mfl` for Sleeper player `sid`. Replaces any earlier pick of theirs. */
export async function submitPlayerFix(input: {
  voter: string;
  sid: string;
  mfl: string;
  subject: Omit<FixSubject, 'at'>;
}): Promise<SubmitOutcome> {
  const redis = await redisOrNull();
  if (!redis) return 'error';
  try {
    if (await redis.hget(BLOCKED(input.sid), input.mfl)) return 'blocked';
    await Promise.all([
      redis.hset(VOTES(input.sid), { [input.voter]: input.mfl }),
      redis.hset(MINE(input.voter), { [input.sid]: input.mfl }),
      redis.hset(INDEX, { [input.sid]: { ...input.subject, at: new Date().toISOString() } }),
    ]);
    const agreed = await settle(redis, input.sid);
    return agreed === input.mfl ? 'agreed' : 'saved';
  } catch {
    return 'error';
  }
}

/** One owner withdraws their pick. */
export async function clearPlayerFix(voter: string, sid: string): Promise<boolean> {
  const redis = await redisOrNull();
  if (!redis) return false;
  try {
    await Promise.all([redis.hdel(VOTES(sid), voter), redis.hdel(MINE(voter), sid)]);
    await settle(redis, sid);
    return true;
  } catch {
    return false;
  }
}

// ── Admin ──────────────────────────────────────────────────────────────────

export interface FixCandidate {
  mfl: string;
  votes: number;
  blocked: boolean;
}

export interface FixReview {
  sid: string;
  subject: FixSubject;
  applied: GlobalFix | null;
  /** Most votes first; blocked picks last. */
  candidates: FixCandidate[];
}

/** Pure: one player's raw hashes → the admin page's row. */
export function buildFixReview(
  sid: string,
  subject: FixSubject,
  votes: Readonly<Record<string, string>>,
  blocked: Readonly<Record<string, string>>,
  applied: GlobalFix | null,
): FixReview {
  const counts = new Map<string, number>();
  for (const mfl of Object.values(votes)) if (mfl) counts.set(mfl, (counts.get(mfl) ?? 0) + 1);
  for (const mfl of Object.keys(blocked)) if (!counts.has(mfl)) counts.set(mfl, 0);
  if (applied?.mfl && !counts.has(applied.mfl)) counts.set(applied.mfl, 0);
  const candidates = [...counts]
    .map(([mfl, n]) => ({ mfl, votes: n, blocked: mfl in blocked }))
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.votes - a.votes);
  return { sid, subject, applied, candidates };
}

/** Every player anyone has submitted a fix for, newest first. */
export async function listFixReviews(): Promise<FixReview[] | null> {
  const redis = await redisOrNull();
  if (!redis) return null;
  try {
    const [index, global] = await Promise.all([
      redis.hgetall<FixSubject>(INDEX),
      redis.hgetall<GlobalFix>(GLOBAL),
    ]);
    const subjects = Object.entries((index ?? {}) as Record<string, FixSubject>);
    const rows = await Promise.all(
      subjects.map(async ([sid, subject]) => {
        const [votes, blocked] = await Promise.all([
          redis.hgetall<string>(VOTES(sid)),
          redis.hgetall<string>(BLOCKED(sid)),
        ]);
        return buildFixReview(
          sid,
          subject,
          (votes ?? {}) as Record<string, string>,
          (blocked ?? {}) as Record<string, string>,
          ((global ?? {}) as Record<string, GlobalFix>)[sid] ?? null,
        );
      }),
    );
    return rows.sort((a, b) => String(b.subject.at).localeCompare(String(a.subject.at)));
  } catch {
    return null;
  }
}

/** The admin applies `mfl` for everyone, whatever the count. */
export async function approvePlayerFix(sid: string, mfl: string): Promise<boolean> {
  const redis = await redisOrNull();
  if (!redis) return false;
  try {
    await Promise.all([
      redis.hset(GLOBAL, { [sid]: { mfl, source: 'admin', at: new Date().toISOString() } }),
      redis.hdel(BLOCKED(sid), mfl),
    ]);
    globalMemory = null;
    return true;
  } catch {
    return false;
  }
}

/**
 * The admin rejects `mfl` for `sid`: blocked for good, withdrawn from every
 * voter's own board, and un-applied if it was applied. The count is then
 * settled again, so a second candidate that still has agreement takes over.
 */
export async function rejectPlayerFix(sid: string, mfl: string): Promise<boolean> {
  const redis = await redisOrNull();
  if (!redis) return false;
  try {
    const [votes, current] = await Promise.all([
      redis.hgetall<string>(VOTES(sid)),
      redis.hget<GlobalFix>(GLOBAL, sid),
    ]);
    const voters = Object.entries((votes ?? {}) as Record<string, string>)
      .filter(([, pick]) => pick === mfl)
      .map(([voter]) => voter);
    await Promise.all([
      redis.hset(BLOCKED(sid), { [mfl]: new Date().toISOString() }),
      ...(voters.length ? [redis.hdel(VOTES(sid), ...voters)] : []),
      ...voters.map((voter) => redis.hdel(MINE(voter), sid)),
      ...(current?.mfl === mfl ? [redis.hdel(GLOBAL, sid)] : []),
    ]);
    await settle(redis, sid);
    return true;
  } catch {
    return false;
  }
}
