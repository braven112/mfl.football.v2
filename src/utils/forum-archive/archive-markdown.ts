/**
 * Render the forum archive's Markdown subset (see phpbb-markup.mjs) to HTML.
 *
 * The text is old member posts and model output, so this is deliberately not a
 * Markdown library: every character is escaped first and only the handful of
 * shapes the archive produces are turned back into tags — paragraphs, nested
 * `>` quotes, `• ` lists, `**bold**`, http(s) links, and `[p123]` citations.
 * Nothing else can produce markup, so the result is safe for `set:html`.
 */

export interface RenderOptions {
  /** Href for a `[p123]` citation; null leaves the citation as text. */
  citationHref?: (postId: number) => string | null;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string, opts: RenderOptions): string {
  let html = escapeHtml(text);
  html = html.replace(
    /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label: string, url: string) =>
      `<a href="${url}" rel="nofollow noopener noreferrer" target="_blank">${label || url}</a>`,
  );
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  if (opts.citationHref) {
    html = html.replace(/\[p(\d{1,9})\]/g, (m, id: string) => {
      const href = opts.citationHref!(Number(id));
      return href ? `<a class="fa-cite" href="${escapeHtml(href)}">#${id}</a>` : '';
    });
  }
  return html;
}

export function renderArchiveMarkdown(markdown: string, opts: RenderOptions = {}): string {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.startsWith('>')) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        inner.push(lines[i].replace(/^> ?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderArchiveMarkdown(inner.join('\n'), opts)}</blockquote>`);
      continue;
    }

    if (/^• /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^• /.test(lines[i])) {
        items.push(`<li>${inline(lines[i].slice(2), opts)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('>') && !/^• /.test(lines[i])) {
      para.push(inline(lines[i], opts));
      i++;
    }
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return out.join('');
}
