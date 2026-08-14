/**
 * "This answer looks wrong" — owner-reported flags on Ask Roger answers.
 *
 * Why this exists: Roger generates each answer once and the POST handler
 * persists it to Redis; nothing ever regenerates a stored answer (CLAUDE.md →
 * "Fixing the constitution does NOT fix answers already on the page"). Until
 * now the only lever on a bad answer was the admin delete button, which throws
 * away the owner's QUESTION along with the wrong answer — so the report is
 * lost, the question has to be re-asked, and the card loses its place and its
 * attribution. A flag is the non-destructive alternative: it keeps the Q&A
 * intact and records that a human disputes it.
 *
 * Storage shape (per league, prefix comes from the endpoint config):
 *   `<prefix>:<qaId>`  HASH   franchiseId -> FlagRecord
 *   `<prefix>:index`   SET    every qaId that currently has at least one flag
 *
 * A hash keyed by franchiseId rather than a JSON blob on the Q&A itself buys
 * three things: writes are per-field so two owners flagging at once can't
 * clobber each other (the Q&A array is read-modify-write and already races),
 * one owner can't inflate the count, and the Q&A records the improvement loop
 * and the repair scripts read stay untouched. The index set exists so the list
 * endpoint can find flagged ids without scanning every key.
 *
 * Flags deliberately work on PRE-SEEDED cards too. The August 2026 5th-year
 * option bug was in a hand-written seed, not a generated answer, and it stood
 * for ~5 months — seeds are exactly the kind of card that needs a report path.
 */

import type { RedisClient } from './redis-client';

/** Long enough for "the option is top 10, not top 5", short enough to stay a report and not an essay. */
export const MAX_FLAG_REASON_CHARS = 280;

/** Per-franchise cap. Generous for honest use, low enough that nobody flags the whole board. */
export const FLAG_RATE_LIMIT_MAX = 10;
export const FLAG_RATE_LIMIT_WINDOW = 3600;

export interface FlagRecord {
  franchiseId: string;
  teamName: string;
  /** Optional free text from the reporter. Null when they just hit the button. */
  reason: string | null;
  at: string;
}

export interface FlagSummary {
  count: number;
  /** Whether the CURRENT viewer has flagged this answer — drives the button state. */
  flaggedByMe: boolean;
  /**
   * Who flagged and why. Admin-only: an owner disputing the commissioner's
   * rulebook shouldn't have their name and reasoning shown to the other 11
   * teams. Everyone still sees the count.
   */
  flaggers?: FlagRecord[];
}

export function flagHashKey(prefix: string, qaId: string): string {
  return `${prefix}:${qaId}`;
}

export function flagIndexKey(prefix: string): string {
  return `${prefix}:index`;
}

/**
 * Clean an owner-supplied reason. Returns null for anything empty so the
 * "no reason given" case is a single representation rather than '' vs null vs
 * '   '. Control characters are stripped — this string is rendered in the card
 * and may end up in a GitHub issue body later.
 */
export function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip C0/DEL control characters (newlines included) before collapsing
  // whitespace: this string is rendered in the card and is a candidate for a
  // GitHub issue body once flags feed the improvement-loop notifier.
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_FLAG_REASON_CHARS);
}

/**
 * Parse a raw Redis hash into flag records.
 *
 * Values arrive as either JSON strings or already-parsed objects depending on
 * the Upstash client's auto-deserialization, and a hand-edited or half-written
 * field must not take down the whole list endpoint — anything unparseable is
 * dropped rather than thrown.
 */
export function parseFlagHash(raw: Record<string, unknown> | null | undefined): FlagRecord[] {
  if (!raw || typeof raw !== 'object') return [];
  const records: FlagRecord[] = [];
  for (const [franchiseId, value] of Object.entries(raw)) {
    let parsed: unknown = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const rec = parsed as Partial<FlagRecord>;
    records.push({
      franchiseId,
      teamName: typeof rec.teamName === 'string' && rec.teamName ? rec.teamName : 'Unknown team',
      reason: typeof rec.reason === 'string' && rec.reason ? rec.reason : null,
      at: typeof rec.at === 'string' ? rec.at : '',
    });
  }
  // Oldest first: the first person to notice leads the list for the commissioner.
  return records.sort((a, b) => a.at.localeCompare(b.at));
}

export function summarizeFlags(
  records: FlagRecord[],
  { viewerFranchiseId, includeFlaggers }: { viewerFranchiseId: string | null; includeFlaggers: boolean }
): FlagSummary {
  const summary: FlagSummary = {
    count: records.length,
    flaggedByMe: viewerFranchiseId !== null && records.some((r) => r.franchiseId === viewerFranchiseId),
  };
  if (includeFlaggers) summary.flaggers = records;
  return summary;
}

/**
 * Record one owner's flag. Idempotent per franchise — re-flagging overwrites
 * that owner's own record (letting them amend a reason) and never double-counts.
 */
export async function setFlag(
  redis: RedisClient,
  {
    prefix,
    qaId,
    franchiseId,
    teamName,
    reason,
    at,
  }: { prefix: string; qaId: string; franchiseId: string; teamName: string; reason: string | null; at: string }
): Promise<void> {
  const record: FlagRecord = { franchiseId, teamName, reason, at };
  await redis.hset(flagHashKey(prefix, qaId), { [franchiseId]: JSON.stringify(record) });
  // Index AFTER the field write: a crash between the two leaves an
  // unindexed flag (invisible but harmless) rather than an indexed empty
  // hash, which would render a phantom "flagged" badge forever.
  await redis.sadd(flagIndexKey(prefix), qaId);
}

/**
 * Remove one owner's flag, and drop the Q&A from the index once the last flag
 * is gone so the badge disappears.
 */
export async function clearFlag(
  redis: RedisClient,
  { prefix, qaId, franchiseId }: { prefix: string; qaId: string; franchiseId: string }
): Promise<void> {
  const key = flagHashKey(prefix, qaId);
  await redis.hdel(key, franchiseId);
  const remaining = await redis.hlen(key);
  if (remaining === 0) await redis.srem(flagIndexKey(prefix), qaId);
}

/**
 * Clear EVERY flag on a Q&A — the commissioner marking a report handled.
 *
 * This is what stops the nag. An owner can only withdraw their own flag, so
 * without an admin resolve the weekly notifier would re-file an issue for a
 * report that has already been dealt with, forever. Distinct from DELETE: the
 * Q&A itself survives, which is the whole point of flagging over deleting.
 */
export async function clearAllFlags(
  redis: RedisClient,
  { prefix, qaId }: { prefix: string; qaId: string }
): Promise<void> {
  await redis.del(flagHashKey(prefix, qaId));
  await redis.srem(flagIndexKey(prefix), qaId);
}

/**
 * Flag records for every currently-flagged Q&A, as qaId -> records.
 *
 * Reads the index first and then only the hashes it names, so an unflagged
 * board (the normal case) costs exactly one round trip and a fully-flagged
 * one costs N — rather than one HLEN per card on every page load.
 */
export async function readAllFlags(
  redis: RedisClient,
  prefix: string
): Promise<Map<string, FlagRecord[]>> {
  const flagged = await redis.smembers<string>(flagIndexKey(prefix));
  const out = new Map<string, FlagRecord[]>();
  if (!Array.isArray(flagged) || flagged.length === 0) return out;

  const hashes = await Promise.all(
    flagged.map((qaId) => redis.hgetall<unknown>(flagHashKey(prefix, qaId)))
  );
  flagged.forEach((qaId, i) => {
    const records = parseFlagHash(hashes[i] as Record<string, unknown> | null);
    // An emptied hash can linger in the index (see setFlag's ordering note, or
    // a manual HDEL). Treat it as unflagged rather than showing a zero badge.
    if (records.length > 0) out.set(qaId, records);
  });
  return out;
}
