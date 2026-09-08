/**
 * Schefter tip-queue admission rules.
 *
 * Extracted from `schefter-rumor-scan.mjs` (Sep 2026) so the one predicate
 * that decides whether a queued tip is usable can be tested against real
 * producer output instead of a source-string regex.
 *
 * The bug that forced the extraction: the scanner required a truthy `text`
 * on every queue item. `redactTradeOffer` builds its tip with `text: ''` by
 * design — a trade-offer tip's signal lives in `volumeHint`,
 * `positionTokens`, `pickTokens` and `playerNames`, and the prose is
 * generated downstream from those. So every trade-offer tip the scanner
 * enqueued was discarded microseconds later by its own re-read, and because
 * they were usually the only thing in the queue, the "no fresh tips" branch
 * then deleted the queue outright. That ran unnoticed from the lane's launch
 * (2026-04-30) to 2026-09-03 — the enqueue logged success every time.
 *
 * Rule: `text` is required only of sources that CARRY text.
 */

/**
 * Tip sources whose payload is structured rather than prose. These legitimately
 * arrive with an empty `text`.
 *
 * Web and GroupMe tips are deliberately NOT in here: those are a human's own
 * words, and an empty body from one really is malformed.
 */
export const TEXTLESS_TIP_SOURCES = new Set(['trade_offer']);

/**
 * Is this queue item a usable tip?
 *
 * @param {unknown} obj - a parsed queue entry
 * @returns {boolean}
 */
export function isUsableTip(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const tip = /** @type {Record<string, unknown>} */ (obj);
  if (!tip.id) return false;
  return Boolean(tip.text) || TEXTLESS_TIP_SOURCES.has(/** @type {string} */ (tip.source));
}

/**
 * Collapse queue rows that describe the SAME tip.
 *
 * `scanTradeOffers` enqueues a fresh row every time an offer passes its dice
 * roll, and a row that does not post is requeued for up to TIP_EXPIRY_MS — so
 * one trade offer that rolls on two different days sits in the queue twice
 * under the same `to_<offerId>` id. Nothing downstream noticed, because
 * nothing downstream counts ids: the busy-morning split reads a bucket of two
 * rows as a backlog of two OFFERS and hands the same offer to two independent
 * LLM passes. Owner report, 2026-09-08: two beats about offer to_1080, one
 * second apart, out of a single run. It also showed up inside single batches —
 * `to_1081` three times in one post's tipIds.
 *
 * The per-offer repost cooldown cannot catch this. That anchor is stamped on
 * DELIVERY, and duplicate rows deliver inside the SAME cycle.
 *
 * Keeps the EARLIEST row. `submittedAt` is the age anchor that the framing,
 * the age-boost and TIP_EXPIRY_MS all read, so keeping the newest would let a
 * re-rolled offer outlive its expiry indefinitely — the "dead proposals never
 * leave" failure of the 2026-09-07 insight, with a fresh timestamp each time.
 * Strike state is folded FORWARD from every duplicate rather than taken from
 * the kept row alone, so a newly enqueued copy cannot launder a tip out of
 * hold-and-strike by resetting its counter to zero.
 */
export function dedupeTipsById(tips) {
  const byId = new Map();
  for (const tip of tips) {
    const id = String(tip?.id ?? '');
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, tip);
      continue;
    }
    const keep = (tip.submittedAt ?? 0) < (prev.submittedAt ?? 0) ? tip : prev;
    const drop = keep === tip ? prev : tip;
    const strikes = Math.max(
      typeof keep.suppressedStrikes === 'number' ? keep.suppressedStrikes : 0,
      typeof drop.suppressedStrikes === 'number' ? drop.suppressedStrikes : 0,
    );
    if (strikes > 0) keep.suppressedStrikes = strikes;
    const suppressedAts = [keep.firstSuppressedAt, drop.firstSuppressedAt].filter(
      (v) => typeof v === 'number',
    );
    if (suppressedAts.length > 0) keep.firstSuppressedAt = Math.min(...suppressedAts);
    byId.set(id, keep);
  }
  return [...byId.values()];
}
