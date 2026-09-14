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
 *   exposureCount   — number of prior successful dice-roll signals on THIS
 *                     offer (0 = no posts yet). The post about to ship is at
 *                     signal `exposureCount + 1`. Drives graduated disclosure:
 *                       signal 1 → name 1 team
 *                       signal 2 → team + the deal's shape, no new name
 *                       signal 3 → team + 1 marquee player
 *                       signal 4 → team + a market beat, no new name, etc.
 *                     A name lands every OTHER signal now — see
 *                     `plannedPlayerCount` in schefter-offer-beats.mjs.
 *   rosterOwnerByPlayerId — Map<playerId, franchiseId> from the league's own
 *                     rosters feed. A pending proposal has not executed, so
 *                     every player in it is still rostered by the franchise
 *                     giving him up — which makes this an exact check on the
 *                     row's side/franchise binding rather than a heuristic.
 *                     Optional; absent, the row is taken at its word (the
 *                     pre-2026-09-10 behaviour).
 *   blockByFid      — Map<franchiseId, Set<playerId>> of each franchise's
 *                     PUBLIC trade block. Optional; a MISSING franchise and an
 *                     EMPTY block mean different things, which is why it is a
 *                     Map and not a plain object of arrays.
 *   positionRuns    — Map<position, proposalCount> across the proposals this
 *                     scan can see. A floor, never a total — the beats hedge.
 *   previousShape   — `assetShapeOf` from the last scan that saw this proposal.
 *                     Absent on first sight; a differing hash is the
 *                     "they changed the ask" beat.
 *   priorPairCount  — earlier proposals between the same franchise pair in our
 *                     own archive. A floor, like every other count here.
 *   closure         — { reason: 'accepted' | 'expired', daysOpen, priorPosts }
 *                     when the proposal is OVER. Holds the exposure signal
 *                     rather than advancing it, and the closure beat leads.
 *   nowMs           — clock, injectable for tests (expiry beat).
 *   adpRankByPlayerId — Map<playerId, number> for marquee ordering. Optional;
 *                     players without a rank sort last (least marquee).
 *
 * Output: { tip, debug } where `tip` matches TradeOfferTip from
 * src/types/schefter-tips.ts and `debug` records escalation + anti-leak logic
 * for dry-run logging.
 */

import {
  assetShapeOf,
  buildAskChangedBeat,
  buildClosureBeat,
  buildDealShape,
  buildExpiryBeat,
  buildMarketBeats,
  buildReOfferBeat,
  padFid,
  planBeats,
  plannedPlayerCount,
} from './schefter-offer-beats.mjs';

const ROUND_ORDINALS = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th',
  6: '6th', 7: '7th',
};

const CURRENT_PICK_REGEX = /^DP_(\d{1,2})_(\d{1,2})$/;
const FUTURE_PICK_REGEX = /^FP_(\d{4})_(\d{4})_(\d+)$/;

/**
 * Deterministic 0/1 coin-flip from an offerId. djb2-lite — pure, no crypto
 * needed (we just need a stable, fairly-distributed bit). Used to pick
 * WHICH of the two franchises gets named at signal=1; both later signals
 * reference the same team, so subsequent posts build on the first reveal
 * instead of flipping.
 */
function hashOfferIdToBit(offerId) {
  const s = String(offerId || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 2;
}

function pickDisplayTeam(team) {
  if (!team) return null;
  const name = team.name || team.nameMedium || team.nameShort || null;
  if (!name) return null;
  const out = { name };
  if (team.nameShort) out.nameShort = team.nameShort;
  return out;
}

/**
 * Does the league's roster data place `asset` on `fid`?
 *
 * `true` when the rosters have never heard of the player: a feed snapshot that
 * predates a rookie must not be able to veto an otherwise sound row.
 */
function rosterAgrees(rosterOwnerByPlayerId, asset, fid) {
  const owner = rosterOwnerByPlayerId?.get?.(String(asset?.playerId));
  return !owner || padFid(owner) === padFid(fid);
}

/**
 * Which franchise is giving up which side.
 *
 * `franchise1_gave_up` is fid1's players and `franchise2_gave_up` is fid2's —
 * that is what the field names say, and when the row is well-formed the trade
 * itself tells us who owns whom with nothing else consulted. The failure mode
 * is that the row is not always well-formed. Rows reach this lane from three
 * places — the commish's league-wide read, a per-franchise read, and an owner
 * self-report normalized by `src/utils/owner-trade-reports.ts#normalizeRaw` —
 * and only the first is guaranteed to carry MFL's commish-view semantics. The
 * other two derive `franchise` (the ORIGINATOR) separately from the two asset
 * strings, so a row can arrive with its ids right and its SIDES INVERTED, and
 * nothing downstream could tell.
 *
 * That shipped on 2026-09-10: "Fire have been shopping Cyrus Allen and a 2027
 * second — looking for a running back". Cyrus Allen is a Bring The Pain player;
 * Fire Ready Aim was the team being ASKED. `buildExposure` did exactly what it
 * was told — name the chosen franchise's own side — and the chosen franchise's
 * own side held somebody else's players. Replaying the real offer through the
 * plausible row shapes reproduces that sentence from exactly one of them: ids
 * correct, sides swapped.
 *
 * So the row STATES the binding and the roster PROVES it. A pending proposal
 * has not executed, so every player in it is still rostered by the franchise
 * giving him up — which makes roster ownership an exact check here rather than
 * a heuristic:
 *
 *   - Two DISTINCT, non-empty ids or nothing. `sidesByFid` is an object
 *     literal: `fid1 === fid2` silently drops one side on top of the other and
 *     hands BOTH teams' players to one franchise, and an empty id parks a side
 *     under `''`, where `buildDealShape`'s `getsFid` scan skips it and the deal
 *     loses its other half. Neither is recoverable from — refuse to attribute.
 *   - Score both orientations against the rosters and take the winner.
 *   - Refuse on any other outcome. A tie with evidence on both sides, or a
 *     winner the rosters still contradict, means the row disagrees with itself;
 *     a post that names nobody is a post nobody is accused by.
 *
 * The franchise ORDER (`fids`) is the row's, never the orientation's, so
 * correcting a swapped row does not move the coin flip in `buildExposure` and
 * a later signal about the same offer still names the same team.
 *
 * `attributable: false` carries an EMPTY map, which is what makes every
 * downstream name surface — exposure, deal shape, the block beats — degrade to
 * naming nobody rather than naming a guess.
 */
export function attributeSides({ fid1, fid2, side1, side2, rosterOwnerByPlayerId }) {
  let a = padFid(fid1);
  let b = padFid(fid2);
  /**
   * Annotated because the refuse path returns a bare `{}`, which unions with
   * the success path's `{ [fid]: side }` to `{} | { [x: string]: any }` — and
   * indexing the `{}` half is an implicit any at every call site and in every
   * test. The empty map is a real value here (it is what makes an
   * unattributable row name nobody), so the fix is to say its type once.
   * @type {(reason: string) => { sidesByFid: Record<string, any[]>, fids: string[], attributable: boolean, verified: boolean, corrected: boolean, reason: string }}
   */
  const refuse = (reason) => ({
    sidesByFid: /** @type {Record<string, any[]>} */ ({}),
    fids: [],
    attributable: false,
    verified: false,
    corrected: false,
    reason,
  });

  // The one franchise the rosters put EVERY known player on this side with.
  // Empty when the side is picks-only, when no player on it is rostered, or
  // when its players are split across franchises (which is not a side).
  const inferFrom = (side) => {
    const owners = new Set();
    for (const asset of side || []) {
      if (!asset || asset.kind !== 'player' || !asset.playerId) continue;
      const owner = rosterOwnerByPlayerId?.get?.(String(asset.playerId));
      if (owner) owners.add(padFid(owner));
    }
    return owners.size === 1 ? [...owners][0] : '';
  };

  // An id that is missing, or the SAME on both halves, cannot key a side.
  // Rather than drop the proposal, ask the rosters who is giving each side up
  // — which is the question the ids were standing in for. Only a pair of
  // distinct, confident answers is accepted; anything less refuses, because a
  // half-inferred pair is a guess wearing a fact's clothes.
  let inferred = false;
  if (!a || !b || a === b) {
    const inferredA = inferFrom(side1);
    const inferredB = inferFrom(side2);
    if (inferredA && inferredB && inferredA !== inferredB) {
      a = inferredA;
      b = inferredB;
      inferred = true;
    } else if (!a || !b) {
      return refuse('missing franchise id, and the rosters cannot supply it');
    } else {
      return refuse(`both sides resolved to ${a}, and the rosters cannot separate them`);
    }
  }

  // +1 per player the rosters place on the side being scored, -1 per player
  // they place elsewhere, 0 for a player they do not know.
  const agreement = (side, fid) => (side || []).reduce((n, asset) => {
    if (!asset || asset.kind !== 'player' || !asset.playerId) return n;
    const owner = rosterOwnerByPlayerId?.get?.(String(asset.playerId));
    if (!owner) return n;
    return padFid(owner) === fid ? n + 1 : n - 1;
  }, 0);

  const asIs = agreement(side1, a) + agreement(side2, b);
  const swapped = agreement(side1, b) + agreement(side2, a);

  // How many players the rosters can actually speak to. Counted separately
  // from the scores because a score of zero has two meanings and they must not
  // be merged: "nobody in this deal is on a roster we hold" is no evidence,
  // while "the evidence cancels out" is a row contradicting itself. Reading
  // both as the former took a deal whose two sides claimed the SAME
  // franchise's player and shipped it on the row's word.
  const known = [side1, side2].reduce((n, side) => n + (side || []).filter(
    (asset) => asset && asset.kind === 'player' && asset.playerId
      && rosterOwnerByPlayerId?.get?.(String(asset.playerId)),
  ).length, 0);

  // No roster evidence at all (no roster file, or only unknown players): take
  // the row at its word. This is the pre-roster behaviour, kept so a missing
  // feed degrades to "as good as we were" rather than to silence.
  if (known === 0) {
    return {
      sidesByFid: { [a]: side1, [b]: side2 },
      fids: [a, b],
      attributable: true,
      verified: inferred,
      corrected: false,
      ...(inferred ? { inferred: true } : {}),
    };
  }
  if (asIs > swapped && asIs > 0) {
    return {
      sidesByFid: { [a]: side1, [b]: side2 },
      fids: [a, b],
      attributable: true,
      verified: true,
      corrected: false,
      ...(inferred ? { inferred: true } : {}),
    };
  }
  if (swapped > asIs && swapped > 0) {
    return {
      sidesByFid: { [a]: side2, [b]: side1 },
      fids: [a, b],
      attributable: true,
      verified: true,
      corrected: true,
      ...(inferred ? { inferred: true } : {}),
    };
  }
  return refuse(`rosters contradict both orientations (asIs=${asIs}, swapped=${swapped})`);
}

/**
 * Build the `exposure` block from the redaction inputs. Returns null when
 * exposureCount is 0 (no prior posts → no exposure yet, which signals
 * "this is the first post — exposure starts at signal=1").
 *
 * THE NAMED PLAYERS MUST BELONG TO THE NAMED TEAM. The prompt's signal-2
 * wording is "Hearing the [team] have [Player] on the table" — an assertion
 * that the team owns the player and is shopping him. This function used to
 * pick the team by coin flip and the players from BOTH sides of the offer
 * independently, so about half of all signal-2+ posts named a team that did
 * not own the player. That shipped: "the Mavericks have had Colston Loveland
 * on the table" when Loveland is a Pacific Pigskins player and Maverick was
 * trying to ACQUIRE him (reported by the commissioner, 2026-09-07). A wrong
 * trade attribution about a real owner's roster is the worst thing this lane
 * can print, and it reads as pure invention to the owner it names.
 *
 * `playersByFid` therefore replaces the old flat `playerAssets`: each side's
 * players stay attached to the franchise giving them up.
 *
 * Note on the off-by-one: callers pass the number of PRIOR posts. The post
 * we're building now is at `signal = exposureCount + 1`. So:
 *   exposureCount = 0 → signal 1 → name team only
 *   exposureCount = 1 → signal 2 → team only (the beat carries this post)
 *   exposureCount = 2 → signal 3 → team + 1 player
 * See `plannedPlayerCount` for the cadence and why it halved.
 */
function buildExposure({
  signal,
  offerId,
  teamMap,
  playersByFid,
  candidateFids,
  rosterOwnerByPlayerId,
  adpRankByPlayerId,
}) {
  if (!Number.isFinite(signal) || signal < 1) return null;

  // The ids come from `attributeSides`, which is also what keyed
  // `playersByFid` — one derivation, so the coin flip and the roster lookup
  // cannot disagree about which franchise is which. This function used to
  // re-derive them off `rawOffer`, in parallel with the caller doing the same,
  // and two derivations of one fact is the shape every bug in this file has
  // had.
  const candidates = (candidateFids ?? []).map((f) => padFid(f)).filter((f) => f);
  if (candidates.length === 0) return null;

  // A player is nameable beside a franchise only when the ROSTERS put him
  // there. The orientation check upstream fixes a swapped row wholesale; this
  // is the per-player floor under it, and it is the assertion that actually
  // reaches an owner: "the [team] have [Player] on the table" is a claim about
  // that owner's roster, so it is checked against that owner's roster.
  const ownPlayers = (fid) => (playersByFid?.[fid] ?? []).filter(
    (a) => a && a.kind === 'player' && a.name && rosterAgrees(rosterOwnerByPlayerId, a, fid),
  );

  // Deterministic single-team pick: hash the offerId so subsequent signals
  // about the same offer always reference the same team. "Either team but
  // only 1 initially" — the coin-flip is even between the two franchises.
  const bit = hashOfferIdToBit(offerId);
  let chosenFid = candidates[bit % candidates.length];

  // …but a team that is giving up no players cannot be described as shopping
  // one. When the coin-flip team is sending only picks, name the other side
  // instead — still deterministic, and it keeps signal 2+ able to say
  // something true rather than pairing a team with someone else's player.
  if (ownPlayers(chosenFid).length === 0) {
    const other = candidates.find((f) => f !== chosenFid);
    if (other && ownPlayers(other).length > 0) chosenFid = other;
  }

  const team = pickDisplayTeam(teamMap?.get?.(chosenFid));
  if (!team) return null;

  // Marquee ordering: ADP dynasty rank ascending (rank 1 = best). Players
  // without a rank sort to the end. Stable tie-break by playerId.
  // ONLY the chosen team's own side — see the header.
  const ranked = ownPlayers(chosenFid)
    .map((a) => ({
      name: a.name,
      position: a.position ?? 'UNK',
      playerId: a.playerId,
      rank: (() => {
        const r = adpRankByPlayerId?.get?.(a.playerId);
        return Number.isFinite(r) && r > 0 ? r : Number.POSITIVE_INFINITY;
      })(),
    }))
    .sort((a, b) => (a.rank - b.rank) || (a.playerId < b.playerId ? -1 : 1));

  // A name every OTHER signal (see `plannedPlayerCount`): signals 1-2 name the
  // team only, 3-4 add the marquee player, 5-6 the second. The even signals in
  // between carry a beat instead, which is what turns the ladder into a drip.
  const playerCount = plannedPlayerCount(signal);
  const chosen = ranked.slice(0, playerCount);
  const players = chosen.map(({ name, position }) => ({ name, position }));

  // `playerIds` never reaches the tip — `redactTradeOffer` lifts it into the
  // beat builder's nameable set and rebuilds `exposure` without it, so the
  // block the playbook calls the authoritative name surface keeps exactly the
  // three fields it has always had.
  return { signal, team, players, playerIds: chosen.map((p) => p.playerId), chosenFid };
}

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
 *
 * The `@param` block is load-bearing, not decoration. Destructured options in
 * a .mjs are inferred from the destructuring alone: a bare name is REQUIRED
 * (so every honest caller omitting an optional one is a ts(2345) — two of
 * those were sitting in the type baseline), and `= undefined` is inferred as
 * the type `undefined` (so passing a real value is a ts(2322)). Only a
 * declared signature says "optional, and of this type", which is what the
 * header above has claimed since it was written.
 *
 * @param {object} args
 * @param {Record<string, any>} args.rawOffer
 * @param {string} args.offeringFid
 * @param {Map<string, any>} args.playerMap
 * @param {Map<string, any>} args.teamMap
 * @param {Record<string, any>} args.counts
 * @param {number} args.currentYear
 * @param {string} [args.framingHint]
 * @param {number} [args.offerAgeMs]
 * @param {number} [args.exposureCount]
 * @param {Map<string, number>} [args.adpRankByPlayerId]
 * @param {Map<string, string>} [args.rosterOwnerByPlayerId]
 * @param {Map<string, Set<string>>} [args.blockByFid]
 * @param {Map<string, number>} [args.positionRuns]
 * @param {Record<string, any> | null} [args.previousShape]
 * @param {number} [args.priorPairCount]
 * @param {Record<string, any> | null} [args.closure]
 * @param {number} [args.nowMs]
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
  exposureCount = 0,
  adpRankByPlayerId,
  rosterOwnerByPlayerId,
  blockByFid,
  positionRuns,
  previousShape,
  priorPairCount = 0,
  closure,
  nowMs = Date.now(),
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

  /**
   * Player escalation — the highest-tier player in this offer.
   *
   * `pool` is scoped to the named team's own side once a team is named (see
   * below). At tier "named" the playbook lets the LLM print this player's name,
   * and `exposure.team` is in the same payload — so an escalatedPlayer from the
   * OTHER side reproduces exactly the wrong-team-plus-player pairing that
   * constraining `exposure.players` was meant to end, just through a different
   * field.
   */
  const pickEscalated = (pool) => {
    let best;
    let bestRank = -1;
    for (const a of pool) {
      if (a.kind !== 'player') continue;
      const n = playerHistory.get(a.playerId) ?? 0;
      const tier = tierForDistinctOfferers(n);
      const rank = TIER_RANK[tier];
      if (rank > bestRank && tier !== 'base') {
        bestRank = rank;
        best = { name: a.name, position: a.position ?? 'UNK', tier, distinctOfferers: n };
      }
    }
    return best;
  };
  let escalatedPlayer = pickEscalated(allAssets);

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

  // Per-offer graduated reveal. signal = exposureCount + 1 because callers
  // pass the number of PRIOR posts; the post we're building IS the next
  // signal. exposure stays undefined when exposureCount is negative (treat
  // as "no exposure yet" — the legacy redaction tokens carry the post).
  // A closure post HOLDS the signal instead of advancing it. The proposal is
  // over; a post that revealed one more name on its way out would be using the
  // end of a story to leak something the story never earned.
  const exposureSignal = closure
    ? Math.max(1, Number.isFinite(exposureCount) ? Math.floor(exposureCount) : 1)
    : (Number.isFinite(exposureCount) ? Math.max(0, Math.floor(exposureCount)) : 0) + 1;
  // Sides kept apart on purpose: `franchise1_gave_up` are fid1's players,
  // `franchise2_gave_up` are fid2's. Merging them is what let a post name a
  // team alongside the other side's player.
  // Padded, because these strings are used as MAP KEYS against `teamMap` and
  // `blockByFid`, both of which are keyed 4-digit. MFL hands back "7" on some
  // rows and "0007" on others, and an unpadded key misses both maps: the team
  // lookup returns undefined, `buildExposure` bails, and the post loses its
  // whole name surface rather than failing loudly.
  //
  // The binding itself goes through `attributeSides`, which validates the two
  // ids and checks the row's orientation against the rosters — see its header
  // for the row shapes that arrive with the ids right and the sides inverted.
  // An unattributable row yields an EMPTY map, and every name surface below
  // reads from that map, so the whole post degrades to naming nobody.
  const attribution = attributeSides({
    fid1: rawOffer.franchise ?? offeringFid,
    fid2: rawOffer.franchise2 ?? rawOffer.offeredto,
    side1,
    side2,
    rosterOwnerByPlayerId,
  });
  const sidesByFid = attribution.sidesByFid;

  const exposureBuilt = attribution.attributable
    ? buildExposure({
      signal: exposureSignal,
      offerId,
      teamMap,
      playersByFid: sidesByFid,
      candidateFids: attribution.fids,
      rosterOwnerByPlayerId,
      adpRankByPlayerId,
    })
    : null;

  // The named team, taken from the id `buildExposure` actually chose rather
  // than by matching its display name back through `teamMap` — two franchises
  // can carry the same display string, and the name lookup would then hand the
  // beats the wrong side's roster.
  const namedFid = exposureBuilt?.chosenFid ?? null;

  const exposure = exposureBuilt
    ? {
      signal: exposureBuilt.signal,
      team: exposureBuilt.team,
      players: exposureBuilt.players,
      // The named franchise, carried so the LLM-facing payload can hand over
      // `{{TEAM:<fid>}}` instead of the name. Internal: the safe payload picks
      // its fields explicitly, so this never reaches the model as an id.
      fid: exposureBuilt.chosenFid ?? null,
    }
    : null;

  // A named team makes escalatedPlayer an ownership claim too — re-pick it from
  // that team's own side, and through the same roster floor `buildExposure`
  // uses. At tier `named` the playbook prints this player's name beside
  // `exposure.team`, so an unchecked pick here reproduces the wrong-team-plus-
  // player pairing through a second field. Without a named team nobody is
  // being credited with the player, so the unscoped pick stands.
  if (exposure?.team && namedFid) {
    escalatedPlayer = pickEscalated(
      (sidesByFid[namedFid] ?? []).filter((a) => rosterAgrees(rosterOwnerByPlayerId, a, namedFid)),
    );
  }

  // ── Beats: the drip layer (see scripts/lib/schefter-offer-beats.mjs) ──
  // Everything here is derived from data already on the row or already loaded
  // by the scanner. Nothing widens the name surface: `nameablePlayerIds` is
  // exactly what `exposure` already printed, plus the escalated player at the
  // one tier that authorizes a name.
  // EXACTLY what `exposure` has already printed, and nothing else.
  //
  // This used to also admit the `named`-tier `escalatedPlayer`, on the
  // reasoning that the escalation ladder already authorizes his name. It does
  // — through its own field, on its own terms. Letting the BEATS print him
  // made the drip layer a second name surface: at signal 4 a beat carried
  // "Gamma Three" while `exposure.players` still read `["Alpha One"]`, so a
  // name arrived two signals before the ladder meant it to and the playbook's
  // "never print a player who is not in exposure.players" became false.
  const nameablePlayerIds = new Set(exposureBuilt?.playerIds ?? []);

  // Rule B above drops `pickTokens` at the named tier because a name plus a
  // pick round identifies the deal. `deal_shape` reaches the prompt through a
  // different field and was re-publishing them verbatim.
  const suppressShapePicks = escalatedPlayer?.tier === 'named';
  if (suppressShapePicks) antiLeak.dropped.push('dealShape picks (named tier)');
  const dealShape = buildDealShape({ namedFid, sidesByFid, suppressPicks: suppressShapePicks });
  const expiryBeat = buildExpiryBeat({ rawOffer, nowMs });
  const marketBeats = buildMarketBeats({
    namedFid,
    sidesByFid,
    blockByFid,
    playerHistory,
    positionRuns,
    nameablePlayerIds,
  });
  const askChangedBeat = buildAskChangedBeat({
    previousShape,
    currentShape: assetShapeOf(rawOffer),
    namedFid,
    rawOffer,
  });
  const reOfferBeat = buildReOfferBeat({ priorPairCount });
  if (reOfferBeat) marketBeats.push(reOfferBeat);
  const closureBeat = closure
    ? buildClosureBeat({
      reason: closure.reason,
      daysOpen: closure.daysOpen,
      priorPosts: closure.priorPosts,
    })
    : null;

  const { beats, leadKind } = planBeats({
    signal: exposureSignal,
    dealShape,
    expiryBeat,
    marketBeats,
    askChangedBeat,
    closureBeat,
    // Whether THIS signal actually printed a name the last one didn't. The
    // named team's side is finite, so past the last player an odd signal would
    // otherwise announce a new name that does not exist.
    nameLanded:
      (exposureBuilt?.players?.length ?? 0) > plannedPlayerCount(exposureSignal - 1),
  });

  // Partner franchise — the team being offered to. Used by the corroboration
  // matcher to detect when a web/groupme tip's franchiseHint is on either
  // side of this offer. Internal-only metadata; never reaches the LLM (the
  // anonymizer drops it before the LLM sees the safe-shape tip).
  //
  // Read off the ROW's two ids, not the attributed sides: this is "who is in
  // this conversation", a question the ids answer whichever way the assets
  // were bound, and it must still answer it for a row too garbled to name
  // anyone from.
  const rowFid1 = padFid(rawOffer.franchise ?? offeringFid);
  const rowFid2 = padFid(rawOffer.franchise2 ?? rawOffer.offeredto);
  const partnerFranchiseId = padFid(offeringFid) === rowFid1 ? rowFid2 : rowFid1;

  // Lower-cased player names for substring matching against web tip text.
  // Internal-only — never surfaces to the LLM. Even at non-named tier where
  // the LLM can't print the player's name, the matcher needs the name to
  // detect web tips that referenced the same player.
  const playerNames = allAssets
    .filter((a) => a.kind === 'player' && typeof a.name === 'string' && a.name.length > 0)
    .map((a) => a.name.toLowerCase());

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
    partnerFranchiseId,
    playerNames,
  };
  if (exposure) tip.exposure = exposure;
  if (beats.length > 0) {
    tip.beats = beats;
    tip.leadKind = leadKind;
  }

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
    attribution: {
      attributable: attribution.attributable,
      verified: attribution.verified,
      corrected: attribution.corrected,
      ...(attribution.reason ? { reason: attribution.reason } : {}),
    },
    finalTokens: {
      positionTokens: finalPositionTokens,
      pickTokens: finalPickTokens,
      divisionHint: finalDivisionHint,
      escalatedPlayer,
    },
    exposure,
    namedFid,
    beats,
    leadKind,
  };

  return { tip, debug };
}

/**
 * Per-run probability for posting a trade-offer rumor.
 *
 * Base p=0.05 per 15-minute scanner run. The cron is `*\/15 * * * *` but
 * GitHub Actions skips/queues cron jobs under platform load AND quiet-hours
 * (23:00–07:00 PT) hard-skip ~32 cycles/day, so the effective dice-roll
 * count is closer to 30–50 rolls/day per offer than the nominal 96. At the
 * current base:
 *   - 30 rolls/day → ~79% by 24h, ~95% by 48h
 *   - 50 rolls/day → ~92% by 24h, ~99% by 48h
 *   - 96 rolls/day → ~99% by 24h, ~99.9% by 48h
 * Trade offers usually file within a day or two while keeping a real per-run
 * dice roll — unposted offers can still fail forever; that's the design.
 *
 * THIS IS A PER-DAY PROBABILITY, NOT A PER-RUN ONE. The scanner rolls each
 * offer at most once per Pacific day (`OFFER_LAST_ROLL_DATE_KEY` in
 * schefter-rumor-scan.mjs). That throttle is what makes this constant mean
 * what it reads like: 0.10 is a one-in-ten chance that this offer leaks today.
 *
 * History: 0.0075 → 0.025 (2026-04-30, PR #141) → 0.05 (2026-05-02), each
 * bump chasing "proposals age out before they post" while the roll still fired
 * on every cron tick. At ~50 rolls/day a 0.05 per-RUN base is ~92% within 24
 * hours, so in practice nearly every offer leaked, nearly immediately — the
 * lane read as an advertising feed for the trade block rather than as a beat
 * reporter breaking the occasional story (owner report, 2026-09-08). Moved to
 * one roll per day at 0.10 on 2026-09-08: an offer now has a ~50/50 chance of
 * ever surfacing across a week-long life, and a rumor is news again.
 *
 * The 48h framing flip from "fresh" to "lingering" ("offered but phones aren't
 * picking up") is handled in scanTradeOffers, not here. The probability itself
 * does not change with age.
 *
 * Exponential scaling on shopping volume: when the *effective* distinct
 * offerers for the most-shopped player in this offer is ≥2, multiply the
 * base by `OFFER_VOLUME_BOOST_FACTOR ^ (effectiveOfferers - 1)` and cap at
 * `OFFER_VOLUME_BOOST_MAX`. This boost SURVIVES the slowdown on purpose: a
 * player three desks are calling about is the genuine breaking story, and the
 * gradient from 10%/day to the ceiling is what separates one from a routine
 * offer nobody else wants.
 * Effective count blends real submitted offerers (full weight) with saved
 * trade-builder drafts (0.4 weight, computed in the scanner).
 *
 * The exponential growth is intentional — it keeps the per-day probability
 * vague at low volume (owner can't tell whether their move tipped Schefter)
 * while accelerating the pass on heavily-shopped players. Combined with the
 * tier-cap on draft-only contribution, this gives Schefter speed without
 * letting him name names from soft signals.
 *
 * NO EXPOSURE SCALING. Phase 6c multiplied the base by
 * `OFFER_EXPOSURE_BOOST_FACTOR ^ priorExposure` so an already-reported offer
 * raced through the rest of its reveal ladder. That ladder is gone — an offer
 * that has posted is now on a cooldown (`OFFER_REPOST_COOLDOWN_MS`) rather
 * than on an accelerator — and reinstating the boost would point the dial the
 * wrong way: the offers it speeds up are exactly the ones the league has
 * already heard about. `priorExposure` is still THREADED THROUGH the scanner
 * (it picks how much detail a re-surfacing offer may reveal) but it no longer
 * touches the odds, which is why this function takes one argument.
 *
 * The product is still clamped to `OFFER_PROBABILITY_CEILING`.
 *
 * Exported for tests & dry-run logging.
 */
export const OFFER_POST_PROBABILITY = 0.10;
export const OFFER_VOLUME_BOOST_FACTOR = 1.5;
export const OFFER_VOLUME_BOOST_MAX = 4;

// Ceiling on the combined product. With one roll per day and a 0.10 base, this
// is reachable only through the volume boost — a player several desks are
// chasing tops out at roughly a one-in-three chance of leaking on any given
// day. Nothing accelerates past it.
export const OFFER_PROBABILITY_CEILING = 0.35;

export function offerPostProbability(effectiveOfferers = 1) {
  const n = Number.isFinite(effectiveOfferers) ? Math.max(1, effectiveOfferers) : 1;
  const volumeRaw = Math.pow(OFFER_VOLUME_BOOST_FACTOR, n - 1);
  const volumeMult = Math.min(OFFER_VOLUME_BOOST_MAX, volumeRaw);

  return Math.min(OFFER_PROBABILITY_CEILING, OFFER_POST_PROBABILITY * volumeMult);
}

export { bucketVolumeHint, tierForDistinctOfferers, classifyAsset, parseAssetString };
