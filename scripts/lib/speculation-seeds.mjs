/**
 * Speculation seeds — what an expired trade proposal leaves behind.
 *
 * Written by the rumor scanner (`schefter-rumor-scan.mjs`) when MFL's own
 * `expires` timestamp passes on a proposal; read by the daily speculation
 * scanner (`schefter-trade-speculation.mjs`) as an availability signal.
 *
 * ## Only the proposer's half is signal
 *
 * A proposal has two sides and they mean completely different things:
 *
 *   - The PROPOSER's side is a statement about their own roster. They offered
 *     these players; they are willing to move them. That is the same kind of
 *     fact as listing someone on the public trade block, arrived at privately.
 *     The positions they asked for in return are, likewise, their own stated
 *     need.
 *   - The RECIPIENT's side is not their statement at all. Someone else asked
 *     about their player. Treating that as "available" would publish a
 *     willingness the owner never expressed — the single worst thing this lane
 *     can do, and the reason the trade-offer redactor exists.
 *
 * So a seed carries the proposer's offered players, their asked-for positions,
 * and nothing about the recipient except the id needed to KEEP THEM OUT: the
 * recipient is excluded as a counterparty for candidates built from this seed,
 * so speculation can never wander back onto the real pairing and republish a
 * private proposal as a guess.
 *
 * ## Never write a seed to disk
 *
 * Seeds contain unpublished proposals. Every other artifact in the speculation
 * lane (`speculation-history.json`) is committed to the repo, which is exactly
 * what a seed must not be — committing one would publish, permanently and to
 * everyone, the proposals this whole subsystem exists to meter out. Redis only,
 * with the same 30-day TTL as the rest of the trade-offer state.
 */

import { schefterKey } from './schefter-keys.mjs';

/** How long an expired proposal keeps counting as an availability signal. */
export const SEED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SEED_TTL_SEC = SEED_TTL_MS / 1000;

/** Both lanes must agree on this key; `tests/speculation-seeds.test.ts` pins it. */
export function speculationSeedsKey(navSlug) {
  return schefterKey(navSlug, 'trade_offers:seeds');
}

const PICK_PREFIXES = /^(DP_|FP_|BB_)/;

function assetIds(str) {
  return String(str || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Turn an expired proposal into a seed.
 *
 * `offeringFid` is the proposer — resolved upstream by
 * `resolveOriginatorFid`, because MFL's owner-view rows omit `franchise` and
 * carry the proposer's name only inside a description string. Getting that
 * backwards would invert the entire rule above, so the caller passes it rather
 * than this module guessing from the row.
 */
export function buildSeedFromProposal({ rawOffer, offeringFid, playerMap, expiredAtMs }) {
  const proposerFid = String(offeringFid || '').padStart(4, '0');
  if (!proposerFid || proposerFid === '0000') return null;

  const proposerIsSide1 = String(rawOffer?.franchise ?? '').padStart(4, '0') === proposerFid;
  const offeredStr = proposerIsSide1 ? rawOffer?.franchise1_gave_up : rawOffer?.franchise2_gave_up;
  const askedStr = proposerIsSide1 ? rawOffer?.franchise2_gave_up : rawOffer?.franchise1_gave_up;

  const offeredPlayerIds = assetIds(offeredStr).filter((id) => !PICK_PREFIXES.test(id));
  // The positions they asked FOR — read off the recipient's players, but kept
  // as bare positions. A position is the proposer's own stated need; the
  // player ids behind it belong to the other owner and never leave this
  // function.
  const askedPositions = [
    ...new Set(
      assetIds(askedStr)
        .filter((id) => !PICK_PREFIXES.test(id))
        .map((id) => playerMap?.get?.(id)?.position)
        .filter(Boolean)
        .map((p) => String(p).toUpperCase()),
    ),
  ];

  // A proposal of picks-for-picks tells us nothing about anyone's roster.
  if (offeredPlayerIds.length === 0 && askedPositions.length === 0) return null;

  const recipientFid = String(rawOffer?.offeredto || rawOffer?.franchise2 || rawOffer?.franchise || '')
    .padStart(4, '0');

  return {
    offerId: String(rawOffer?.id || rawOffer?.trade_id || ''),
    proposerFid,
    // Stored ONLY so the matcher can exclude them. Never a signal, never
    // published, never read as availability.
    excludedCounterpartyFid: recipientFid && recipientFid !== proposerFid ? recipientFid : null,
    offeredPlayerIds,
    askedPositions,
    expiredAtMs: Number(expiredAtMs) || Date.now(),
  };
}

/** Persist one seed. Best effort — a seed is an enhancement, never a gate. */
export async function writeSeed({ redis, navSlug, seed, log, warn }) {
  if (!redis || !seed?.offerId) return false;
  const key = speculationSeedsKey(navSlug);
  try {
    await redis.hset(key, { [seed.offerId]: JSON.stringify(seed) });
    await redis.expire(key, SEED_TTL_SEC);
    log?.(
      `  [seed] expired proposal ${seed.offerId} → speculation seed `
        + `(proposer ${seed.proposerFid}, ${seed.offeredPlayerIds.length} player(s) offered, `
        + `wants ${seed.askedPositions.join('/') || 'none'})`,
    );
    return true;
  } catch (err) {
    warn?.(`  [seed] hset failed for ${seed.offerId}: ${err.message}`);
    return false;
  }
}

/** Read every seed still inside the TTL window. */
export async function readActiveSeeds({ redis, navSlug, nowMs = Date.now(), warn }) {
  if (!redis) return [];
  const key = speculationSeedsKey(navSlug);
  let raw;
  try {
    raw = await redis.hgetall(key);
  } catch (err) {
    warn?.(`[speculation] seeds unreadable: ${err.message} — proceeding without them`);
    return [];
  }
  const cutoff = nowMs - SEED_TTL_MS;
  const seeds = [];
  for (const entry of Object.values(raw ?? {})) {
    try {
      const seed = typeof entry === 'string' ? JSON.parse(entry) : entry;
      if (!seed?.proposerFid) continue;
      if (Number(seed.expiredAtMs) < cutoff) continue;
      seeds.push(seed);
    } catch {
      // A malformed seed is not worth failing a run over.
    }
  }
  return seeds;
}

/**
 * Collapse seeds into the three things the matcher needs.
 *
 * `availableByFid` and `wantsByFid` are keyed by the PROPOSER only — a
 * recipient never gains availability or wants from someone else's ask.
 * `excludedPairs` holds `proposer::recipient` keys so a candidate built off a
 * seed cannot pair the two franchises that actually talked.
 */
export function seedSignals(seeds) {
  const availableByFid = new Map();
  const wantsByFid = new Map();
  const excludedPairs = new Set();

  for (const seed of seeds ?? []) {
    const fid = String(seed.proposerFid);
    if (!availableByFid.has(fid)) availableByFid.set(fid, new Set());
    for (const id of seed.offeredPlayerIds ?? []) availableByFid.get(fid).add(String(id));

    if (!wantsByFid.has(fid)) wantsByFid.set(fid, new Set());
    for (const pos of seed.askedPositions ?? []) wantsByFid.get(fid).add(String(pos).toUpperCase());

    if (seed.excludedCounterpartyFid) {
      excludedPairs.add(pairKey(fid, seed.excludedCounterpartyFid));
    }
  }

  return { availableByFid, wantsByFid, excludedPairs };
}

/** Order-independent key for a franchise pair. */
export function pairKey(a, b) {
  return [String(a), String(b)].sort().join('::');
}
