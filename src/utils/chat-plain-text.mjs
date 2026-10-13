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
 * Deliberately CONSERVATIVE: it only removes things that are unmistakably
 * HTML — a known tag name, or a named/numeric entity — so chat prose such as
 * "<3", "a < b" or "Q&A" passes through untouched. Text with no HTML in it is
 * returned as the identical string.
 *
 * Every bot-post primitive calls it, ahead of the link-punctuation pass: `scripts/lib/groupme.mjs#postToGroupMe`,
 * `scripts/lib/speculation-groupme.mjs`, `scripts/lib/chat.mjs#toSlackText`
 * and `src/utils/groupme-client.ts#postAsBot`. `tests/chat-plain-text.test.ts`
 * pins those call sites.
 *
 * A `.mjs` on purpose — plain-node scripts and the TS runtime both import it.
 */

const BLOCK_TAGS = 'p|div|h[1-6]|blockquote|ul|ol|li|tr|table|section|article|header|footer';
const PARA = 'p|div|h[1-6]|blockquote|section|article|header|footer';
const INLINE_TAGS = 'a|strong|em|b|i|u|s|span|code|small|mark|sup|sub|abbr|cite|q|del|ins';

const BR_RE = /<br\s*\/?>/gi;
// A paragraph BOUNDARY is a blank line; any other block tag just goes, so a
// blurb quoted mid-sentence (`— "<p>…</p>"`) stays on its line.
const PARA_BREAK_RE = new RegExp(`</(?:${PARA})\\s*>\\s*<(?:${PARA})\\b[^<>]*>`, 'gi');
const LIST_RE = /<\/?(?:ul|ol|table|tr)\b[^<>]*>/gi;
const BLOCK_RE = new RegExp(`</?(?:${BLOCK_TAGS})\\b[^<>]*>`, 'gi');
const LI_OPEN_RE = /<li\b[^<>]*>/gi;
const ANCHOR_RE = /<a\b[^<>]*?\bhref\s*=\s*(["'])(.*?)\1[^<>]*>([\s\S]*?)<\/a\s*>/gi;
const INLINE_RE = new RegExp(`</?(?:${INLINE_TAGS})\\b[^<>]*>`, 'gi');
const ENTITY_RE = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo));/gi;
const HAS_HTML_RE = new RegExp(
  `<br\\s*/?>|</?(?:${BLOCK_TAGS}|${INLINE_TAGS})\\b[^<>]*>|&(?:#\\d{1,7}|#x[0-9a-f]{1,6}|amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo);`,
  'i',
);

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  // Straight quotes: the chat copy rules forbid curly ones.
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
};

/** True when `text` carries a tag or entity this module would rewrite. */
export function hasChatHtml(text) {
  return typeof text === 'string' && HAS_HTML_RE.test(text);
}

/**
 * Convert any HTML in a chat message to plain text. Paragraph and line breaks
 * become newlines; a link keeps its text, plus its URL when the URL is
 * absolute and not already in the text (a relative href means nothing in a
 * chat, so it is dropped rather than printed as a dead path).
 *
 * @param {string} text
 * @returns {string}
 */
export function toChatPlainText(text) {
  if (!hasChatHtml(text)) return text;
  let out = text
    .replace(ANCHOR_RE, (_m, _q, href, inner) => {
      const label = inner.replace(INLINE_RE, '').trim();
      return /^https?:\/\//i.test(href) && !label.includes(href) ? `${label} ${href}`.trim() : label;
    })
    .replace(BR_RE, '\n')
    .replace(PARA_BREAK_RE, '\n\n')
    .replace(LI_OPEN_RE, '\n• ')
    .replace(LIST_RE, '\n')
    .replace(BLOCK_RE, '')
    .replace(INLINE_RE, '')
    .replace(ENTITY_RE, (m, dec, hex, name) => {
      if (name) return NAMED[name.toLowerCase()] ?? m;
      const code = dec ? Number(dec) : parseInt(hex, 16);
      if (code === 8216 || code === 8217) return "'";
      if (code === 8220 || code === 8221) return '"';
      try { return String.fromCodePoint(code); } catch { return m; }
    });
  // Tidy what the tags left behind: no spaces hugging a newline, at most one
  // blank line, nothing dangling at either end.
  out = out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?!•)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}

/**
 * `toChatPlainText` for a message that may carry GroupMe mention `loci`
 * (`[start, length]` offsets into the exact string sent). Each stretch
 * between mentions is converted separately and the offsets are re-based, the
 * same way `scrubChatText` does it, so a tag still lands on its name.
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
  // Segment-wise, so no trim: a segment's edge whitespace separates it from
  // the mention beside it.
  const seg = (s) => (hasChatHtml(s) ? toChatPlainTextSegment(s) : s);
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
  return { text: out, attachments: attachments.map((a) => (a === mention ? { ...a, loci } : a)) };
}

function toChatPlainTextSegment(s) {
  const lead = s.match(/^\s*/)[0];
  const trail = s.match(/\s*$/)[0];
  const body = toChatPlainText(s);
  return body ? `${lead}${body}${trail}` : lead || trail;
}
