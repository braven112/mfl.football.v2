/**
 * Phase 6b — Trade-Offer redaction helper.
 *
 * Converts a raw MFL pendingTrade row into a sanitized TradeOfferTip shape
 * that the LLM can safely consume. Strips player names, franchise names,
 * pick slot numbers. Computes volume / division / player-escalation hints.
 *
 * Companion to scripts/schefter-rumor-scan.mjs — pure function, no I/O.
 *
 * Inputs:
 *   rawOffer        — MFL pendingTrade object (fields: id, franchise, franchise2,
 *                     franchise1_gave_up, franchise2_gave_up, timestamp, expires)
 *   offeringFid     — franchise id of the proposer (usually rawOffer.franchise)
 *   playerMap       — Map<playerId, { name, position, nflTeam }>
 *   teamMap         — Map<franchiseId, { name, division, nameShort, … }>
 *   counts          — { ownerOfferCount7d, divisionOfferCount7d, playerHistory }
 *                     where playerHistory is Map<playerId, distinctOffererCount21d>
 *
 * Output: { tip, debug } where `tip` matches TradeOfferTip from
 * src/types/schefter-tips.ts and `debug` records escalation + anti-leak logic
 * for dry-run logging.
 */

const ROUND_ORDINALS = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th',
  6: '6th', 7: '7th',
};

const CURRENT_PICK_REGEX = /^DP_(\d{1,2})_(\d{1,2})$/;
const FUTURE_PICK_REGEX = /^FP_(\d{4})_(\d{4})_(\d+)$/;

/**
 * Parse one asset token into { kind, position | round/year | raw }.
 * Slot numbers stripped on pick tokens (anti-deanonymization).
 */
function classifyAsset(token, playerMap, currentYear) {
  if (!token) return null;
  const m1 = token.match(FUTURE_PICK_REGEX);
  if (m1) {
    const year = m1[2];
    const round = parseInt(m1[3], 10);
    const ord = ROUND_ORDINALS[round] ?? `${round}th`;
    return { kind: 'pick', label: `${year} ${ord}` };
  }
  const m2 = token.match(CURRENT_PICK_REGEX);
  if (m2) {
    // DP_{round-1}_{slot-1} → round is 0-indexed, strip slot
    const round = parseInt(m2[1], 10) + 1;
    const ord = ROUND_ORDINALS[round] ?? `${round}th`;
    return { kind: 'pick', label: `${currentYear} ${ord}` };
  }
  if (/^BB_/.test(token)) {
    return { kind: 'bbid' };
  }
  // Otherwise treat as player id
  const player = playerMap.get(token);
  if (player) {
    return {
      kind: 'player',
      playerId: token,
      position: player.position,
      name: player.name,
    };
  }
  return { kind: 'unknown', raw: token };
}

/** Parse a comma-sep asset string into classified tokens. */
function parseAssetString(str, playerMap, currentYear) {
  if (!str) return [];
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => classifyAsset(tok, playerMap, currentYear))
    .filter(Boolean);
}

function bucketVolumeHint(count) {
  if (count <= 1) return 'first_offer';
  if (count <= 3) return 'repeat_offer';
  return 'serial';
}

function tierForDistinctOfferers(n) {
  if (n >= 4) return 'named';
  if (n === 3) return 'tightened_circle';
  return 'base';
}

const TIER_RANK = { base: 0, tightened_circle: 1, named: 2 };

/**
 * Core redactor. Returns { tip, debug } or { skip: true, reason } if the
 * offer shouldn't be tipped (e.g. no resolvable assets).
 */
export function redactTradeOffer({
  rawOffer,
  offeringFid,
  playerMap,
  teamMap,
  counts,
  currentYear,
  framingHint = 'fresh',
  offerAgeMs = 0,
}) {
  const {
    ownerOfferCount7d = 1,
    divisionOfferCount7d = 0,
    playerHistory = new Map(),
  } = counts || {};

  const side1 = parseAssetString(rawOffer.franchise1_gave_up, playerMap, currentYear);
  const side2 = parseAssetString(rawOffer.franchise2_gave_up, playerMap, currentYear);
  const allAssets = [...side1, ...side2];

  if (allAssets.length === 0) {
    return { skip: true, reason: 'no resolvable assets' };
  }

  // Position tokens (dedupe, drop falsy, uppercase)
  const positionTokens = [
    ...new Set(
      allAssets
        .filter((a) => a.kind === 'player' && a.position)
        .map((a) => String(a.position).toUpperCase()),
    ),
  ];

  // Pick tokens (dedupe)
  const pickTokens = [
    ...new Set(allAssets.filter((a) => a.kind === 'pick').map((a) => a.label)),
  ];

  // Volume
  const volumeHint = bucketVolumeHint(ownerOfferCount7d);

  // Division hint — only if ≥2 offers in the rolling division window
  const offeringTeam = teamMap.get(offeringFid);
  const division = offeringTeam?.division;
  const divisionHint = divisionOfferCount7d >= 2 && division ? division : undefined;

  // Player escalation — find the highest-tier player in this offer
  let escalatedPlayer;
  let bestRank = -1;
  for (const a of allAssets) {
    if (a.kind !== 'player') continue;
    const n = playerHistory.get(a.playerId) ?? 0;
    const tier = tierForDistinctOfferers(n);
    const rank = TIER_RANK[tier];
    if (rank > bestRank && tier !== 'base') {
      bestRank = rank;
      escalatedPlayer = {
        name: a.name,
        position: a.position ?? 'UNK',
        tier,
        distinctOfferers: n,
      };
    }
  }

  // Anti-deanonymization: drop combinations that telegraph the trade
  const antiLeak = { dropped: [] };

  // Rule A: never combine position + specific pick round + division hint
  let finalPositionTokens = positionTokens;
  let finalPickTokens = pickTokens;
  let finalDivisionHint = divisionHint;
  const hasPos = finalPositionTokens.length > 0;
  const hasPick = finalPickTokens.length > 0;
  const hasDiv = !!finalDivisionHint;
  if (hasPos && hasPick && hasDiv) {
    // Drop the weakest: division hint (position + pick carry more content)
    antiLeak.dropped.push('divisionHint (pos+pick+div too specific)');
    finalDivisionHint = undefined;
  }

  // Rule B: named tier → drop divisionHint and pickTokens (name carries enough)
  if (escalatedPlayer?.tier === 'named') {
    if (finalDivisionHint) antiLeak.dropped.push('divisionHint (named tier)');
    if (finalPickTokens.length) antiLeak.dropped.push(`pickTokens [${finalPickTokens.join(',')}] (named tier)`);
    finalDivisionHint = undefined;
    finalPickTokens = [];
  }

  const offerId = String(rawOffer.id || rawOffer.trade_id || '');

  /** @type {import('../../src/types/schefter-tips').TradeOfferTip} */
  const tip = {
    id: `to_${offerId}`,
    source: 'trade_offer',
    attributable: false,
    topic: 'trade',
    submittedAt: Date.now(),
    text: '',
    volumeHint,
    positionTokens: finalPositionTokens,
    pickTokens: finalPickTokens,
    divisionHint: finalDivisionHint,
    escalatedPlayer,
    framingHint,
    offerAgeMs,
    offerId,
    offeringFranchiseId: offeringFid,
  };

  const debug = {
    offerId,
    offeringFid,
    rawSide1Count: side1.length,
    rawSide2Count: side2.length,
    ownerOfferCount7d,
    divisionOfferCount7d,
    division,
    escalationSurvey: allAssets
      .filter((a) => a.kind === 'player')
      .map((a) => ({
        playerId: a.playerId,
        name: a.name,
        position: a.position,
        distinctOfferers21d: playerHistory.get(a.playerId) ?? 0,
        tier: tierForDistinctOfferers(playerHistory.get(a.playerId) ?? 0),
      })),
    antiLeak,
    finalTokens: {
      positionTokens: finalPositionTokens,
      pickTokens: finalPickTokens,
      divisionHint: finalDivisionHint,
      escalatedPlayer,
    },
  };

  return { tip, debug };
}

/**
 * Per-run probability for posting a trade-offer rumor.
 *
 * Base p=0.025 per 15-minute scanner run. The cron is `*\/15 * * * *` but
 * GitHub Actions skips/queues cron jobs under platform load AND quiet-hours
 * (23:00–07:00 PT) hard-skip ~32 cycles/day, so the effective dice-roll
 * count is closer to 30–50 rolls/day per offer than the nominal 96. At the
 * current base:
 *   - 30 rolls/day → ~53% by 24h, ~78% by 48h
 *   - 50 rolls/day → ~72% by 24h, ~92% by 48h
 *   - 96 rolls/day → ~91% by 24h, ~99% by 48h
 * Trade offers usually file within a day or two while keeping a real per-run
 * dice roll — unposted offers can still fail forever; that's the design.
 *
 * History: was 0.0075 (~20%/24h at realistic cadence). Bumped to 0.025 on
 * 2026-04-30 (PR #141): trade proposals are TheLeague's highest-engagement
 * Schefter content, so we'd rather report them quickly than have them age out.
 *
 * The 48h framing flip from "fresh" to "lingering" ("offered but phones aren't
 * picking up") is handled in scanTradeOffers, not here. The probability itself
 * does not change with age.
 *
 * Exponential scaling on shopping volume: when the *effective* distinct
 * offerers for the most-shopped player in this offer is ≥2, multiply the
 * base by `OFFER_VOLUME_BOOST_FACTOR ^ (effectiveOfferers - 1)` and cap at
 * `OFFER_VOLUME_BOOST_MAX` so the per-run probability never exceeds ~10%.
 * Effective count blends real submitted offerers (full weight) with saved
 * trade-builder drafts (0.4 weight, computed in the scanner).
 *
 * The exponential growth is intentional — it keeps the per-run probability
 * vague at low volume (owner can't tell whether their move tipped Schefter)
 * while accelerating the pass on heavily-shopped players. Combined with the
 * tier-cap on draft-only contribution, this gives Schefter speed without
 * letting him name names from soft signals.
 *
 * Exported for tests & dry-run logging.
 */
export const OFFER_POST_PROBABILITY = 0.025;
export const OFFER_VOLUME_BOOST_FACTOR = 1.5;
export const OFFER_VOLUME_BOOST_MAX = 4;

export function offerPostProbability(effectiveOfferers = 1) {
  const n = Number.isFinite(effectiveOfferers) ? Math.max(1, effectiveOfferers) : 1;
  const raw = Math.pow(OFFER_VOLUME_BOOST_FACTOR, n - 1);
  const multiplier = Math.min(OFFER_VOLUME_BOOST_MAX, raw);
  return OFFER_POST_PROBABILITY * multiplier;
}

export { bucketVolumeHint, tierForDistinctOfferers, classifyAsset, parseAssetString };
