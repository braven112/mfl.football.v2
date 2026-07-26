/**
 * Cut Watch graders — deterministic detector for the "auto-cuts go by value"
 * factual bug (July 2026: a shipped article claimed "the system picks the
 * weakest combined-value players first"; the real deadline auto-cut is
 * marked-players-first, then newest waiver/FA/auction pickup first, with
 * trade acquisitions treated as long-held — value plays no role; see
 * src/utils/august-cut-selection-core.mjs).
 *
 * DO NOT detect this bug with a cut-verb regex. The shipped bad string
 * contains no cut/drop/release verb and no "based on / in order of"
 * connective. The detector below flags any SENTENCE where three lexicons
 * co-occur:
 *
 *   ACTION    — a selection verb (picks, takes, goes after, …)
 *   VALUE     — a player-worth term (weakest, combined-value, dead weight, …)
 *   MECHANISM — an automatic-actor term (the system, automatically, if you
 *               don't, no plan, …)
 *
 * A sentence may legitimately contain all three when it NEGATES the value
 * link ("the system takes your newest pickups regardless of value"), so a
 * negation escape hatch exempts sentences where a negator sits directly on
 * a VALUE term. The escape is deliberately narrow (negator within 3 words
 * of the value term, in either direction) so "when you don't pick, the
 * system picks the weakest…" — where the negation belongs to the
 * no-plan idiom, not the value claim — still fires.
 *
 * Canonical positive / negative strings live in
 * tests/cut-watch-auto-cut-rule.test.ts — tune against those, and add any
 * newly-observed euphemism there before loosening anything here.
 */

const ACTION_PATTERNS = [
  'picks?', 'selects?', 'chooses?', 'takes?', 'removes?', 'trims?',
  'sheds?', 'drops?', 'cuts?', 'releases?', 'claims?', 'axes?',
  'goes after', 'go after', 'targets?', 'starts? with', 'comes? for',
  'grabs?', 'purges?', 'clears? out',
];

const VALUE_PATTERNS = [
  'value[ds]?', 'combined[- ]value', 'weakest', 'weaker', 'worst',
  'lowest[- ]rated', 'lowest[- ]valued?', 'least valuable', 'dead weight',
  'deadweight', 'rated', 'ratings?', 'unranked', 'worth(?:less)?', 'projections?',
  'adp', 'bottom[- ]of[- ]the[- ]roster', 'scrubs?', 'bench fodder',
];

const MECHANISM_PATTERNS = [
  'the system', 'automatic(?:ally)?', 'auto[- ]?cuts?', 'auto[- ]?chosen',
  'auto[- ]?choose[sn]?', 'auto[- ]?picks?', 'auto[- ]?selected?',
  'by default', 'on its own', 'the machine', 'league machine',
  'the algorithm', "if you don'?t", "when you don'?t", 'no plan',
  'without a plan', 'for you at the deadline', 'does it for you',
  'left to the league', 'the league decides',
];

const NEGATORS =
  "(?:not|never|no|isn'?t|aren'?t|doesn'?t|does not|won'?t|wasn'?t|" +
  'ignor(?:es?|ing)|regardless of|rather than|instead of|plays no|' +
  'has nothing to do with|irrelevant to|blind to)';

function group(patterns) {
  return new RegExp(`\\b(?:${patterns.join('|')})\\b`, 'i');
}

const ACTION_RE = group(ACTION_PATTERNS);
const VALUE_RE = group(VALUE_PATTERNS);
const MECHANISM_RE = group(MECHANISM_PATTERNS);

// Negator within 3 words BEFORE a value term ("not the weakest",
// "regardless of value") or a value term within 3 words before a negator
// ("value plays no role", "value doesn't matter").
const NEGATED_VALUE_RE = new RegExp(
  `\\b${NEGATORS}\\b(?:\\s+\\S+){0,3}?\\s*\\b(?:${VALUE_PATTERNS.join('|')})\\b` +
    `|\\b(?:${VALUE_PATTERNS.join('|')})\\b(?:\\s+\\S+){0,3}?\\s*\\b${NEGATORS}\\b`,
  'i'
);

/** Strip HTML tags and collapse whitespace. */
export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Naive sentence split — good enough for feed copy (no abbreviation care). */
export function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Scan plain text (strip HTML first) for sentences that describe the
 * automatic deadline cut as value-based.
 *
 * @param {string} text
 * @returns {Array<{sentence: string, action: string, value: string, mechanism: string}>}
 *   One entry per offending sentence; empty array = clean.
 */
export function findValueBasedAutoCutClaims(text) {
  const violations = [];
  for (const sentence of splitSentences(text)) {
    const action = sentence.match(ACTION_RE);
    const value = sentence.match(VALUE_RE);
    const mechanism = sentence.match(MECHANISM_RE);
    if (!action || !value || !mechanism) continue;
    if (NEGATED_VALUE_RE.test(sentence)) continue;
    violations.push({
      sentence,
      action: action[0],
      value: value[0],
      mechanism: mechanism[0],
    });
  }
  return violations;
}

/**
 * Convenience: run the detector across a Schefter article's content blocks
 * (headline + excerpt + content[] HTML paragraphs).
 *
 * @param {{headline?: string, body?: string, excerpt?: string, content?: string[]}} post
 * @returns {ReturnType<typeof findValueBasedAutoCutClaims>}
 */
export function findValueBasedAutoCutClaimsInPost(post) {
  const parts = [
    post?.headline ?? '',
    post?.excerpt ?? post?.body ?? '',
    ...(post?.content ?? []).map(stripHtml),
  ];
  return parts.flatMap((part) => findValueBasedAutoCutClaims(stripHtml(part)));
}
