/**
 * The Pecking Order's intro is at most three sentences (commissioner,
 * 2026-10-15): the column is the rankings, and a long lede pushed #1 below
 * the fold on a phone. Shared by the generator (scripts/generate-pecking-order.mjs,
 * scripts/lib/pecking-order-ai.mjs) and the page, which also caps older issues
 * written before the rule.
 */
export const LEDE_MAX_SENTENCES = 3;

/**
 * Split on sentence-ending punctuation followed by whitespace and a capital
 * (or an opening quote). A decimal ("147.57"), a rank ("#4.5"), or an
 * abbreviation followed by a lower-case word does not end a sentence.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  return flat.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z#0-9])/);
}

/**
 * First `max` sentences. Paragraph breaks between kept sentences survive —
 * the lede also goes out in the GroupMe post, where they read as paragraphs.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function capSentences(text, max = LEDE_MAX_SENTENCES) {
  const kept = [];
  let left = max;
  for (const para of String(text ?? '').split(/\n\s*\n/)) {
    if (left <= 0) break;
    const sentences = splitSentences(para).slice(0, left);
    if (sentences.length === 0) continue;
    kept.push(sentences.join(' '));
    left -= sentences.length;
  }
  return kept.join('\n\n');
}
