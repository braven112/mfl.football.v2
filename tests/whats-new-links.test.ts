import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import type { WhatsNewEntry } from '../src/types/whats-new';
import { ALL_LEAGUES } from '../src/config/leagues';
import entries from '../src/data/whats-new.json';
import {
  countAnchorOpenTags,
  countSiteLinks,
  extractDescriptionLinks,
  isInternalPath,
  isLeagueScopedPath,
  requiresInlineLinks,
  rewriteDescriptionLinks,
} from '../src/utils/whats-new-links';
import { astroRouteExists } from './helpers/astro-routes';

/**
 * A What's New article has to link to the thing it is about.
 *
 * The Strength of Division launch named the standings, the franchise pages and
 * the division page itself across six paragraphs and the reader could not click
 * one of them — the only link on the page was the CTA button underneath. A
 * `grep '<a '` over `whats-new.json` returned ZERO across all 40 live entries.
 * Nothing told us, because nothing was checking.
 *
 * Same three failure modes Schefter's `tests/article-links.test.ts` covers, and
 * the same answer: an article with no links, a link to a page that does not
 * exist, and a link that exists but points into the wrong league.
 */

const LINK_ENFORCEMENT_DATE = '2026-08-09';

const WHATS_NEW_ARCHIVE_DIR = resolve(__dirname, '../src/data/whats-new-archive');

const activeEntries = entries as WhatsNewEntry[];
const archiveEntries: WhatsNewEntry[] = existsSync(WHATS_NEW_ARCHIVE_DIR)
  ? readdirSync(WHATS_NEW_ARCHIVE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .flatMap((f) => JSON.parse(readFileSync(resolve(WHATS_NEW_ARCHIVE_DIR, f), 'utf-8')))
  : [];
/**
 * Correctness checks (dead link, wrong league) run over the FULL history —
 * archived entries still render at their permalinks, so a broken href there is
 * just as broken. Only the "must HAVE a link" requirement is dated, because
 * back-writing links into 106 archived columns is not what the rule is for.
 */
const allEntries: WhatsNewEntry[] = [...activeEntries, ...archiveEntries];

const leaguesOf = (entry: WhatsNewEntry): string[] =>
  Array.isArray(entry.leagues) ? entry.leagues : [];

/** navSlug (`afl`) → route prefix (`/afl-fantasy`). */
const PREFIX_BY_NAV_SLUG = new Map<string, string>(
  ALL_LEAGUES.map((l) => [l.navSlug, `/${l.slug}`]),
);
const ALL_PREFIXES = ALL_LEAGUES.map((l) => `/${l.slug}`);

/** Which league's URL space a path sits in, or null when it is neutral. */
const owningLeague = (href: string): string | null => {
  for (const league of ALL_LEAGUES) {
    if (href === `/${league.slug}` || href.startsWith(`/${league.slug}/`)) return league.navSlug;
  }
  return null;
};

/** The href a reader of `navSlug` actually gets, mirroring the detail page. */
const forLeague = (href: string, navSlug: string): string => {
  let bare = href;
  for (const prefix of ALL_PREFIXES) {
    if (bare === prefix) {
      bare = '/';
      break;
    }
    if (bare.startsWith(`${prefix}/`)) {
      bare = bare.slice(prefix.length);
      break;
    }
  }
  const prefix = PREFIX_BY_NAV_SLUG.get(navSlug) ?? '/theleague';
  return bare === '/' ? prefix : `${prefix}${bare}`;
};

describe('whats-new inline links — every article points at what it is about', () => {
  it('has entries to validate (sanity check)', () => {
    expect(allEntries.length).toBeGreaterThan(0);
  });

  it(`every new-page / new-feature / enhancement since ${LINK_ENFORCEMENT_DATE} links to a page on this site`, () => {
    // Counts PAGE links only. An external link or an /assets/… download is not
    // the reader being sent to the feature, which is what the rule is for.
    const linkless = allEntries
      .filter((e) => requiresInlineLinks(e.category) && e.date >= LINK_ENFORCEMENT_DATE)
      .filter((e) => countSiteLinks(e) === 0)
      .map((e) => `${e.id} (${e.category}, ${e.date})`);
    expect(
      linkless,
      `What's New articles with no inline links to a page on this site. An article announcing ` +
        `a page or a feature exists to send the reader there — weave ` +
        `<a href="/some-page">real anchors</a> into the description prose, league-neutral (no ` +
        `/theleague or /afl-fantasy prefix). The CTA button under the article is not a ` +
        `substitute: it points at ONE place, and the article usually names half a dozen. ` +
        `An https:// link or an /assets/ download does not satisfy this.`,
    ).toEqual([]);
  });

  it('every anchor is closed, so no link can slip past the checks below', () => {
    // The rewriter matches on `href=` and does not need the `</a>`; everything
    // that validates links reads the full `<a>…</a>`. An unclosed anchor is
    // therefore rewritten and shipped without any of the checks in this file
    // ever seeing it.
    const unbalanced: string[] = [];
    for (const entry of allEntries) {
      const opened = countAnchorOpenTags(entry.description);
      const closed = extractDescriptionLinks(entry.description).length;
      if (opened !== closed) {
        unbalanced.push(`${entry.id}: ${opened} <a href=…> but ${closed} closed with </a>`);
      }
    }
    expect(
      unbalanced,
      `Unclosed <a> in an article body. The renderer would league-prefix its href and every ` +
        `guard in this file would skip it — a link pointing at the wrong league with nothing ` +
        `checking. Close the tag.`,
    ).toEqual([]);
  });

  it('every inline href is a root-relative internal path or an absolute external URL', () => {
    const bad: string[] = [];
    for (const entry of allEntries) {
      for (const { href } of extractDescriptionLinks(entry.description)) {
        if (isInternalPath(href)) continue;
        if (/^https?:\/\//i.test(href)) continue;
        if (/^mailto:/i.test(href)) continue;
        bad.push(`${entry.id}: "${href}"`);
      }
    }
    expect(
      bad,
      `Inline hrefs that resolve nowhere useful. Internal links must be root-relative ` +
        `("/standings"); a relative href ("standings") resolves against the article permalink, ` +
        `and a bare "#anchor" jumps within the article.`,
    ).toEqual([]);
  });

  it('every inline link has readable anchor text — never a bare URL', () => {
    const bad: string[] = [];
    for (const entry of allEntries) {
      for (const { href, text } of extractDescriptionLinks(entry.description)) {
        if (!text) bad.push(`${entry.id}: empty anchor text on "${href}"`);
        else if (/^(https?:\/\/|\/)/.test(text)) bad.push(`${entry.id}: anchor text is a URL — "${text}"`);
      }
    }
    expect(
      bad,
      `Anchor text is a place in a sentence, not a button. Write it as a noun phrase that ` +
        `reads mid-prose ("…is on the standings"), never the raw path.`,
    ).toEqual([]);
  });

  it('inline links never point into a league the entry is not visible in', () => {
    const violations: string[] = [];
    for (const entry of allEntries) {
      const leagues = leaguesOf(entry);
      for (const { href } of extractDescriptionLinks(entry.description)) {
        if (!isLeagueScopedPath(href)) continue;
        const owner = owningLeague(href);
        if (!owner) continue;
        const outsiders = leagues.filter((slug) => slug !== owner);
        if (outsiders.length > 0) {
          violations.push(
            `${entry.id}: inline href "${href}" belongs to ${owner} but the entry also runs in: ${outsiders.join(', ')}`,
          );
        }
      }
    }
    expect(
      violations,
      `Cross-league inline links. One article body is rendered to every league it is tagged ` +
        `for, so a prefixed href sends the other league's readers off their own site. Write ` +
        `inline hrefs league-neutral ("/standings") — the detail page prefixes them per reader.`,
    ).toEqual([]);
  });

  it('every inline link resolves to a real route in every league the entry runs in', () => {
    const dead: string[] = [];
    for (const entry of allEntries) {
      const leagues = leaguesOf(entry);
      for (const { href } of extractDescriptionLinks(entry.description)) {
        if (!isLeagueScopedPath(href)) continue;
        for (const navSlug of leagues) {
          const resolved = forLeague(href, navSlug);
          if (!astroRouteExists(resolved)) {
            dead.push(`${entry.id}: "${href}" → ${resolved} (no route; entry runs in ${navSlug})`);
          }
        }
      }
    }
    expect(
      dead,
      `Dead inline links. A page one league has and another does not (keepers, contracts) ` +
        `cannot be linked from a both-league article — name it without a link there, or split ` +
        `the entry.`,
    ).toEqual([]);
  });

  it('every inline link to a raw file resolves to something in public/', () => {
    const missing: string[] = [];
    for (const entry of allEntries) {
      for (const { href } of extractDescriptionLinks(entry.description)) {
        if (!isInternalPath(href) || isLeagueScopedPath(href)) continue;
        const [pathOnly] = href.split(/[?#]/);
        if (pathOnly.startsWith('/api/')) continue; // an endpoint, not a file on disk
        if (!existsSync(resolve(__dirname, '../public', pathOnly.replace(/^\//, '')))) {
          missing.push(`${entry.id}: "${href}" is not in public/`);
        }
      }
    }
    expect(
      missing,
      `Inline links to files that are not there. These paths are served from public/ at the ` +
        `root and are deliberately NOT league-prefixed, so a typo just 404s silently.`,
    ).toEqual([]);
  });
});

describe('the guards guard themselves', () => {
  it('countAnchorOpenTags sees an anchor that extractDescriptionLinks cannot', () => {
    const unclosed = ['<a href="/standings">the standings and <a href="/players">free agents</a>'];
    expect(countAnchorOpenTags(unclosed)).toBe(2);
    expect(extractDescriptionLinks(unclosed)).toHaveLength(1);
  });

  it('countSiteLinks ignores external URLs and raw files', () => {
    const external = { description: ['<a href="https://espn.com">ESPN</a>'] };
    const asset = { description: ['<a href="/assets/x.webp">the banner</a>'] };
    const page = { description: ['<a href="/standings">the standings</a>'] };
    expect(countSiteLinks(external)).toBe(0);
    expect(countSiteLinks(asset)).toBe(0);
    expect(countSiteLinks(page)).toBe(1);
  });
});

describe('rewriteDescriptionLinks — the render-time half', () => {
  const asAfl = (path: string) => forLeague(path, 'afl');

  it('prefixes a league-neutral href for the reader', () => {
    expect(rewriteDescriptionLinks('<p>see <a href="/standings">the standings</a></p>', asAfl)).toBe(
      '<p>see <a href="/afl-fantasy/standings">the standings</a></p>',
    );
  });

  it('keeps a query string and hash attached to the resolved path', () => {
    expect(rewriteDescriptionLinks('<a href="/rosters?view=coach#top">x</a>', asAfl)).toBe(
      '<a href="/afl-fantasy/rosters?view=coach#top">x</a>',
    );
  });

  it('leaves external URLs, mailto and bare anchors alone', () => {
    const html = '<a href="https://myfantasyleague.com">MFL</a> <a href="#top">up</a>';
    expect(rewriteDescriptionLinks(html, asAfl)).toBe(html);
  });

  it('rewrites every link in a block, not just the first', () => {
    expect(
      rewriteDescriptionLinks('<a href="/standings">a</a> and <a href="/playoffs">b</a>', asAfl),
    ).toBe('<a href="/afl-fantasy/standings">a</a> and <a href="/afl-fantasy/playoffs">b</a>');
  });

  it('survives other attributes on the anchor and single quotes', () => {
    expect(rewriteDescriptionLinks(`<a class="x" href='/mvp' rel="noopener">m</a>`, asAfl)).toBe(
      `<a class="x" href='/afl-fantasy/mvp' rel="noopener">m</a>`,
    );
  });

  it('never prefixes a public/ asset or an API path', () => {
    const html =
      '<a href="/assets/theleague/history/psd/x.jpg">banner</a> <a href="/api/cr">endpoint</a>';
    expect(rewriteDescriptionLinks(html, asAfl)).toBe(html);
  });

  it('re-points an already-prefixed href at the reader rather than leaving it', () => {
    // Belt and braces for the render path: the test above rejects these in the
    // JSON, but if one lands anyway the reader still stays in their own league.
    expect(rewriteDescriptionLinks('<a href="/theleague/standings">s</a>', asAfl)).toBe(
      '<a href="/afl-fantasy/standings">s</a>',
    );
  });
});
