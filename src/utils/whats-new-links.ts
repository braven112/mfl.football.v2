/**
 * Inline links inside What's New article bodies.
 *
 * THE BUG THIS EXISTS FOR. The Strength of Division launch article ran six
 * paragraphs naming the standings, the franchise pages and the division page
 * itself, and the reader could not click a single one of them — the only link
 * on the page was the CTA button under the article. A `grep '<a '` across
 * `src/data/whats-new.json` at the time returned ZERO across all 40 entries.
 * What's New had never linked to anything, ever. Same failure Schefter had
 * (see `scripts/article-utils/article-links.mjs`), same fix shape.
 *
 * TWO THINGS HAVE TO BE TRUE, and they pull against each other:
 *
 *  1. The href in the JSON has to be LEAGUE-NEUTRAL (`/standings`, not
 *     `/theleague/standings`). One entry body is rendered to readers of every
 *     league it is tagged for, so a prefixed href sends half the audience into
 *     the other league's site. `tests/whats-new-links.test.ts` enforces this
 *     the same way `whats-new-data.test.ts` already enforces it for the entry's
 *     own `link`.
 *  2. A bare `/standings` 404s on the shared host, which has no root route.
 *
 * Which is why the href stored in JSON is never the href that ships: the
 * detail page runs every description block through `rewriteDescriptionLinks`
 * with the same resolver it already uses for the CTA, so `/standings` becomes
 * `/afl-fantasy/standings` for an AFL reader and plain `/standings` again on
 * an apex host. Description blocks render through `set:html`, which is exactly
 * why they need this — raw HTML never gets the `resolveLeaguePath()` treatment
 * a normal `<a>` in a component gets.
 *
 * Anything that is not a root-relative internal path — `https://…`, `mailto:`,
 * a bare `#anchor` — is left alone. Prefixing an external URL would break it.
 */

import type { DescriptionBlock, WhatsNewEntry } from '../types/whats-new';

/**
 * Categories whose articles must carry at least one inline link.
 *
 * Deliberately the same split as the screenshot requirement: an article
 * announcing a page or a feature exists to send you there, while a bug-fix
 * rollup and a league-event note are reports about something that happened.
 */
export const LINK_REQUIRED_CATEGORIES = ['new-page', 'new-feature', 'enhancement'] as const;

/** Does this entry's category owe the reader inline links? */
export function requiresInlineLinks(category: string): boolean {
  return (LINK_REQUIRED_CATEGORIES as readonly string[]).includes(category);
}

/**
 * `href="…"` on an anchor tag. Single or double quotes, any attribute order.
 * Capture groups: 1 = everything up to and including `href=`, 2 = the quote
 * character, 3 = the URL itself.
 */
const HREF_PATTERN = /(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"']*)\2/gi;

/**
 * Anchor open tag through to its closing tag — used to read the link text.
 *
 * Note this requires the `</a>` and `HREF_PATTERN` does not, which is exactly
 * the gap `countAnchorOpenTags` exists to close: an unclosed `<a>` would be
 * league-prefixed by the rewriter and then be invisible to every check that
 * reads links out of the JSON.
 */
const ANCHOR_PATTERN = /<a\b[^>]*?\bhref\s*=\s*(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Is this href an internal path we should re-point at the reader's league?
 *
 * Root-relative only. `#top` is a same-page jump, and anything with a scheme
 * belongs to somebody else.
 */
export function isInternalPath(href: string): boolean {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

/**
 * Top-level paths that are served as-is and must NEVER be league-prefixed.
 *
 * `public/` is mounted at the root and is not league-scoped: the vintage-art
 * article links a master banner at `/assets/theleague/history/psd/…jpg`, and
 * prefixing that to `/theleague/assets/theleague/…` 404s a file that exists.
 * Same for `/api/` handlers, which have no league in their path either.
 */
const STATIC_ROOTS = ['/assets/', '/embed/', '/api/'];

/** A file, not a page — anything with an extension on its last segment. */
const FILE_EXTENSION = /\.[a-z0-9]{2,5}$/i;

/**
 * Is this internal path a page (league-scoped, gets prefixed) or a raw file /
 * endpoint (served at the root, left alone)?
 */
export function isLeagueScopedPath(href: string): boolean {
  if (!isInternalPath(href)) return false;
  const [pathOnly] = href.split(/[?#]/);
  if (STATIC_ROOTS.some((root) => pathOnly.startsWith(root))) return false;
  const lastSegment = pathOnly.split('/').pop() ?? '';
  return !FILE_EXTENSION.test(lastSegment);
}

/** Text blocks of a description, ignoring inline image blocks. */
function textBlocks(description: readonly DescriptionBlock[] | undefined): string[] {
  return (description ?? []).filter((block): block is string => typeof block === 'string');
}

/** Every href in an article body, in document order, external ones included. */
export function extractDescriptionHrefs(
  description: readonly DescriptionBlock[] | undefined,
): string[] {
  const hrefs: string[] = [];
  for (const block of textBlocks(description)) {
    for (const match of block.matchAll(ANCHOR_PATTERN)) hrefs.push(match[2]);
  }
  return hrefs;
}

/**
 * Inner HTML of an anchor reduced to its readable text.
 *
 * Repeated until it stops changing rather than one `.replace()` pass: a single
 * pass over `<<b>>` leaves a stray `<>` behind, which CodeQL flags as an
 * incomplete multi-character sanitizer. Nothing here is rendered — this feeds
 * the "anchor text is not a bare URL" guard — but a stripper that silently
 * leaves markup behind would make that guard read the wrong string.
 */
function stripTags(html: string): string {
  let text = html;
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^<>]*>/g, '');
  }
  return text;
}

/** Every `{ href, text }` pair in an article body, in document order. */
export function extractDescriptionLinks(
  description: readonly DescriptionBlock[] | undefined,
): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  for (const block of textBlocks(description)) {
    for (const match of block.matchAll(ANCHOR_PATTERN)) {
      links.push({ href: match[2], text: stripTags(match[3]).trim() });
    }
  }
  return links;
}

/**
 * How many anchors the RENDERER will act on — open tags, closed or not.
 *
 * Compare against `extractDescriptionHrefs().length` to catch a missing `</a>`:
 * the rewriter happily prefixes an unclosed anchor's href, while every guard
 * that reads links out of the JSON matches on the full `<a>…</a>` and skips it.
 * A link nothing validates is the one that ships pointing at the wrong league.
 */
export function countAnchorOpenTags(
  description: readonly DescriptionBlock[] | undefined,
): number {
  let count = 0;
  for (const block of textBlocks(description)) {
    for (const _ of block.matchAll(HREF_PATTERN)) count++;
  }
  return count;
}

/**
 * How many links in an entry's body point at a PAGE on this site.
 *
 * The "every launch article must link to something" rule is about sending the
 * reader to the feature being announced, so only these count. An article whose
 * one anchor is `https://espn.com` — or a `/assets/…webp` download — has still
 * named a page it never let you open, which is the whole bug.
 */
export function countSiteLinks(entry: Pick<WhatsNewEntry, 'description'>): number {
  return extractDescriptionHrefs(entry.description).filter(isLeagueScopedPath).length;
}

/**
 * Re-point every internal href in one description block for the reader.
 *
 * @param html - One description paragraph, raw HTML as stored in the JSON
 * @param resolve - The detail page's own link resolver (league prefix in,
 *   apex-host prefix back out). Applied to the path only; a `?query` and
 *   `#hash` are split off first and re-attached, so the resolver never has to
 *   care about them.
 */
export function rewriteDescriptionLinks(html: string, resolve: (path: string) => string): string {
  if (typeof html !== 'string') return html;
  return html.replace(HREF_PATTERN, (whole, lead: string, quote: string, href: string) => {
    if (!isLeagueScopedPath(href)) return whole;
    const suffixAt = href.search(/[?#]/);
    const pathOnly = suffixAt === -1 ? href : href.slice(0, suffixAt);
    const suffix = suffixAt === -1 ? '' : href.slice(suffixAt);
    return `${lead}${quote}${resolve(pathOnly)}${suffix}${quote}`;
  });
}
