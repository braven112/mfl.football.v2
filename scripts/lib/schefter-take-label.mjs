/**
 * Every surface that shows a post's `analysis` prints its own label above or
 * before it ("Schefter's Take", "The take:"). The commentary model was asked
 * for a "Schefter's Take" and often wrote the label into the text too, so
 * cards read "The take: Schefter's Take: …". Strip a leading "<Name>'s Take:"
 * (any reporter voice, straight or curly apostrophe, colon or dash), on read
 * for every post already stored and on write for new ones.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripTakeLabel(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/^(\s*(?:<[^>]+>\s*)*)(?:[A-Z][\w.]*(?: [A-Z][\w.]*){0,2}['’]s )?Take\s*(?:<\/[^>]+>\s*)?[:—–-]\s*(?:<\/[^>]+>\s*)?/, '$1');
}
