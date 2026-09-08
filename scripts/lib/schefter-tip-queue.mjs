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
 * Keeps the NEWEST row's PAYLOAD under the EARLIEST row's `submittedAt`, which
 * are two different questions and were briefly answered with one row:
 *
 * - The payload must be the newest because `redactTradeOffer` stamps
 *   `id: to_<offerId>` on EVERY tip it mints for an offer, the CLOSURE tip
 *   included. Keeping the earliest row wholesale meant a stale "still
 *   shopping" row swallowed the "this one got done" callback behind it — and
 *   `OFFER_CLOSED_KEY` is written at enqueue, before the tip ships, so a
 *   dropped closure is never retried. It also discarded the newer row's
 *   `framingHint`, `offerAgeMs`, `exposure` and planned beats, so an
 *   ask-changed beat never shipped and the post reported a stale offer age.
 * - The timestamp must be the earliest because `submittedAt` is the age anchor
 *   the framing, the age-boost and `TIP_EXPIRY_MS` all read. Carrying the
 *   newest forward would let a re-rolled offer refresh its own clock every
 *   day — the "dead proposals never leave" failure of the 2026-09-07 insight,
 *   wearing a plausible timestamp.
 *
 * Strike state folds FORWARD from every duplicate rather than coming from the
 * kept row alone, so a newly enqueued copy cannot launder a tip out of
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
    // Newest payload wins; see the closure case above.
    const keep = (tip.submittedAt ?? 0) >= (prev.submittedAt ?? 0) ? tip : prev;
    const drop = keep === tip ? prev : tip;
    // Merged into a COPY rather than written onto `keep`. Folding the fields
    // into the input row would leave two rows sharing one `submittedAt`, and
    // the newest-wins comparison above then resolves a tie by arrival order —
    // so a second pass over the same array could keep the other row. The
    // scanner dedupes once per run, but a function whose answer depends on
    // whether it has already been called is a trap left lying around.
    const merged = { ...keep };
    const strikes = Math.max(
      typeof keep.suppressedStrikes === 'number' ? keep.suppressedStrikes : 0,
      typeof drop.suppressedStrikes === 'number' ? drop.suppressedStrikes : 0,
    );
    if (strikes > 0) merged.suppressedStrikes = strikes;
    const suppressedAts = [keep.firstSuppressedAt, drop.firstSuppressedAt].filter(
      (v) => typeof v === 'number',
    );
    if (suppressedAts.length > 0) merged.firstSuppressedAt = Math.min(...suppressedAts);
    // ...but the oldest timestamp, so the tip still ages out on schedule.
    const submittedAts = [keep.submittedAt, drop.submittedAt].filter(
      (v) => typeof v === 'number',
    );
    if (submittedAts.length > 0) merged.submittedAt = Math.min(...submittedAts);
    byId.set(id, merged);
  }
  return [...byId.values()];
}
