/**
 * Trade-proposal beats — the slow-drip layer over a single MFL proposal.
 *
 * Companion to `redact-trade-offer.mjs`. Pure functions, no I/O.
 *
 * ## Why this exists
 *
 * The graduated reveal used to have exactly one dimension: signal N named the
 * hash-chosen team and `N-1` of that team's players, ordered by dynasty ADP.
 * Post seven was post two with a longer list, which is why a lane reporting six
 * live proposals read as if it reported every rumor in the league. These beats
 * are the other dimensions — the shape of the deal, the clock on it, and what
 * the rest of the league's public trade block says about the names in it — so
 * each post carries one fact the previous one didn't and a reader can assemble
 * the proposal over a week.
 *
 * ## The two rules every beat obeys
 *
 * 1. **A beat may only assert what the feeds can actually see.** The lane reads
 *    proposals owners self-reported (`commish sourced 0` on every scan since the
 *    league-wide read went quiet), so any count over "all proposals" is a FLOOR,
 *    never a total. Counting beats therefore carry `atLeast: true` and the
 *    playbook requires hedged phrasing. The one exact claim available is block
 *    membership: a player can only be listed on his OWN owner's block, so
 *    "in talks, not listed" is exact whenever we hold that one franchise's
 *    block — which is why `blockByFid` is a Map and a missing entry drops the
 *    beat rather than defaulting to "not listed".
 *
 * 2. **A beat never widens the name surface.** `exposure` remains the
 *    authoritative allowlist (see `buildExposure`). Beats take
 *    `nameablePlayerIds` and fall back to position-level phrasing for anyone
 *    outside it; the only team any beat names is the one `exposure` already
 *    named.
 */

/** Beat kinds, in the order they unlock when several are available. */
export const BEAT_KINDS = Object.freeze({
  DEAL_SHAPE: 'deal_shape',
  EXPIRY: 'expiry',
  IN_TALKS_NOT_LISTED: 'in_talks_not_listed',
  BLOCK_STALE: 'block_stale',
  THIRD_DESK: 'third_desk',
  POSITION_RUN: 'position_run',
});

/** Below this many distinct desks a "more than one team is asking" beat is just the proposal itself. */
const THIRD_DESK_FLOOR = 2;
/** Below this many proposals in the window a "run on the position" beat is noise. */
const POSITION_RUN_FLOOR = 3;
/** An expiry further out than this is not a clock anyone feels. */
const EXPIRY_HORIZON_HOURS = 14 * 24;
/** Inside this many hours the expiry beat jumps the queue — a deadline is news when it's near, not when its slot comes up. */
const EXPIRY_URGENT_HOURS = 48;

/**
 * How many of the named team's players are printable at this signal.
 *
 * Was `signal - 1` (a new name every post). Now every OTHER post — the odd
 * signals carry a name, the even ones carry a beat — which is what makes the
 * ladder a drip instead of a countdown. Monotone by construction: it never
 * returns less than it returned for a lower signal, so a name that has shipped
 * is never un-shipped.
 */
export function plannedPlayerCount(signal) {
  if (!Number.isFinite(signal) || signal < 1) return 0;
  return Math.floor((signal - 1) / 2);
}

/**
 * How many extra beats are unlocked at this signal: one per even signal.
 * signal 1 → 0, 2 → 1, 3 → 1, 4 → 2, 5 → 2, 6 → 3 …
 */
export function unlockedBeatCount(signal) {
  if (!Number.isFinite(signal) || signal < 1) return 0;
  return Math.floor(signal / 2);
}

function positionsOf(assets) {
  return [
    ...new Set(
      (assets || [])
        .filter((a) => a && a.kind === 'player' && a.position)
        .map((a) => String(a.position).toUpperCase()),
    ),
  ];
}

function pickLabelsOf(assets) {
  return [...new Set((assets || []).filter((a) => a && a.kind === 'pick').map((a) => a.label))];
}

function playerCountOf(assets) {
  return (assets || []).filter((a) => a && a.kind === 'player').length;
}

/**
 * The deal's shape, described from the NAMED team's point of view.
 *
 * Framing it from the named team is not cosmetic: the prose asserts what that
 * team is doing ("they want a back back"), and the named team is the only
 * franchise the post is allowed to characterise. Both sides' positions were
 * already merged into `positionTokens` before this existed, so which side a
 * position sat on was the one thing the LLM could never say.
 */
export function buildDealShape({ namedFid, sidesByFid }) {
  if (!namedFid) return null;
  const sends = sidesByFid?.[String(namedFid)];
  if (!Array.isArray(sends)) return null;
  const getsFid = Object.keys(sidesByFid || {}).find((f) => f && f !== String(namedFid));
  const gets = getsFid ? sidesByFid[getsFid] : [];

  const sendsPlayers = playerCountOf(sends);
  const getsPlayers = playerCountOf(gets);
  const sendsPicks = pickLabelsOf(sends);
  const getsPicks = pickLabelsOf(gets);

  if (sendsPlayers + getsPlayers + sendsPicks.length + getsPicks.length === 0) return null;

  let direction;
  if (sendsPlayers > 0 && getsPlayers > 0) direction = 'swap';
  else if (sendsPlayers > 0) direction = 'selling';
  else if (getsPlayers > 0) direction = 'buying';
  else direction = 'picks_only';

  return {
    direction,
    sends: { players: sendsPlayers, positions: positionsOf(sends), picks: sendsPicks },
    gets: { players: getsPlayers, positions: positionsOf(gets), picks: getsPicks },
  };
}

/**
 * MFL stamps every proposal with an `expires` (unix seconds). It is parsed by
 * `/api/trades/pending`, stored on the archived row, and until now read by
 * nothing — a free clock on a lane whose whole problem was that every post
 * sounded the same.
 */
export function buildExpiryBeat({ rawOffer, nowMs }) {
  const secs = parseInt(rawOffer?.expires ?? '0', 10);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const expiresAtMs = secs * 1000;
  const hoursRemaining = (expiresAtMs - nowMs) / (60 * 60 * 1000);
  if (hoursRemaining <= 0 || hoursRemaining > EXPIRY_HORIZON_HOURS) return null;

  let urgency;
  if (hoursRemaining <= 24) urgency = 'today';
  else if (hoursRemaining <= EXPIRY_URGENT_HOURS) urgency = 'soon';
  else urgency = 'this_week';

  return {
    kind: BEAT_KINDS.EXPIRY,
    urgency,
    hoursRemaining: Math.round(hoursRemaining),
    daysRemaining: Math.max(1, Math.round(hoursRemaining / 24)),
  };
}

/**
 * Cross-references against the league's PUBLIC trade block
 * (`feed.tradeBaitState[fid].observedBlock`) and the proposal history.
 *
 * `blockByFid` is a Map so "we have no block for this franchise" and "this
 * franchise has an empty block" stay distinguishable — the first must drop the
 * beat, the second is a real signal. Collapsing them is how a lane holding five
 * of sixteen blocks would confidently report that a player is on nobody's.
 */
export function buildMarketBeats({
  namedFid,
  sidesByFid,
  blockByFid,
  playerHistory,
  positionRuns,
  nameablePlayerIds,
}) {
  const beats = [];
  const nameable = nameablePlayerIds instanceof Set ? nameablePlayerIds : new Set();

  const subjectFor = (asset) => (nameable.has(asset.playerId)
    ? { name: asset.name, position: asset.position ?? 'UNK' }
    : { position: asset.position ?? 'UNK' });

  // ── In talks, not listed ──
  // Exact whenever we hold the OWNING franchise's block: a player cannot be
  // listed anywhere but on his own owner's block.
  for (const [fid, assets] of Object.entries(sidesByFid || {})) {
    const block = blockByFid instanceof Map ? blockByFid.get(String(fid)) : null;
    if (!block) continue;
    for (const asset of assets || []) {
      if (!asset || asset.kind !== 'player' || !asset.playerId) continue;
      if (block.has(String(asset.playerId))) continue;
      beats.push({
        kind: BEAT_KINDS.IN_TALKS_NOT_LISTED,
        subject: subjectFor(asset),
        ownedByNamedTeam: String(fid) === String(namedFid),
      });
    }
  }

  // ── Still sitting on the named team's own block ──
  // Deliberately NOT "and nobody has called": with partial proposal visibility
  // the absence of an offer is not evidence of an absence of interest. Block
  // membership and its age are things we actually know.
  if (namedFid) {
    const block = blockByFid instanceof Map ? blockByFid.get(String(namedFid)) : null;
    if (block && block.size > 0) {
      const inThisDeal = new Set(
        (sidesByFid?.[String(namedFid)] || [])
          .filter((a) => a && a.kind === 'player' && a.playerId)
          .map((a) => String(a.playerId)),
      );
      const stillListed = [...block].filter((pid) => !inThisDeal.has(pid));
      if (stillListed.length > 0) {
        beats.push({
          kind: BEAT_KINDS.BLOCK_STALE,
          listedCount: block.size,
          notInThisDealCount: stillListed.length,
        });
      }
    }
  }

  // ── More than one desk asking about the same player ──
  for (const assets of Object.values(sidesByFid || {})) {
    for (const asset of assets || []) {
      if (!asset || asset.kind !== 'player' || !asset.playerId) continue;
      const n = playerHistory?.get?.(asset.playerId) ?? 0;
      if (n < THIRD_DESK_FLOOR) continue;
      beats.push({
        kind: BEAT_KINDS.THIRD_DESK,
        subject: subjectFor(asset),
        deskCount: n,
        atLeast: true,
      });
    }
  }

  // ── A run on a position across the proposals we can see ──
  if (positionRuns instanceof Map) {
    const involved = new Set();
    for (const assets of Object.values(sidesByFid || {})) {
      for (const p of positionsOf(assets)) involved.add(p);
    }
    for (const position of involved) {
      const count = positionRuns.get(position) ?? 0;
      if (count < POSITION_RUN_FLOOR) continue;
      beats.push({
        kind: BEAT_KINDS.POSITION_RUN,
        position,
        proposalCount: count,
        atLeast: true,
      });
    }
  }

  return beats;
}

/**
 * Rank the available beats into the order they unlock, then hand back the ones
 * this signal has earned plus the single beat that is NEW at this signal.
 *
 * `leadKind` is the whole point of the rotation: the playbook makes the LLM
 * open on it, so consecutive posts about one proposal open on different facts
 * even though the payload keeps everything already revealed (a fact that has
 * shipped stays shipped — the reader is assembling a picture, not watching it
 * get taken away).
 */
export function planBeats({ signal, dealShape, expiryBeat, marketBeats, nameLanded = true }) {
  const ordered = [];
  if (dealShape) ordered.push({ kind: BEAT_KINDS.DEAL_SHAPE, ...dealShape });
  // An expiry inside two days jumps the queue — a deadline is news when it is
  // near, not when its rotation slot comes up.
  if (expiryBeat && (expiryBeat.urgency === 'today' || expiryBeat.urgency === 'soon')) {
    ordered.push(expiryBeat);
  }
  ordered.push(...(marketBeats || []));
  if (expiryBeat && expiryBeat.urgency === 'this_week') ordered.push(expiryBeat);

  const unlocked = ordered.slice(0, unlockedBeatCount(signal));
  const isPlayerSignal = signal >= 3 && signal % 2 === 1;
  const newIndex = unlockedBeatCount(signal) - 1;
  const newlyUnlocked = signal % 2 === 0 && newIndex >= 0 ? ordered[newIndex] : null;

  let leadKind;
  if (signal === 1) {
    leadKind = 'team';
  } else if (newlyUnlocked) {
    leadKind = newlyUnlocked.kind;
  } else if (isPlayerSignal && nameLanded) {
    leadKind = 'player';
  } else if (unlocked.length > 0) {
    // Both ladders are exhausted — the proposal has given up every player the
    // named team is sending and every beat it qualifies for. Re-leading is
    // unavoidable here (offer 1076 was on signal 7 the day this shipped), so
    // rotate rather than parking on the same fact until MFL drops the offer.
    leadKind = unlocked[signal % unlocked.length].kind;
  } else {
    leadKind = 'team';
  }

  return { beats: unlocked, leadKind };
}
