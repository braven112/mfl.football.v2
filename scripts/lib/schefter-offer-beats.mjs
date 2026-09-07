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
  CLOSURE: 'closure',
  ASK_CHANGED: 'ask_changed',
  DEAL_SHAPE: 'deal_shape',
  EXPIRY: 'expiry',
  IN_TALKS_NOT_LISTED: 'in_talks_not_listed',
  BLOCK_STALE: 'block_stale',
  THIRD_DESK: 'third_desk',
  RE_OFFER: 're_offer',
  POSITION_RUN: 'position_run',
});

/**
 * Why a proposal is over. Both are things MFL states, not things we infer:
 *
 *   accepted — a TRADE transaction matching this proposal's franchise pair and
 *              assets is in the committed transactions feed. This is the one
 *              the scanner turns into a closure POST: the trade is public the
 *              moment it processes, so closing the story reveals nothing.
 *   expired  — the row's own `expires` timestamp has passed, and MFL drops a
 *              proposal at its expiry. The scanner routes this to the
 *              speculation lane as a seed rather than posting about it (see
 *              scripts/lib/speculation-seeds.mjs) — a died-quietly proposal is
 *              better used as evidence of who is willing to move whom than
 *              announced as a deal that failed. The reason stays valid here
 *              because it is provable; only its routing changed.
 *
 * There is deliberately no `withdrawn`. A proposal simply vanishing from the
 * scan is NOT evidence it was pulled: the lane is fed by owner self-reports
 * (`commish sourced 0`), so a proposal drops out of view when an owner stops
 * loading the trades page just as surely as when it dies. Publishing "talks
 * have gone cold" off that would be a claim about a live negotiation nobody
 * withdrew. If the league-wide read is ever restored, its coverage — not a
 * disappearance — is what would make that beat sayable.
 */
export const CLOSURE_REASONS = Object.freeze(['accepted', 'expired']);

/** Below this many distinct desks a "more than one team is asking" beat is just the proposal itself. */
const THIRD_DESK_FLOOR = 2;
/** Below this many proposals in the window a "run on the position" beat is noise. */
const POSITION_RUN_FLOOR = 3;
/**
 * An expiry further out than this is not a clock anyone feels — and, more
 * concretely, the beat's furthest tier is labelled `this_week`, so a horizon
 * wider than a week hands the prompt a 13-day deadline under the word "week".
 */
const EXPIRY_HORIZON_HOURS = 7 * 24;
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
export function buildDealShape({ namedFid, sidesByFid, suppressPicks = false }) {
  if (!namedFid) return null;
  const sends = sidesByFid?.[String(namedFid)];
  if (!Array.isArray(sends)) return null;
  const getsFid = Object.keys(sidesByFid || {}).find((f) => f && f !== String(namedFid));
  const gets = getsFid ? sidesByFid[getsFid] : [];

  const sendsPlayers = playerCountOf(sends);
  const getsPlayers = playerCountOf(gets);
  // At the `named` escalation tier the redactor's anti-leak Rule B drops
  // `pickTokens` because a name plus a specific pick round is enough to
  // identify the deal. The shape beat reaches the prompt through a different
  // field, so without this it re-published exactly what Rule B just removed —
  // and the playbook tells the model it may use these labels.
  const sendsPicks = suppressPicks ? [] : pickLabelsOf(sends);
  const getsPicks = suppressPicks ? [] : pickLabelsOf(gets);

  const picksExist = pickLabelsOf(sends).length + pickLabelsOf(gets).length > 0;
  if (sendsPlayers + getsPlayers === 0 && !picksExist) return null;

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
 * MFL is not consistent about zero-padding franchise ids: the transactions
 * feed carries "0007" while an owner-view proposal row can carry "7", and
 * `owner-trade-reports.ts#normalizeRaw` pads `franchise` but passes
 * `franchise2` through untouched. Every id that is compared, used as a map key
 * or hashed goes through here, or a proposal and the trade it became stop
 * hashing alike and accepted-closure detection silently never fires.
 */
export function padFid(value) {
  const s = String(value ?? '').trim();
  return s ? s.padStart(4, '0') : '';
}

/**
 * The signature that lets a proposal and the TRADE it became hash identically.
 *
 * Deliberately the same shape `schefter-scan.mjs#buildTradeSignature` builds —
 * sorted franchise pair, then every asset from both sides sorted together —
 * because MFL calls a different side "franchise1" depending on which export you
 * ask, and the pair-and-assets form is the only one that survives that.
 * Completed TRADE rows in the transactions feed carry the identical field
 * names, which is what makes "the proposal I reported got done" provable rather
 * than inferred.
 */
export function tradeSignatureOf(raw) {
  const pair = [
    padFid(raw?.franchise),
    padFid(raw?.franchise2 || raw?.offeredto),
  ]
    .filter(Boolean)
    .sort()
    .join(':');
  if (!pair) return null;
  const assets = [raw?.franchise1_gave_up, raw?.franchise2_gave_up]
    .flatMap((str) => String(str || '').split(','))
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  if (assets.length === 0) return null;
  return `${pair}|${assets.join(',')}`;
}

/**
 * A compact, order-independent fingerprint of what a proposal is asking for.
 *
 * Stored per proposal so the NEXT scan can tell "the same offer, still sitting
 * there" from "they changed the ask". Sorted because MFL does not promise a
 * stable asset order, and per-side counts kept alongside the hash so the beat
 * can say which way the deal moved instead of only that it moved.
 */
export function assetShapeOf(rawOffer) {
  const side = (str) => String(str || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  const s1 = side(rawOffer?.franchise1_gave_up);
  const s2 = side(rawOffer?.franchise2_gave_up);
  return {
    h: `${s1.join(',')}|${s2.join(',')}`,
    c1: s1.length,
    c2: s2.length,
  };
}

/**
 * The ask moved since we last looked.
 *
 * `direction` is from the NAMED team's side — the only franchise the post may
 * characterise — so a sweetened offer reads as what that team did, not as an
 * unattributed change. A pure reshuffle (same counts, different assets) is
 * still news and says so as `reworked`.
 */
export function buildAskChangedBeat({ previousShape, currentShape, namedFid, rawOffer }) {
  if (!previousShape?.h || !currentShape?.h) return null;
  if (previousShape.h === currentShape.h) return null;

  const namedIsSide1 = String(rawOffer?.franchise ?? '') === String(namedFid ?? '');
  const before = namedIsSide1 ? previousShape.c1 : previousShape.c2;
  const after = namedIsSide1 ? currentShape.c1 : currentShape.c2;

  let direction;
  if (after > before) direction = 'sweetened';
  else if (after < before) direction = 'trimmed';
  else direction = 'reworked';

  return {
    kind: BEAT_KINDS.ASK_CHANGED,
    direction,
    namedSideAssetsBefore: before,
    namedSideAssetsAfter: after,
  };
}

/**
 * These two desks have talked before. `priorPairCount` counts earlier
 * proposals between the same franchise pair in our own archive, which is a
 * floor like every other count here — the archive holds the proposals this
 * lane saw, not the proposals that happened.
 */
export function buildReOfferBeat({ priorPairCount, windowDays }) {
  if (!Number.isFinite(priorPairCount) || priorPairCount < 1) return null;
  return {
    kind: BEAT_KINDS.RE_OFFER,
    priorProposals: priorPairCount,
    windowDays: windowDays ?? 30,
    atLeast: true,
  };
}

/**
 * The story is over. Leads every closure post and reveals no new identity —
 * `redactTradeOffer` holds the signal at its prior value for exactly that
 * reason, so a proposal that was never named does not get named on its way
 * out.
 */
export function buildClosureBeat({ reason, daysOpen, priorPosts }) {
  if (!CLOSURE_REASONS.includes(reason)) return null;
  const beat = { kind: BEAT_KINDS.CLOSURE, reason };
  if (Number.isFinite(daysOpen)) beat.daysOpen = Math.max(0, Math.round(daysOpen));
  if (Number.isFinite(priorPosts) && priorPosts > 0) beat.priorPosts = priorPosts;
  return beat;
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
export function planBeats({
  signal,
  dealShape,
  expiryBeat,
  marketBeats,
  askChangedBeat,
  closureBeat,
  nameLanded = true,
}) {
  // A finished proposal skips the rotation entirely: the closure IS the post,
  // and `signal` is held at its prior value by the caller so nothing new is
  // revealed on the way out. Everything already revealed rides along as
  // context so the callback can say what it is closing.
  if (closureBeat) {
    const context = [];
    if (dealShape) context.push({ kind: BEAT_KINDS.DEAL_SHAPE, ...dealShape });
    context.push(...(marketBeats || []));
    return {
      beats: [closureBeat, ...context.slice(0, unlockedBeatCount(signal))],
      leadKind: BEAT_KINDS.CLOSURE,
    };
  }

  const ordered = [];
  // A changed ask is the freshest thing we know about a proposal, so it goes
  // to the front rather than waiting for a rotation slot — by the time its
  // slot came up the offer may have changed again.
  if (askChangedBeat) ordered.push(askChangedBeat);
  if (dealShape) ordered.push({ kind: BEAT_KINDS.DEAL_SHAPE, ...dealShape });
  // An expiry inside two days jumps the queue for the same reason — a deadline
  // is news when it is near, not when its rotation slot comes up.
  if (expiryBeat && (expiryBeat.urgency === 'today' || expiryBeat.urgency === 'soon')) {
    ordered.push(expiryBeat);
  }
  ordered.push(...(marketBeats || []));
  if (expiryBeat && expiryBeat.urgency === 'this_week') ordered.push(expiryBeat);

  // A changed ask forces its own slot open: without this it would be revealed
  // only if the signal happened to be even, and the change would age out.
  const unlockedFor = (n) => Math.min(
    ordered.length,
    Math.max(askChangedBeat ? 1 : 0, unlockedBeatCount(n)),
  );
  const unlocked = ordered.slice(0, unlockedFor(signal));
  const isPlayerSignal = signal >= 3 && signal % 2 === 1;
  // A beat is NEW only if this signal revealed one the previous signal had
  // not. Comparing against `unlockedBeatCount` alone was wrong the moment the
  // beat list ran shorter than the signal: with a single beat available, every
  // even signal re-led on it and the rotation below was unreachable — post
  // seven reading like post two, which is the exact failure this module
  // exists to remove.
  const grew = unlocked.length > unlockedFor(signal - 1);
  const newlyUnlocked = grew ? ordered[unlocked.length - 1] : null;

  let leadKind;
  if (askChangedBeat) {
    leadKind = BEAT_KINDS.ASK_CHANGED;
  } else if (signal === 1) {
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
