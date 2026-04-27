/**
 * Trade-bait drift detector — pure, stateless.
 *
 * Owners add players to their MFL "trade bait" list to publicly signal
 * availability. The scanner wants to turn those changes into rumor-mill
 * posts without flooding the feed when an owner dumps a bunch of players
 * over a short window. This module owns that debouncing logic.
 *
 * Mental model (per franchise):
 *   - committedBlock  : the block we last told the rumor mill about
 *   - observedBlock   : the block we saw on MFL at the last scan
 *   - firstChangeTs   : when drift from committedBlock started (null when settled)
 *   - lastChangeTs    : when the observedBlock last moved (null when settled)
 *
 * Each scan updates drift timers, computes netAdds/netRemoves against the
 * committed state, and either holds for more quiet (drifting) or emits a
 * tip and advances committedBlock to the current state (settled).
 *
 * Edge behavior (codified; see tests/trade-bait-detector.test.ts):
 *   - First run: no prior entry → seed silently, emit nothing.
 *   - Add + remove same player within the window → netAdds stays empty, silent.
 *   - Pure removes → no tip; committedBlock advances so a future re-add fires.
 *   - Stuck drift: firstChangeTs ≥ MAX_SETTLE_WAIT_MS → force-emit regardless.
 *
 * The detector never touches I/O. Callers supply `now`, current block data,
 * prior state; the return value is a new state object plus zero-or-more
 * tips to enqueue.
 */

/** Default 45 minute settle window — long enough to absorb a cleanup session. */
export const DEFAULT_SETTLE_WINDOW_MS = 45 * 60 * 1000;

/** Default 6 hour absolute cap — prevents a fidgety owner from blocking posts forever. */
export const DEFAULT_MAX_SETTLE_WAIT_MS = 6 * 60 * 60 * 1000;

/** Truncate `meta.adds` to this many — avoids an unreadable 20-player dump. */
export const MAX_ADDS_PER_TIP = 10;

/**
 * Normalize a player-id array into a canonical sorted unique array.
 * The detector's equality checks depend on canonical ordering.
 */
export function normalizeBlock(ids) {
  if (!Array.isArray(ids)) return [];
  const out = new Set();
  for (const id of ids) {
    if (id === null || id === undefined) continue;
    const s = String(id).trim();
    if (s.length > 0) out.add(s);
  }
  return [...out].sort();
}

function setDiff(aArr, bArr) {
  const b = new Set(bArr);
  const out = [];
  for (const x of aArr) if (!b.has(x)) out.push(x);
  return out;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Run the detector against a single franchise.
 *
 * @param {object} args
 * @param {string} args.franchiseId
 * @param {string[]} args.currentIds - Raw current block from MFL
 * @param {object|undefined} args.prevEntry - feed.tradeBaitState[franchiseId]
 * @param {number} args.nowMs
 * @param {number} args.settleWindowMs
 * @param {number} args.maxSettleWaitMs
 * @returns {{
 *   emit: boolean,
 *   reason: 'seed' | 'settled' | 'max_wait' | 'no_change' | 'drifting' | 'silent_sync',
 *   nextEntry: { committedBlock: string[], observedBlock: string[], firstChangeTs: number|null, lastChangeTs: number|null },
 *   netAdds: string[],
 *   netRemoves: string[],
 *   truncated: boolean,
 * }}
 */
export function detectFranchiseChange({
  franchiseId,
  currentIds,
  prevEntry,
  nowMs,
  settleWindowMs = DEFAULT_SETTLE_WINDOW_MS,
  maxSettleWaitMs = DEFAULT_MAX_SETTLE_WAIT_MS,
}) {
  const current = normalizeBlock(currentIds);

  // ── Seed ─────────────────────────────────────────────────────────────
  // No prior entry → record what's on MFL as the committed state and emit
  // nothing. The feature's first post will be the first real delta after
  // this scan. Intentional: prevents a 17-player flood on launch day.
  if (!prevEntry) {
    return {
      emit: false,
      reason: 'seed',
      nextEntry: {
        committedBlock: current,
        observedBlock: current,
        firstChangeTs: null,
        lastChangeTs: null,
      },
      netAdds: [],
      netRemoves: [],
      truncated: false,
    };
  }

  const committed = normalizeBlock(prevEntry.committedBlock);
  const prevObserved = normalizeBlock(prevEntry.observedBlock ?? committed);
  const prevFirst = Number.isFinite(prevEntry.firstChangeTs) ? prevEntry.firstChangeTs : null;
  const prevLast = Number.isFinite(prevEntry.lastChangeTs) ? prevEntry.lastChangeTs : null;

  const observedChanged = !arraysEqual(current, prevObserved);
  const lastChangeTs = observedChanged ? nowMs : prevLast;
  const firstChangeTs = observedChanged && prevFirst === null ? nowMs : prevFirst;

  const netAdds = setDiff(current, committed);
  const netRemoves = setDiff(committed, current);

  // ── No drift from committed ──────────────────────────────────────────
  // Owner may be flipping a single player in and out — observedBlock can
  // change even when committed equality holds. Reset drift timers so the
  // settle window doesn't carry stale history into the next real delta.
  if (netAdds.length === 0 && netRemoves.length === 0) {
    return {
      emit: false,
      reason: 'no_change',
      nextEntry: {
        committedBlock: committed,
        observedBlock: current,
        firstChangeTs: null,
        lastChangeTs: null,
      },
      netAdds: [],
      netRemoves: [],
      truncated: false,
    };
  }

  // ── Still drifting ───────────────────────────────────────────────────
  // The max-wait fuse (firstChangeTs + maxSettleWaitMs) breaks a stalemate
  // where an owner keeps tweaking every few minutes. Otherwise hold until
  // (now - lastChangeTs) ≥ settleWindowMs so dumps coalesce cleanly.
  const driftStart = firstChangeTs ?? lastChangeTs ?? nowMs;
  const maxWaitElapsed = nowMs - driftStart >= maxSettleWaitMs;
  const settled = lastChangeTs === null || nowMs - lastChangeTs >= settleWindowMs;

  if (!settled && !maxWaitElapsed) {
    return {
      emit: false,
      reason: 'drifting',
      nextEntry: {
        committedBlock: committed,
        observedBlock: current,
        firstChangeTs,
        lastChangeTs,
      },
      netAdds,
      netRemoves,
      truncated: false,
    };
  }

  // ── Ready to advance ─────────────────────────────────────────────────
  // Pure-remove case emits no tip but still advances committedBlock so a
  // future re-add re-surfaces correctly. Any netAdds → emit.
  const truncated = netAdds.length > MAX_ADDS_PER_TIP;
  return {
    emit: netAdds.length > 0,
    reason: netAdds.length > 0 ? (maxWaitElapsed && !settled ? 'max_wait' : 'settled') : 'silent_sync',
    nextEntry: {
      committedBlock: current,
      observedBlock: current,
      firstChangeTs: null,
      lastChangeTs: null,
    },
    netAdds,
    netRemoves,
    truncated,
  };
}

/**
 * Run the detector across every franchise in a single fetch snapshot.
 *
 * @param {object} args
 * @param {object<string, { playerIds: string[], willGiveUpComment?: string, willTakeComment?: string }>} args.currentByFranchise
 * @param {object<string, object>} args.prevState - feed.tradeBaitState (may be empty/undefined)
 * @param {number} args.nowMs
 * @param {number} [args.settleWindowMs]
 * @param {number} [args.maxSettleWaitMs]
 * @returns {{
 *   nextState: object,
 *   emissions: Array<{ franchiseId: string, netAdds: string[], netRemoves: string[], truncated: boolean, reason: string, willGiveUpComment?: string, willTakeComment?: string }>,
 *   reasons: object<string, string>,
 * }}
 */
export function detectTradeBaitChanges({
  currentByFranchise,
  prevState,
  nowMs,
  settleWindowMs = DEFAULT_SETTLE_WINDOW_MS,
  maxSettleWaitMs = DEFAULT_MAX_SETTLE_WAIT_MS,
}) {
  const nextState = {};
  const emissions = [];
  const reasons = {};
  const safePrev = prevState && typeof prevState === 'object' ? prevState : {};
  const seen = new Set();

  for (const [franchiseId, entry] of Object.entries(currentByFranchise ?? {})) {
    seen.add(franchiseId);
    const result = detectFranchiseChange({
      franchiseId,
      currentIds: entry?.playerIds ?? [],
      prevEntry: safePrev[franchiseId],
      nowMs,
      settleWindowMs,
      maxSettleWaitMs,
    });
    nextState[franchiseId] = result.nextEntry;
    reasons[franchiseId] = result.reason;
    if (result.emit) {
      emissions.push({
        franchiseId,
        netAdds: result.netAdds,
        netRemoves: result.netRemoves,
        truncated: result.truncated,
        reason: result.reason,
        willGiveUpComment: entry?.willGiveUpComment ?? '',
        willTakeComment: entry?.willTakeComment ?? '',
      });
    }
  }

  // Franchises that disappeared from the current fetch (e.g. removed from
  // league, or block cleared to zero and MFL stopped returning them) —
  // treat as "block went empty" for diff purposes so any stored adds clear.
  // We model "empty block" explicitly so firstChangeTs can advance cleanly.
  for (const [franchiseId, prevEntry] of Object.entries(safePrev)) {
    if (seen.has(franchiseId)) continue;
    const result = detectFranchiseChange({
      franchiseId,
      currentIds: [],
      prevEntry,
      nowMs,
      settleWindowMs,
      maxSettleWaitMs,
    });
    nextState[franchiseId] = result.nextEntry;
    reasons[franchiseId] = result.reason;
    // Absent franchise never emits adds (current is empty) — only pure removes.
  }

  return { nextState, emissions, reasons };
}
