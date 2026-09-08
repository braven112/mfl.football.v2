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
 * hold-and-strike by resetting its counter to zero. The one exception is a
 * closure, which is a NEW terminal story sharing an id rather than another
 * copy of the live one — it does not inherit the LIVE rows' timestamp or
 * ledger. It does still fold with other CLOSURE rows, which are reachable and
 * are the same story. See the materialize step below.
 */
export function dedupeTipsById(tips) {
  const numeric = (v) => (typeof v === 'number' ? v : null);
  const minDefined = (a, b) => {
    const vals = [a, b].filter((v) => typeof v === 'number');
    return vals.length > 0 ? Math.min(...vals) : undefined;
  };
  const strikesOf = (t) => (typeof t?.suppressedStrikes === 'number' ? t.suppressedStrikes : 0);
  // Which STORY a row tells. A closure and a live beat share `to_<offerId>`
  // but are not two copies of one thing, and budget may only be inherited
  // within a class — see the materialize step.
  const storyOf = (t) => (t?.leadKind === 'closure' ? 'closure' : 'live');
  const emptyFold = () => ({ oldestAt: undefined, strikes: 0, firstSuppressedAt: undefined });

  const byId = new Map();
  for (const tip of tips) {
    const id = String(tip?.id ?? '');
    const at = numeric(tip?.submittedAt);
    let acc = byId.get(id);
    if (!acc) {
      acc = { payload: tip, newestAt: at, folds: new Map() };
      byId.set(id, acc);
    } else if ((at ?? 0) >= (acc.newestAt ?? 0)) {
      // Compared against the NEWEST ROW SEEN, tracked separately from any
      // merged timestamp on purpose. Comparing against the accumulated value —
      // which is the OLDEST — meant that once two rows had folded together,
      // any third row beat the accumulator on a timestamp it never had:
      // [closure@9000, live@1000, changed@5000] elected `changed` and dropped
      // the closure. Two rows behaved correctly; three did not.
      acc.payload = tip;
      acc.newestAt = at ?? acc.newestAt;
    }
    const story = storyOf(tip);
    const fold = acc.folds.get(story) ?? emptyFold();
    fold.oldestAt = minDefined(fold.oldestAt, at);
    fold.strikes = Math.max(fold.strikes, strikesOf(tip));
    fold.firstSuppressedAt = minDefined(fold.firstSuppressedAt, numeric(tip?.firstSuppressedAt));
    acc.folds.set(story, fold);
  }

  return [...byId.values()].map((acc) => {
    const merged = { ...acc.payload };
    // Budget — the age anchor and the strike ledger — is inherited only from
    // rows telling the SAME story as the winning payload.
    //
    // The oldest-timestamp rule exists to stop a re-rolled duplicate of one
    // story refreshing its clock, so a fresh CLOSURE must not inherit the live
    // rows' remaining budget: dedupe runs at the queue read with the expiry
    // and strike filter immediately behind it, so a closure merged onto a row
    // at 6d23h is dropped as `expired` within the hour, or as `spiked` at two
    // inherited strikes, and OFFER_CLOSED_KEY was written at enqueue so it
    // never returns.
    //
    // But two CLOSURES under one id ARE the same story, and they are reachable
    // — the `sadd(OFFER_CLOSED_KEY)` guarding re-detection is warn-only and
    // the tip is pushed regardless, so a failed write (or a lapsed 30-day TTL)
    // re-enqueues one on the next scan. Exempting those from the fold too let
    // each duplicate relaunder the clock and the ledger, so a closure the
    // quality gate kept suppressing would never age out at all — strictly
    // worse than the 7 days it had before any of this.
    const fold = acc.folds.get(acc.payload?.leadKind === 'closure' ? 'closure' : 'live') ?? {
      oldestAt: undefined,
      strikes: 0,
      firstSuppressedAt: undefined,
    };
    if (fold.strikes > 0) merged.suppressedStrikes = fold.strikes;
    if (typeof fold.firstSuppressedAt === 'number') merged.firstSuppressedAt = fold.firstSuppressedAt;
    if (typeof fold.oldestAt === 'number') merged.submittedAt = fold.oldestAt;
    return merged;
  });
}


