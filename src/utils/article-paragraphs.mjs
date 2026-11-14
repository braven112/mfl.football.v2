/**
 * Short paragraphs for Schefter's long-form previews.
 *
 * Owner's call (Nov 2026): the Friday and Saturday previews read as a wall of
 * text on a phone. Sports sites write one or two sentences per paragraph, so
 * the reader never loses their place. The prompts ask for that, and this
 * splitter enforces it at render time so a column the model wrote long (and
 * every preview already in the feed) still reads short.
 *
 * Only the article types listed in SHORT_PARAGRAPH_TYPES are split. The rest
 * keep the paragraphs they were written with.
 */

/** Article types whose copy renders as 1-2 sentence paragraphs. */
export const SHORT_PARAGRAPH_TYPES = ['weekend-preview', 'matchup-preview'];

/** At most this many sentences share a paragraph. */
export const MAX_SENTENCES_PER_PARAGRAPH = 2;

/**
 * Two sentences share a paragraph only while together they stay this short
 * (visible characters). A long sentence stands alone.
 */
export const MAX_PAIRED_CHARS = 200;

// Words that end in a period without ending the sentence ("St. Brown",
// "vs. the Ninjas"). Single capital initials ("T.J. Watt") are handled apart.
const ABBREVIATIONS = new Set([
  'st', 'jr', 'sr', 'mr', 'mrs', 'ms', 'dr', 'vs', 'no', 'mt', 'ft', 'etc', 'approx',
]);

/**
 * Which article type a feed post is, from its id (`sf_2026_weekend_preview_w09`).
 * @param {{ id?: string }} post
 * @returns {string | null}
 */
export function articleTypeOf(post) {
  const id = String(post?.id ?? '');
  for (const type of SHORT_PARAGRAPH_TYPES) {
    if (id.includes(`_${type.replace(/-/g, '_')}_`)) return type;
  }
  return null;
}

/** Strip one outer <p>…</p> wrapper, if the paragraph has one. */
function unwrap(html) {
  const m = /^\s*<p(?:\s[^>]*)?>([\s\S]*)<\/p>\s*$/i.exec(html);
  return (m ? m[1] : html).trim();
}

/** Characters outside tags. Measures only; the HTML itself is never rewritten. */
function visibleLength(html) {
  let n = 0;
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) n++;
  }
  return n;
}

/** The word right before index `end` (exclusive), letters only. */
function wordBefore(text, end) {
  let i = end;
  while (i > 0 && /[A-Za-z]/.test(text[i - 1])) i--;
  return text.slice(i, end);
}

/**
 * Split one paragraph's HTML into sentences. Never splits inside a tag or an
 * anchor, so links survive whole.
 * @param {string} html
 * @returns {string[]}
 */
export function splitSentences(html) {
  const text = unwrap(html);
  const out = [];
  let start = 0;
  let inTag = false;
  let anchorDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<') {
      inTag = true;
      if (/^<a[\s>]/i.test(text.slice(i, i + 3))) anchorDepth++;
      else if (/^<\/a\s*>/i.test(text.slice(i, i + 4))) anchorDepth = Math.max(0, anchorDepth - 1);
      continue;
    }
    if (inTag) {
      if (ch === '>') inTag = false;
      continue;
    }
    if (anchorDepth > 0 || !/[.!?]/.test(ch)) continue;

    // Swallow repeated terminators, closing quotes/brackets and closing
    // inline tags that belong to this sentence ('Boom!"', '</strong>').
    let j = i + 1;
    for (;;) {
      if (j < text.length && /[.!?"')\]]/.test(text[j])) { j++; continue; }
      const close = /^<\/(?:strong|b|em|i|span)\s*>/i.exec(text.slice(j));
      if (close) { j += close[0].length; continue; }
      break;
    }
    if (j >= text.length || !/\s/.test(text[j])) continue;
    let k = j;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (k >= text.length || !/[A-Z0-9"'<(]/.test(text[k])) continue;

    if (ch === '.') {
      const word = wordBefore(text, i);
      if (ABBREVIATIONS.has(word.toLowerCase())) continue;
      if (/^[A-Z]$/.test(word)) continue; // an initial: "T.J. Watt", "D. Henry"
    }

    out.push(text.slice(start, j).trim());
    start = k;
    i = k - 1;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Re-flow paragraphs so none holds more than two sentences, and two share a
 * paragraph only while they are short together.
 * @param {string[]} paragraphs - HTML paragraphs, with or without <p> wrappers.
 * @returns {string[]} unwrapped HTML paragraphs.
 */
export function shortenParagraphs(paragraphs) {
  const out = [];
  for (const paragraph of paragraphs ?? []) {
    if (typeof paragraph !== 'string' || !paragraph.trim()) continue;
    let current = [];
    let currentLen = 0;
    for (const sentence of splitSentences(paragraph)) {
      const len = visibleLength(sentence);
      const fits =
        current.length > 0 &&
        current.length < MAX_SENTENCES_PER_PARAGRAPH &&
        currentLen + 1 + len <= MAX_PAIRED_CHARS;
      if (current.length > 0 && !fits) {
        out.push(current.join(' '));
        current = [];
        currentLen = 0;
      }
      current.push(sentence);
      currentLen += (currentLen ? 1 : 0) + len;
    }
    if (current.length) out.push(current.join(' '));
  }
  return out;
}

/**
 * The paragraphs an article page renders. Preview types are re-flowed short;
 * every other article renders exactly as written.
 * @param {{ id?: string, content?: string[] }} post
 * @returns {string[]}
 */
export function articleParagraphs(post) {
  const content = post?.content ?? [];
  return articleTypeOf(post) ? shortenParagraphs(content) : content;
}
