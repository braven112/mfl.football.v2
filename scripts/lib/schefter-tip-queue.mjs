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
