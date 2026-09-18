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

function assertSeasonYear(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new TypeError(`owners-poll: invalid season year ${JSON.stringify(year)}`);
  }
  return year;
}

/**
 * Redis HASH holding a league's STANDING ballots for one season:
 * field = franchiseId, value = ballot record.
 *
 * This is the whole standing-vote model. A ballot is not a thing you file each
 * week — it is your current opinion, and it counts in every snapshot until you
 * change it. So there is one hash per SEASON, never one per week, and nothing
 * clears it.
 *
 * **Why season-scoped rather than one permanent key.** A standing vote must
 * not survive the offseason. Franchises change between seasons — an expansion,
 * a rebrand, an owner leaving — and a ballot cast in Week 14 silently counting
 * as your Week 1 vote the following September is a vote nobody cast. Keying on
 * the season makes the reset automatic and auditable: no deletion cron to
 * forget, no TTL to get wrong, and last season's hash is simply never read
 * again.
 *
 * The year is the SEASON year (`getCurrentSeasonYear`), not the league year.
 * The poll is results-shaped — it ranks how teams are playing — so it rolls at
 * Labor Day with the standings, not on MFL's February league rollover.
 *
 * A hash rather than one key per franchise, for three reasons that all still
 * hold: HGETALL reads the league in a single round trip (no SCAN over a
 * keyspace, which Upstash bills per call and which can miss keys mid-write);
 * HLEN answers "how many owners have a ballot on file?" for the public meter
 * without transferring — or exposing — a single ballot; and per-field writes
 * are atomic, so two owners submitting at the same instant cannot clobber each
 * other the way a read-modify-write on one JSON blob would.
 *
 * **No TTL.** A standing vote that silently expires is a vote the owner thinks
 * they still have. The season key is the only lifetime bound.
 */
export function ownersPollStandingKey(navSlug, seasonYear) {
  assertScope(navSlug);
  assertSeasonYear(seasonYear);
  return `${OWNERS_POLL_PREFIX}:${navSlug}:standing:${seasonYear}`;
}

/**
 * How long a ballot may sit untouched before the site asks whether it still
 * stands.
 *
 * Standing votes have one failure mode, and it is not turnout: an owner who
 * never revisits their ballot is republished every week as though they
 * re-affirmed it, so by midseason a chunk of the consensus is inertia rather
 * than opinion. Three weeks is long enough that standing pat reads as
 * deliberate, short enough to catch drift before it dominates the tally.
 */
export const STALE_BALLOT_WEEKS = 3;

/**
 * Has this ballot gone unexamined long enough to prompt?
 *
 * Takes `now` explicitly — never reads the clock — so the island, the push
 * builder and the tests all agree. A record with no usable `updatedAt` is NOT
 * stale: an unparseable timestamp is a storage question, and prompting on it
 * would nag every owner over a bug none of them can fix.
 */
export function isBallotStale(updatedAt, now, weeks = STALE_BALLOT_WEEKS) {
  const then = Date.parse(updatedAt ?? '');
  if (!Number.isFinite(then)) return false;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return false;
  return nowMs - then >= weeks * 7 * 86400 * 1000;
}

/**
 * Redis HASH holding one week's ballots: field = franchiseId, value = ballot.
 *
 * LEGACY — the week-scoped shape the poll used before ballots became standing
 * votes. Retained for `scripts/owners-poll-adopt-standing.mjs`, the one-shot
 * that lifts an existing week's ballots into the standing hash. Nothing on the
 * live path writes here any more.
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
export function buildBallotRecord({ franchiseId, ranking, now, previous, seasonYear }) {
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    franchiseId: normalizeFranchiseId(franchiseId),
    ranking,
    // The owner's FIRST ballot of the season. Under standing votes this no
    // longer means "when they voted this week" — it means when they first had
    // an opinion on file, and it never moves again.
    submittedAt: previous?.submittedAt ?? iso,
    // Last edit. This is the load-bearing one now: it is what makes a ballot
    // that has stood for five weeks visibly five weeks old rather than being
    // republished each week as a fresh opinion.
    updatedAt: iso,
    // Stamped so a mis-keyed read is DETECTABLE rather than silent — the same
    // reason the hash field is treated as the authoritative franchise id.
    seasonYear: Number.isInteger(seasonYear) ? seasonYear : (previous?.seasonYear ?? null),
  };
}

/**
 * Re-affirm a standing ballot without changing it.
 *
 * Bumps `updatedAt` and nothing else. The ranking is taken from the STORED
 * record, never from the client: an owner who edited their ballot on a phone
 * and then pressed "Still good" on a stale desktop tab must not have the older
 * ranking written back over the newer one. The client sends no ranking at all,
 * so that race cannot be expressed.
 *
 * Returns null when there is nothing on file to affirm.
 */
export function affirmBallotRecord(previous, now) {
  if (!previous || !Array.isArray(previous.ranking)) return null;
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  return { ...previous, updatedAt: iso };
}

/**
 * Parse a stored ballot defensively.
 *
 * The close pass reads whatever is in Redis, which may predate a slots change
 * or a franchise leaving the league. A ballot that no longer validates is
 * DROPPED rather than repaired: silently padding or truncating it would put
 * an opinion nobody cast into the published consensus.
 */
export function parseStoredBallot(value, { slots, eligibleFranchiseIds, seasonYear = null }) {
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

  // A record stamped for a DIFFERENT season is not this season's opinion, and
  // reading one means a key was built wrong somewhere. Drop it loudly-by-
  // absence rather than tallying last year's ballot into this year's poll.
  // Records with no stamp at all predate standing votes and are accepted —
  // the adopt one-shot lifts them without inventing a year.
  if (
    seasonYear != null &&
    record.seasonYear != null &&
    Number(record.seasonYear) !== Number(seasonYear)
  ) {
    return null;
  }

  return {
    franchiseId,
    ranking: result.ranking,
    submittedAt: typeof record.submittedAt === 'string' ? record.submittedAt : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    seasonYear: record.seasonYear == null ? null : Number(record.seasonYear),
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
