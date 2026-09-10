import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import guidesFile from '../src/data/guides.json';
import type { GuideEntry } from '../src/types/guides';
import { VALID_LEAGUE_SLUGS } from '../src/types/whats-new';
import { ALL_LEAGUES } from '../src/config/leagues';
import {
  countAnchorOpenTags,
  extractDescriptionHrefs,
  extractDescriptionLinks,
  isInternalPath,
  isLeagueScopedPath,
} from '../src/utils/whats-new-links';
import { describeSpriteIconValidation } from './helpers/sprite-icons';
import { astroRouteExists } from './helpers/astro-routes';

/**
 * Guides are the depth behind the weekly changelog: the Monday article gives
 * one line per change and a link, and THIS is what the link opens. A guide
 * with a dead link, a missing screenshot or a bad league tag therefore breaks
 * the only path a reader has to the detail — so the same guards What's New
 * articles carry apply here, for the same reasons.
 *
 * The link rules in particular are not a style preference. Hrefs are stored
 * LEAGUE-NEUTRAL (`/standings`) and re-pointed per reader at render time by
 * `rewriteDescriptionLinks`; a prefixed href in the data sends half the
 * audience into the other league's site, and an href to a page only one league
 * has 404s for the other.
 */

const guides = guidesFile as GuideEntry[];
const GUIDE_ASSETS_DIR = resolve(__dirname, '../public/assets/guides');

/** navSlug (`afl`) → route prefix (`/afl-fantasy`). */
const PREFIX_BY_NAV_SLUG = new Map<string, string>(
  ALL_LEAGUES.map((l) => [l.navSlug, `/${l.slug}`]),
);

const leaguesOf = (guide: GuideEntry): string[] =>
  Array.isArray(guide.leagues) ? guide.leagues : [];

/** Body blocks in the shape the link helpers expect (they read `description`). */
const asDescription = (guide: GuideEntry) => ({ description: guide.body ?? [] });

describe('guides.json data integrity', () => {
  it('every guide has a unique slug', () => {
    const seen = new Set<string>();
    const dupes = guides
      .map((g) => g.slug)
      .filter((slug) => (seen.has(slug) ? true : (seen.add(slug), false)));
    expect(dupes, 'Two guides cannot share a /guides/<slug> permalink').toEqual([]);
  });

  it('every guide has a slug, title, summary and body', () => {
    const problems: string[] = [];
    for (const guide of guides) {
      const label = guide.slug ?? '(no slug)';
      if (!guide.slug || !/^[a-z0-9-]+$/.test(guide.slug)) {
        problems.push(`${label}: slug must be kebab-case`);
      }
      if (!guide.title) problems.push(`${label}: missing title`);
      if (!guide.summary) problems.push(`${label}: missing summary`);
      if (!Array.isArray(guide.body) || guide.body.length === 0) {
        problems.push(`${label}: body is empty — a guide with nothing in it is worse than none`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every guide has a valid "updated" date', () => {
    const bad = guides
      .filter((g) => !/^\d{4}-\d{2}-\d{2}$/.test(String(g.updated)))
      .map((g) => `${g.slug}: ${JSON.stringify(g.updated)}`);
    expect(bad, 'Guides show "Updated <date>" — want YYYY-MM-DD').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// League scoping — fails closed, exactly like What's New
// ---------------------------------------------------------------------------

describe('guides.json league scoping', () => {
  it('every guide has a non-empty leagues array', () => {
    const untagged = guides.filter((g) => leaguesOf(g).length === 0).map((g) => g.slug);
    expect(
      untagged,
      `guideAppliesToLeague() fails closed: an untagged guide is shown in NO league. ` +
        `That is the safe direction, but it is still a guide nobody can read.`,
    ).toEqual([]);
  });

  it(`every leagues value is a valid slug (${VALID_LEAGUE_SLUGS.join(' | ')})`, () => {
    const bad: string[] = [];
    for (const guide of guides) {
      for (const league of leaguesOf(guide)) {
        if (!(VALID_LEAGUE_SLUGS as readonly string[]).includes(league)) {
          bad.push(`${guide.slug}: ${JSON.stringify(league)}`);
        }
      }
    }
    expect(bad, 'Use the registry navSlug — "afl", never "afl-fantasy".').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Links — the reader's only route from the changelog to the detail
// ---------------------------------------------------------------------------

describe('guides.json links', () => {
  it('every anchor is closed, so no link can slip past the checks below', () => {
    const unclosed = guides
      .map((g) => ({
        slug: g.slug,
        open: countAnchorOpenTags(asDescription(g).description),
        closed: extractDescriptionHrefs(asDescription(g).description).length,
      }))
      .filter((r) => r.open !== r.closed)
      .map((r) => `${r.slug}: ${r.open} <a> open, ${r.closed} closed`);
    expect(
      unclosed,
      `An unclosed <a> is still league-prefixed by the renderer but invisible to every ` +
        `guard here — the one link that ships pointing at the wrong league.`,
    ).toEqual([]);
  });

  it('every inline href is a root-relative internal path or an absolute external URL', () => {
    const bad: string[] = [];
    for (const guide of guides) {
      for (const href of extractDescriptionHrefs(asDescription(guide).description)) {
        const ok = isInternalPath(href) || /^(https?:|mailto:|#)/.test(href);
        if (!ok) bad.push(`${guide.slug}: ${href}`);
      }
    }
    expect(bad, 'Relative hrefs resolve against whatever page they are read on.').toEqual([]);
  });

  it('every inline link has readable anchor text — never a bare URL', () => {
    const bad: string[] = [];
    for (const guide of guides) {
      for (const { href, text } of extractDescriptionLinks(asDescription(guide).description)) {
        if (!text || /^https?:\/\//.test(text) || text.startsWith('/')) {
          bad.push(`${guide.slug}: "${text}" -> ${href}`);
        }
      }
    }
    expect(
      bad,
      'Link the noun phrase already in the sentence, not the URL and not "click here".',
    ).toEqual([]);
  });

  it('every inline link resolves to a real route in every league the guide runs in', () => {
    const broken: string[] = [];
    for (const guide of guides) {
      const hrefs = extractDescriptionHrefs(asDescription(guide).description).filter(
        isLeagueScopedPath,
      );
      for (const href of hrefs) {
        for (const league of leaguesOf(guide)) {
          const prefix = PREFIX_BY_NAV_SLUG.get(league);
          if (!prefix) continue;
          if (!astroRouteExists(`${prefix}${href}`)) {
            broken.push(`${guide.slug}: ${href} 404s for ${league}`);
          }
        }
      }
    }
    expect(
      broken,
      `Only link a page EVERY tagged league has. /contracts and /salary are TheLeague-only, ` +
        `/keepers and /records AFL-only — name those without a link.`,
    ).toEqual([]);
  });

  it('every featurePath resolves in every league the guide runs in', () => {
    const broken: string[] = [];
    for (const guide of guides.filter((g) => g.featurePath)) {
      const href = String(guide.featurePath);
      if (!isInternalPath(href)) {
        broken.push(`${guide.slug}: featurePath "${href}" must be a root-relative path`);
        continue;
      }
      for (const league of leaguesOf(guide)) {
        const prefix = PREFIX_BY_NAV_SLUG.get(league);
        if (!prefix) continue;
        if (!astroRouteExists(`${prefix}${href}`)) {
          broken.push(`${guide.slug}: featurePath ${href} 404s for ${league}`);
        }
      }
    }
    expect(
      broken,
      'The "Open it" button is the whole point of the page — it cannot 404.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

describe('guides.json screenshots', () => {
  it('every inline image exists in public/assets/guides/', () => {
    const missing: string[] = [];
    for (const guide of guides) {
      for (const block of guide.body ?? []) {
        if (typeof block === 'object' && (block as { type?: string }).type === 'image') {
          const image = block as { src: string; alt?: string };
          if (!existsSync(resolve(GUIDE_ASSETS_DIR, image.src))) {
            missing.push(`${guide.slug} -> ${image.src}`);
          }
        }
      }
    }
    expect(
      missing,
      `Guide screenshots live in public/assets/guides/, NOT the changelog's ` +
        `public/assets/whats-new/ — a guide outlives the week it was announced in.`,
    ).toEqual([]);
  });

  it('every inline image has alt text', () => {
    const missing: string[] = [];
    for (const guide of guides) {
      for (const block of guide.body ?? []) {
        if (typeof block === 'object' && (block as { type?: string }).type === 'image') {
          const image = block as { src: string; alt?: string };
          if (!image.alt) missing.push(`${guide.slug} -> ${image.src}`);
        }
      }
    }
    expect(missing, 'A screenshot with no alt text is invisible to half the readers.').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Icons — same trap as whats-new.json: a double-prefixed value renders nothing
// ---------------------------------------------------------------------------

describeSpriteIconValidation(
  'guides.json',
  guides.map((g) => ({ source: g.slug, icon: g.icon })),
);
