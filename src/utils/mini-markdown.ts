/**
 * A small, escape-first Markdown renderer for the private documents page.
 *
 * Deliberately a subset — the one the proposal is written in: `#`–`####`
 * headings, paragraphs, **bold**, *italic*, `code`, [links](url), bullet /
 * numbered / `- [ ]` task lists (one level of 2–4-space nesting), pipe tables
 * and `---` rules. No raw HTML passes through: every text run is escaped
 * BEFORE any markup is added, and a link's URL must be http(s), a same-origin
 * path or a fragment, so the output is safe for `set:html` even though only
 * the owner can write the source.
 *
 * No dependency on purpose: a general Markdown library does not sanitize, and
 * pulling one in plus a sanitizer for a single owner-only page is more surface
 * than this needs.
 */

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** http(s), a same-origin absolute path, or an in-page fragment. Everything else renders as text. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (url.startsWith('#')) return url;
  return null;
}

/** Inline markup over ONE line of source. Code spans are cut out first so their contents stay literal. */
export function renderInline(source: string): string {
  const parts = source.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      let out = '';
      let rest = part;
      const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/;
      let match: RegExpExecArray | null;
      while ((match = linkRe.exec(rest))) {
        out += emphasis(escapeHtml(rest.slice(0, match.index)));
        const href = safeHref(match[2]);
        const label = emphasis(escapeHtml(match[1]));
        out += href
          ? `<a href="${escapeHtml(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`
          : label;
        rest = rest.slice(match.index + match[0].length);
      }
      return out + emphasis(escapeHtml(rest));
    })
    .join('');
}

/** Bold then italic, over already-escaped text. */
function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

interface ListItem {
  ordered: boolean;
  text: string;
  children: ListItem[];
  childOrdered: boolean;
}

function renderListItems(items: ListItem[], ordered: boolean): string {
  const isTaskList = items.every((item) => /^\[[ xX]\]\s/.test(item.text));
  const tag = ordered ? 'ol' : 'ul';
  const inner = items
    .map((item) => {
      let body: string;
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item.text);
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        body = `<input type="checkbox" disabled${checked ? ' checked' : ''} aria-label="${checked ? 'Done' : 'Open'}"> ${renderInline(task[2])}`;
      } else {
        body = renderInline(item.text);
      }
      const nested = item.children.length ? renderListItems(item.children, item.childOrdered) : '';
      return `<li${task ? ' class="task"' : ''}>${body}${nested}</li>`;
    })
    .join('');
  return `<${tag}${isTaskList ? ' class="tasks"' : ''}>${inner}</${tag}>`;
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    // Table: a pipe row immediately followed by a separator row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
      const body = rows
        .map(
          (row) =>
            `<tr>${header.map((_, col) => `<td>${renderInline(row[col] ?? '')}</td>`).join('')}</tr>`,
        )
        .join('');
      html.push(
        `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      );
      continue;
    }

    const first = LIST_ITEM.exec(line);
    if (first && first[1].length < 2) {
      const ordered = /\d/.test(first[2]);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m) break;
        const nestedItem = m[1].length >= 2;
        const item: ListItem = { ordered: /\d/.test(m[2]), text: m[3], children: [], childOrdered: false };
        if (nestedItem && items.length) {
          const parent = items[items.length - 1];
          if (!parent.children.length) parent.childOrdered = item.ordered;
          parent.children.push(item);
        } else if (item.ordered === ordered) {
          items.push(item);
        } else {
          break;
        }
        i++;
      }
      html.push(renderListItems(items, ordered));
      continue;
    }

    // Paragraph: consecutive lines that start no other block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]))
    ) {
      para.push(lines[i].trim());
      i++;
    }
    html.push(`<p>${para.map(renderInline).join(' ')}</p>`);
  }

  return html.join('\n');
}
