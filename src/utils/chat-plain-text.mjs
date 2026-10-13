/**
 * Chat plain text — no HTML ever reaches a group chat.
 *
 * GroupMe and Slack render a message as plain text, so a `<p>` in the body
 * shows up as the four characters `<p>` in front of every owner. The site's
 * article prompts tell the model to "Wrap paragraphs in <p> tags" (that copy
 * renders through `set:html`), and that instruction rides along in the shared
 * cached system block to every lane that reuses it — including ones whose
 * output is meant to be a bare sentence. On 2026-10-13 TheLeague's Week 5
 * Pecking Order came back with every blurb wrapped in `<p>…</p>`, and the
 * GroupMe announcement quoted three of them verbatim; the AFL's run of the
 * same code that morning happened not to, which is the whole difference
 * between the two posts. Nondeterministic model formatting is not something a
 * template test can catch, so this runs on the SEND path, the same way
 * the link-punctuation sanitizer does (see link-punctuation.mjs).
 *
 * It removes anything shaped like a tag — `<` IMMEDIATELY followed by a
 * letter, `/` or `!--` — and decodes named and numeric entities, so chat
 * prose such as "<3", "a < b" or "Q&A" passes through untouched. Text with no
 * HTML in it is returned as the identical string.
 *
 * Every bot-post primitive calls it, ahead of the link-punctuation pass: `scripts/lib/groupme.mjs#postToGroupMe`,
 * `scripts/lib/speculation-groupme.mjs`, `scripts/lib/chat.mjs#toSlackText`
 * and `src/utils/groupme-client.ts#postAsBot`. `tests/chat-plain-text.test.ts`
 * pins those call sites.
 *
 * A `.mjs` on purpose — plain-node scripts and the TS runtime both import it.
 */

// Tags that end a line of prose. A paragraph BOUNDARY (`</p><p>`) is a blank
// line; any other block tag just goes, so a blurb quoted mid-sentence
// (`— "<p>…</p>"`) stays on its line.
const PARA = 'p|div|h[1-6]|blockquote|pre|section|article|header|footer|figure|figcaption';

const COMMENT_RE = /<!--[\s\S]*?-->/g;
const BR_RE = /<br\s*\/?>/gi;
const HR_RE = /<hr\b[^<>]*>/gi;
const PARA_BREAK_RE = new RegExp(`</(?:${PARA})\\s*>\\s*<(?:${PARA})\\b[^<>]*>`, 'gi');
const LIST_RE = /<\/?(?:ul|ol|dl|table|thead|tbody|tr)\b[^<>]*>/gi;
const LI_OPEN_RE = /<li\b[^<>]*>/gi;
const ANCHOR_RE = /<a\b[^<>]*?\bhref\s*=\s*(["'])(.*?)\1[^<>]*>([\s\S]*?)<\/a\s*>/gi;
const IMG_RE = /<img\b[^<>]*?\balt\s*=\s*(["'])(.*?)\1[^<>]*>/gi;
// Any remaining tag: `<` then a letter (or `/letter`). "<3" and "a < b" never
// match because the character after `<` is not a letter.
const ANY_TAG_RE = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi;
const ENTITY_RE = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,31}));/gi;
const HAS_HTML_RE = /<!--|<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>|&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', bull: '•', middot: '·', laquo: '«', raquo: '»',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷', plusmn: '±',
  frac12: '½', frac14: '¼', frac34: '¾', cent: '¢', pound: '£', euro: '€', yen: '¥',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', sect: '§', para: '¶', shy: '',
  // Straight quotes: the chat copy rules forbid curly ones.
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', sbquo: "'", bdquo: '"', prime: "'", Prime: '"',
};

function decodeEntity(m, dec, hex, name) {
  if (name) return NAMED[name] ?? NAMED[name.toLowerCase()] ?? m;
  const code = dec ? Number(dec) : parseInt(hex, 16);
  if (code === 8216 || code === 8217) return "'";
  if (code === 8220 || code === 8221) return '"';
  try { return String.fromCodePoint(code); } catch { return m; }
}

/** True when `text` carries a tag, comment or entity this module would rewrite. */
export function hasChatHtml(text) {
  return typeof text === 'string' && HAS_HTML_RE.test(text);
}

/** The conversion, without trimming the ends (mention segments need theirs). */
function convert(text) {
  return text
    .replace(COMMENT_RE, '')
    .replace(ANCHOR_RE, (_m, _q, href, inner) => {
      const label = inner.replace(ANY_TAG_RE, '').trim();
      return /^https?:\/\//i.test(href) && !label.includes(href) ? `${label} ${href}`.trim() : label;
    })
    .replace(IMG_RE, (_m, _q, alt) => alt)
    .replace(BR_RE, '\n')
    .replace(HR_RE, '\n')
    .replace(PARA_BREAK_RE, '\n\n')
    .replace(LI_OPEN_RE, '\n• ')
    .replace(LIST_RE, '\n')
    .replace(ANY_TAG_RE, '')
    .replace(ENTITY_RE, decodeEntity)
    // Tidy what the tags left behind: no spaces hugging a newline, at most
    // one blank line.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?!•)/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Convert any HTML in a chat message to plain text. Paragraph and line breaks
 * become newlines; a link keeps its text, plus its URL when the URL is
 * absolute and not already in the text (a relative href means nothing in a
 * chat, so it is dropped rather than printed as a dead path); an image keeps
 * its alt text.
 *
 * @param {string} text
 * @returns {string}
 */
export function toChatPlainText(text) {
  if (!hasChatHtml(text)) return text;
  return convert(text).trim();
}

/**
 * `toChatPlainText` for a message that may carry GroupMe mention `loci`
 * (`[start, length]` offsets into the exact string sent). Each stretch
 * between mentions is converted separately and the offsets are re-based, the
 * same way `scrubChatText` does it, so a tag still lands on its name.
 * Segments are not trimmed: the space beside a mention is what separates it
 * from the words around it.
 *
 * @param {string} text
 * @param {Array<any>} [attachments]
 * @returns {{ text: string, attachments: Array<any> }}
 */
export function toChatPlainTextWithMentions(text, attachments = []) {
  if (!hasChatHtml(text)) return { text, attachments };
  const mention = (attachments ?? []).find((a) => a?.type === 'mentions' && Array.isArray(a.loci));
  if (!mention || mention.loci.length === 0) return { text: toChatPlainText(text), attachments };
  const order = mention.loci.map((l, i) => ({ start: l[0], length: l[1], i })).sort((a, b) => a.start - b.start);
  const seg = (s) => (hasChatHtml(s) ? convert(s) : s);
  let out = '';
  let cursor = 0;
  const loci = mention.loci.map((l) => [...l]);
  for (const m of order) {
    out += seg(text.slice(cursor, m.start));
    loci[m.i] = [out.length, m.length];
    out += text.slice(m.start, m.start + m.length);
    cursor = m.start + m.length;
  }
  out += seg(text.slice(cursor));
  // Only the message's own ends are trimmed, and only before/after mentions.
  const lead = out.length - out.trimStart().length;
  const trimmed = out.trim();
  return {
    text: trimmed,
    attachments: attachments.map((a) =>
      a === mention ? { ...a, loci: loci.map(([s, l]) => [s - lead, l]) } : a,
    ),
  };
}
