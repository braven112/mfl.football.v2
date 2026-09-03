/**
 * Summarize an MFL *page* response for a log line.
 *
 * MFL's owner-facing handlers (`add_drop`, `options?O=…`) answer a POST with a
 * full XHTML page, not API XML. When the transaction does not happen, MFL
 * simply RE-RENDERS THE FORM — often with its complaint somewhere in the body —
 * and a naive `body.slice(0, 200)` captures nothing but the doctype and `<head>`.
 * That is exactly what happened while diagnosing the AFL waiver claim: three
 * rounds of logs proved only that a page came back.
 *
 * So this pulls out the three things that actually identify what MFL did:
 *
 *  - `title`      which page it decided to show (an Add/Drop form? a login?)
 *  - `submits`    the submit controls ON that page. This is the important one:
 *                 a re-rendered form is MFL telling you the exact action it
 *                 expects right now, and during a locked waiver period that
 *                 button is not the same one as during free agency.
 *  - `text`       visible copy, script/style stripped, whitespace collapsed —
 *                 where any "you cannot do that because…" sentence lives.
 *
 * Nothing here is a success check. It is for the log, so the next failure names
 * its own cause instead of costing another round-trip through a human.
 */

export interface MflPageSummary {
  title: string | null;
  /** `name=value` of every submit control, in document order. */
  submits: string[];
  /** Visible text, collapsed, truncated to `maxText`. */
  text: string;
}

const attr = (tag: string, name: string): string | null =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;

/**
 * @param html - Raw response body.
 * @param maxText - Cap on the visible-text excerpt (default 1200).
 */
export function summarizeMflPage(html: string, maxText = 1200): MflPageSummary {
  const body = html ?? '';

  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null;

  const submits: string[] = [];
  for (const [tag] of body.matchAll(/<input[^>]*>/gi)) {
    if (!/type\s*=\s*["']?submit/i.test(tag)) continue;
    const name = attr(tag, 'name');
    const value = attr(tag, 'value');
    submits.push([name, value].filter(Boolean).join('=') || '(unnamed submit)');
  }
  for (const [tag, inner] of body.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)) {
    const label = inner.replace(/<[^>]*>/g, '').trim();
    submits.push([attr(tag, 'name'), label].filter(Boolean).join('=') || '(button)');
  }

  const text = body
    // Drop the parts that are never visible copy but are most of the bytes.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, submits, text: text.slice(0, maxText) };
}
