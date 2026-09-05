/**
 * The Owners' Poll — ballot shape, validation, and KV key construction.
 *
 * Plain .mjs for the same dual-consumer reason as franchise-id.mjs and
 * pecking-order-season-window.mjs: BOTH the API routes (src/pages/api,
 * TypeScript) and the close pass (scripts/generate-pecking-order.mjs, node)
 * ask these questions, and a validation rule that exists twice is a rule that
 * will eventually disagree with itself. Anything here is shared by both sides
 * on purpose; the tally math the generator alone needs lives in
 * scripts/lib/owners-poll-math.mjs.
 *
 * See docs/plans/owners-poll.md.
 */

import { normalizeFranchiseId } from './franchise-id.mjs';

/**
 * KV key namespace. Every key is scoped by the league's NAV SLUG, always —
 * there is no bare/legacy form and no default fallback.
 *
 * That is a deliberate departure from rankings-scope.ts#scopedKvKey, whose
 * conditional shape (`ri:0001` for TheLeague, `ri:afl:0001` for everyone
 * else) exists only to keep pre-existing owner data readable. The poll has no
 * legacy keys to preserve, so it takes the safe shape instead: **both leagues
 * have a franchise 0001**, and an unscoped key is genuinely ambiguous the
 * moment a second league writes to it. Reusing the conditional builder would
 * also import its fail-open default, where an unattributable session silently
 * addresses TheLeague's bucket.
 */
export const OWNERS_POLL_PREFIX = 'poll';

/** Nav slugs are the scope segment; reject anything that isn't one. */
const NAV_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function assertScope(navSlug) {
  if (typeof navSlug !== 'string' || !NAV_SLUG_RE.test(navSlug)) {
    throw new TypeError(`owners-poll: invalid league scope ${JSON.stringify(navSlug)}`);
  }
  return navSlug;
}

function assertWeek(year, week) {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new TypeError(`owners-poll: invalid year ${JSON.stringify(year)}`);
  }
  if (!Number.isInteger(week) || week < 1 || week > 25) {
    throw new TypeError(`owners-poll: invalid week ${JSON.stringify(week)}`);
  }
}

/**
 * Redis HASH holding one week's ballots: field = franchiseId, value = ballot.
 *
 * A hash rather than one key per franchise for two reasons that both matter at
 * close time: HGETALL reads the whole week in a single round trip (no SCAN
 * over a keyspace, which Upstash bills per call and which can miss keys
 * mid-write), and HLEN answers "how many ballots are in?" for the public
 * turnout meter without transferring — or exposing — a single ballot.
 *
 * Per-field writes are atomic, so two owners submitting at the same instant
 * cannot clobber each other the way a read-modify-write on one JSON blob
 * would.
 */
export function ownersPollBallotsKey(navSlug, year, week) {
  assertScope(navSlug);
  assertWeek(year, week);
  return `${OWNERS_POLL_PREFIX}:${navSlug}:${year}-w${week}`;
}

/**
 * Pointer to the week whose ballot is currently accepting votes, written by
 * the Tuesday pass and cleared by the close pass. Holds
 * `{ year, week, opensAt, closesAt }` (ISO strings).
 *
 * The API reads its open/closed state from HERE rather than from the issue
 * JSON on disk, so a route never has to do a filesystem read to answer
 * "is the ballot open?" and there is exactly one writer of that fact.
 */
export function ownersPollCurrentKey(navSlug) {
  assertScope(navSlug);
  return `${OWNERS_POLL_PREFIX}:${navSlug}:current`;
}

/**
 * Where a ballot sits relative to its window.
 *
 * Pure and takes `now` explicitly so both the route and the tests can pin it —
 * never reads the clock itself. Anything malformed or missing is `closed`,
 * which fails CLOSED: an unparseable window must not accept writes.
 */
export function resolveBallotWindow(now, window) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return 'closed';
  const opens = Date.parse(window?.opensAt ?? '');
  const closes = Date.parse(window?.closesAt ?? '');
  if (!Number.isFinite(opens) || !Number.isFinite(closes)) return 'closed';
  if (closes <= opens) return 'closed';
  if (nowMs < opens) return 'pending';
  if (nowMs >= closes) return 'closed';
  return 'open';
}

/**
 * Validate a submitted ballot.
 *
 * Returns `{ ok: true, ranking }` with normalized franchise ids, or
 * `{ ok: false, error }` with a message safe to hand back to the client.
 *
 * `eligibleFranchiseIds` is the league's actual roster of franchises. Checking
 * against it is not paranoia about typos — without it a ballot can name a
 * franchise id from ANOTHER league (both leagues number from 0001), and that
 * id would then be tallied, ranked, and rendered as if it were a team in this
 * one.
 *
 * Length is exact, not a minimum: Borda scoring assumes every ballot carries
 * the same point pool, so a short ballot is not a smaller opinion, it is a
 * differently-weighted one. Rejecting it here is what keeps the tally fair.
 */
export function validateBallot({ ranking, slots, eligibleFranchiseIds }) {
  if (!Number.isInteger(slots) || slots < 1) {
    return { ok: false, error: 'This league does not run the Owners’ Poll' };
  }
  if (!Array.isArray(ranking)) {
    return { ok: false, error: 'Ballot must be an array of franchise ids' };
  }
  if (ranking.length !== slots) {
    return { ok: false, error: `Ballot must rank exactly ${slots} teams` };
  }

  const eligible = new Set(
    Array.from(eligibleFranchiseIds ?? [], (id) => normalizeFranchiseId(id)),
  );
  if (eligible.size === 0) {
    return { ok: false, error: 'No eligible franchises for this league' };
  }

  const normalized = [];
  const seen = new Set();
  for (const raw of ranking) {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      return { ok: false, error: 'Ballot entries must be franchise ids' };
    }
    const fid = normalizeFranchiseId(raw);
    if (!fid) return { ok: false, error: 'Ballot entries must be franchise ids' };
    if (seen.has(fid)) {
      return { ok: false, error: 'A team may only appear once on a ballot' };
    }
    if (!eligible.has(fid)) {
      return { ok: false, error: 'Ballot names a team that is not in this league' };
    }
    seen.add(fid);
    normalized.push(fid);
  }

  return { ok: true, ranking: normalized };
}

/**
 * Build the record actually stored in the hash.
 *
 * `submittedAt` is preserved across edits and `updatedAt` moves, so the
 * accountability page can tell a first-hour voter from one who was still
 * tinkering at the deadline — and so a re-submission never looks like a
 * fresh ballot.
 */
export function buildBallotRecord({ franchiseId, ranking, now, previous }) {
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    franchiseId: normalizeFranchiseId(franchiseId),
    ranking,
    submittedAt: previous?.submittedAt ?? iso,
    updatedAt: iso,
  };
}

/**
 * Parse a stored ballot defensively.
 *
 * The close pass reads whatever is in Redis, which may predate a slots change
 * or a franchise leaving the league. A ballot that no longer validates is
 * DROPPED rather than repaired: silently padding or truncating it would put
 * an opinion nobody cast into the published consensus.
 */
export function parseStoredBallot(value, { slots, eligibleFranchiseIds }) {
  let record = value;
  if (typeof record === 'string') {
    try {
      record = JSON.parse(record);
    } catch {
      return null;
    }
  }
  if (!record || typeof record !== 'object') return null;

  const result = validateBallot({ ranking: record.ranking, slots, eligibleFranchiseIds });
  if (!result.ok) return null;

  const franchiseId = normalizeFranchiseId(record.franchiseId);
  if (!franchiseId || !new Set(
    Array.from(eligibleFranchiseIds ?? [], (id) => normalizeFranchiseId(id)),
  ).has(franchiseId)) {
    return null;
  }

  return {
    franchiseId,
    ranking: result.ranking,
    submittedAt: typeof record.submittedAt === 'string' ? record.submittedAt : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
  };
}

/**
 * Parse the current-window pointer.
 *
 * The record is written by the Tuesday pass and carries the league's roster of
 * franchises alongside the window. That list travels WITH the window on
 * purpose: it is what the API validates ballots against, and sourcing it here
 * rather than from a config file means (a) a route never does a filesystem
 * read or a static import of one league's config, and (b) the ballots the API
 * accepts are validated against exactly the field the close pass will tally.
 *
 * Returns null for anything malformed — a missing or unparseable pointer means
 * "no ballot is open", which is the safe reading.
 */
export function parseStoredWindow(value) {
  let record = value;
  if (typeof record === 'string') {
    try {
      record = JSON.parse(record);
    } catch {
      return null;
    }
  }
  if (!record || typeof record !== 'object') return null;

  const year = Number(record.year);
  const week = Number(record.week);
  if (!Number.isInteger(year) || !Number.isInteger(week)) return null;
  try {
    assertWeek(year, week);
  } catch {
    return null;
  }

  if (!Number.isFinite(Date.parse(record.opensAt ?? ''))) return null;
  if (!Number.isFinite(Date.parse(record.closesAt ?? ''))) return null;

  const eligible = Array.isArray(record.eligibleFranchiseIds)
    ? Array.from(new Set(record.eligibleFranchiseIds.map((id) => normalizeFranchiseId(id)))).filter(Boolean)
    : [];
  if (eligible.length === 0) return null;

  const slots = Number(record.slots);
  if (!Number.isInteger(slots) || slots < 1 || slots >= eligible.length) return null;

  return {
    year,
    week,
    opensAt: record.opensAt,
    closesAt: record.closesAt,
    slots,
    eligibleFranchiseIds: eligible,
  };
}
