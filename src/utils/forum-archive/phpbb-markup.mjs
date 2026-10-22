/**
 * phpBB 3.2+ stores a post as s9e/TextFormatter XML: `<t>plain</t>` or
 * `<r>rich</r>`, where the BBCode the author typed sits inside `<s>`/`<e>`
 * marker elements next to the rendered tags (`<B><s>[b]</s>bold<e>[/b]</e></B>`).
 *
 * The archive keeps a post as a small Markdown subset instead, because the
 * same text has three readers: the thread page (rendered by
 * `archive-markdown.ts`, which only understands this subset), the owners'
 * download, and the Ask Schefter model. What survives:
 *
 *   - paragraphs and line breaks
 *   - `> ` quote blocks, nested, headed `**Author wrote:**`
 *   - `**bold**`
 *   - `[text](url)` links (http/https only — the renderer drops the rest)
 *   - `• ` list items
 *
 * Everything else (colour, size, underline, smilies) collapses to its text.
 */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** @param {string} s */
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** @param {string} tag */
function attrsOf(tag) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of tag.matchAll(/([a-z_]+)="([^"]*)"/gi)) out[m[1].toLowerCase()] = decodeEntities(m[2]);
  return out;
}

/** A link target the archive is willing to keep. */
function safeUrl(url) {
  const u = String(url ?? '').trim();
  return /^https?:\/\/[^\s()]+$/i.test(u) ? u : null;
}

/** Markdown link text cannot carry brackets. */
function linkText(text) {
  return text.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Convert one stored phpBB post body to the archive's Markdown subset.
 *
 * @param {string} xml
 * @returns {string}
 */
export function phpbbToMarkdown(xml) {
  // phpBB writes `<br/>` AND the newline the author typed; keep one.
  const src = String(xml ?? '').replace(/<br\s*\/?>\r?\n/gi, '<br/>');
  /** @type {Array<{ tag: string, attrs: Record<string, string>, text: string }>} */
  const stack = [{ tag: 'ROOT', attrs: {}, text: '' }];
  const top = () => stack[stack.length - 1];
  let skipDepth = 0; // inside <s>…</s> / <e>…</e>: the typed BBCode, never shown

  for (const token of src.split(/(<\/?[A-Za-z][^>]*>)/)) {
    if (!token) continue;
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9]*)\b[^>]*?(\/?)>$/.exec(token);
    if (!m) {
      if (!skipDepth) top().text += decodeEntities(token);
      continue;
    }
    const [, closing, rawName, selfClosing] = m;
    const name = rawName.toUpperCase();

    if (name === 'S' || name === 'E') {
      if (selfClosing) continue;
      skipDepth += closing ? -1 : 1;
      if (skipDepth < 0) skipDepth = 0;
      continue;
    }
    if (skipDepth) continue;

    if (name === 'BR') { top().text += '\n'; continue; }
    if (name === 'T' || name === 'R') continue;

    if (!closing && !selfClosing) {
      stack.push({ tag: name, attrs: attrsOf(token), text: '' });
      continue;
    }
    if (selfClosing) continue;

    // Closing tag: pop to the matching open (tolerates sloppy nesting).
    let idx = stack.length - 1;
    while (idx > 0 && stack[idx].tag !== name) idx--;
    if (idx === 0) continue;
    while (stack.length - 1 > idx) {
      const orphan = stack.pop();
      top().text += orphan.text;
    }
    const frame = stack.pop();
    top().text += renderFrame(frame);
  }
  while (stack.length > 1) {
    const orphan = stack.pop();
    top().text += orphan.text;
  }
  return tidy(stack[0].text);
}

/** @param {{ tag: string, attrs: Record<string, string>, text: string }} frame */
function renderFrame({ tag, attrs, text }) {
  switch (tag) {
    case 'QUOTE': {
      const body = tidy(text);
      const head = attrs.author ? `**${attrs.author.replace(/\*/g, '')} wrote:**\n` : '';
      const quoted = `${head}${body}`.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
      return `\n\n${quoted}\n\n`;
    }
    case 'B': {
      const t = text.trim();
      return t && !t.includes('\n') ? `**${t.replace(/\*/g, '')}**` : text;
    }
    case 'URL': {
      const url = safeUrl(attrs.url);
      const label = linkText(text) || attrs.url || '';
      return url ? `[${label || url}](${url})` : label;
    }
    case 'IMG': {
      const url = safeUrl(attrs.src || text);
      return url ? `[image](${url})` : '';
    }
    case 'ATTACHMENT':
      return `[attachment: ${linkText(attrs.filename || text)}]`;
    case 'LI':
      return `\n• ${text.trim()}`;
    case 'LIST':
      return `\n${text.trim()}\n`;
    case 'CODE':
      return `\n${text}\n`;
    default:
      return text;
  }
}

/** Normalise whitespace: trim lines' trailing space, at most one blank line. */
function tidy(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
