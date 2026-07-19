import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { WhatsNewEntry } from '../src/types/whats-new';
import { VALID_LEAGUE_SLUGS } from '../src/types/whats-new';
import { ALL_LEAGUES } from '../src/config/leagues';
import entries from '../src/data/whats-new.json';
import stagingFile from '../src/data/weekly-changelog-staging.json';
import { describeSpriteIconValidation } from './helpers/sprite-icons';

/**
 * What's New Data Validation
 *
 * Ensures whats-new.json entries follow required conventions.
 * Screenshot images are required for new-page, new-feature, and enhancement
 * entries added after the enforcement date below.
 */

/** Categories that require a screenshot */
const SCREENSHOT_REQUIRED_CATEGORIES = ['new-page', 'new-feature', 'enhancement'];

/**
 * Entries dated after this date MUST include image + imageAlt.
 * Older entries are grandfathered in.
 */
const SCREENSHOT_ENFORCEMENT_DATE = '2026-02-28';

const WHATS_NEW_ASSETS_DIR = resolve(__dirname, '../public/assets/whats-new');

const typedEntries = entries as WhatsNewEntry[];

// ---------------------------------------------------------------------------
// Screenshot requirement
// ---------------------------------------------------------------------------

describe('whats-new.json screenshot requirements', () => {
  const enforceableEntries = typedEntries.filter(
    (e) =>
      SCREENSHOT_REQUIRED_CATEGORIES.includes(e.category) &&
      e.date > SCREENSHOT_ENFORCEMENT_DATE,
  );

  it('has entries to validate (sanity check)', () => {
    // This test will start passing once new entries are added after the
    // enforcement date. Until then it just confirms the filter works.
    expect(typedEntries.length).toBeGreaterThan(0);
  });

  for (const entry of enforceableEntries) {
    describe(`[${entry.category}] ${entry.id}`, () => {
      it('has an image field', () => {
        expect(
          entry.image,
          `Entry "${entry.id}" (${entry.category}, ${entry.date}) is missing a required "image" field. ` +
            `All ${SCREENSHOT_REQUIRED_CATEGORIES.join('/')} entries after ${SCREENSHOT_ENFORCEMENT_DATE} must include a screenshot.`,
        ).toBeTruthy();
      });

      it('has an imageAlt field', () => {
        expect(
          entry.imageAlt,
          `Entry "${entry.id}" is missing a required "imageAlt" field. ` +
            `Provide descriptive alt text for the screenshot.`,
        ).toBeTruthy();
      });

      it('image file exists in public/assets/whats-new/', () => {
        if (!entry.image) return; // skip if image is missing (caught above)
        const imagePath = resolve(WHATS_NEW_ASSETS_DIR, entry.image);
        expect(
          existsSync(imagePath),
          `Screenshot file not found: public/assets/whats-new/${entry.image}. ` +
            `Add the screenshot image before publishing.`,
        ).toBe(true);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// General data integrity
// ---------------------------------------------------------------------------

describe('whats-new.json data integrity', () => {
  it('all entries have unique IDs', () => {
    const ids = typedEntries.map((e) => e.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `Duplicate IDs found: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('all entries have valid dates', () => {
    for (const entry of typedEntries) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(entry.date).toString()).not.toBe('Invalid Date');
    }
  });

  it('all entries with image also have imageAlt', () => {
    const missingAlt = typedEntries.filter((e) => e.image && !e.imageAlt);
    expect(
      missingAlt.map((e) => e.id),
      `Entries with image but missing imageAlt: ${missingAlt.map((e) => e.id).join(', ')}`,
    ).toEqual([]);
  });

  it('all image files referenced actually exist', () => {
    const missing = typedEntries
      .filter((e) => e.image)
      .filter((e) => !existsSync(resolve(WHATS_NEW_ASSETS_DIR, e.image!)));
    expect(
      missing.map((e) => `${e.id} -> ${e.image}`),
      `Missing image files`,
    ).toEqual([]);
  });

  it('heroPlayerId, when set, is a plausible MFL id (digits only)', () => {
    // The featured-player cast resolves the id against the player map at
    // render time; a malformed id silently falls back to the screenshot, so
    // catch obvious typos (names, empty strings) at build time instead.
    const bad = typedEntries.filter(
      (e) => e.heroPlayerId !== undefined && !/^\d+$/.test(e.heroPlayerId),
    );
    expect(
      bad.map((e) => `${e.id} -> ${JSON.stringify(e.heroPlayerId)}`),
      'Entries with malformed heroPlayerId',
    ).toEqual([]);
  });

  // The capture script's skip-list, extracted from source (same sentinel-grep
  // pattern as the quiet-day GroupMe test — no import, so loading the test
  // never pulls in playwright or runs the script's top-level main()).
  const captureScriptSource = readFileSync(
    resolve(__dirname, '../scripts/capture-whats-new-screenshots.mjs'),
    'utf-8',
  );
  const manualOnlyBlock = captureScriptSource.match(
    /const MANUAL_CAPTURE_ONLY = \{([\s\S]*?)\n\};/,
  );
  const manualOnlyIds = [...(manualOnlyBlock?.[1] ?? '').matchAll(/'([^']+)':/g)].map(
    (m) => m[1],
  );

  it('capture-script MANUAL_CAPTURE_ONLY ids all match real entries', () => {
    // A renamed entry id silently drops its skip-list protection, and the
    // next plain capture run replaces a hand-staged screenshot with a
    // sign-in page or dev empty state (the 2026-07-06 backfill incident).
    expect(manualOnlyIds.length).toBeGreaterThan(0);
    const known = new Set(typedEntries.map((e) => e.id));
    const orphaned = manualOnlyIds.filter((id) => !known.has(id));
    expect(orphaned, 'MANUAL_CAPTURE_ONLY ids with no matching entry').toEqual([]);
  });

  it('every auto-captured screenshot entry has its dark-mode twin on disk', () => {
    // The composite hero swaps foo.webp / foo-dark.webp under html.dark. A
    // missing dark file falls back gracefully at runtime, but for entries the
    // capture script owns it just means someone forgot to run it — catch that
    // at build time. MANUAL_CAPTURE_ONLY entries are exempt (their dark
    // captures require an authenticated/prod session and may lag).
    const missing = typedEntries
      .filter((e) => SCREENSHOT_REQUIRED_CATEGORIES.includes(e.category) && e.image)
      .filter((e) => !manualOnlyIds.includes(e.id))
      .filter(
        (e) =>
          !existsSync(
            resolve(WHATS_NEW_ASSETS_DIR, e.image!.replace(/\.(\w+)$/, '-dark.$1')),
          ),
      );
    expect(
      missing.map((e) => `${e.id} -> ${e.image}`),
      'Entries missing the -dark screenshot twin',
    ).toEqual([]);
  });

  it('all heroArt.src files referenced actually exist', () => {
    // heroArt.src is an absolute public path (e.g. /assets/theleague/history/x.png).
    // A typo ships a blank hero flank (the component hides the broken img), so
    // validate the file at build time like screenshot images.
    const missing = typedEntries
      .filter((e) => e.heroArt?.src)
      .filter((e) => !existsSync(resolve(__dirname, '../public', e.heroArt!.src.replace(/^\//, ''))));
    expect(
      missing.map((e) => `${e.id} -> ${e.heroArt!.src}`),
      `Missing heroArt files`,
    ).toEqual([]);
  });

  it('all inline description images exist', () => {
    const missing: string[] = [];
    for (const entry of typedEntries) {
      for (const block of entry.description) {
        if (typeof block === 'object' && block.type === 'image') {
          const imgPath = resolve(WHATS_NEW_ASSETS_DIR, block.src);
          if (!existsSync(imgPath)) {
            missing.push(`${entry.id} -> ${block.src}`);
          }
        }
      }
    }
    expect(missing, 'Missing inline description images').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sprite icon validation
// ---------------------------------------------------------------------------
//
// Consumers render `<use href="${sprite}#icon-${entry.icon}">`, so the stored
// value must be the bare glyph name. A double-prefixed value ("icon-eye")
// resolves to #icon-icon-eye — which doesn't exist — and silently rendered an
// empty hero eyebrow chip when the dark-mode entry shipped that way.

describeSpriteIconValidation(
  'whats-new.json',
  typedEntries.map((e) => ({ source: e.id, icon: e.icon })),
);

// ---------------------------------------------------------------------------
// League scoping — content separation between The League and the AFL
// ---------------------------------------------------------------------------
//
// Every entry MUST be explicitly tagged with the league(s) it applies to.
// entryAppliesToLeague() fails closed (untagged = shown nowhere), so a
// missing or misspelled `leagues` value can never leak content across
// leagues — but it WOULD silently hide the entry, which is why these tests
// block the build instead.

/**
 * Historical entries exempt from the cross-league copy rule, by id. An
 * explicit allowlist (not a date cutoff) so backdated or edited entries can't
 * silently escape the check. Do NOT add new entries here — fix the tag or
 * reword the copy instead.
 */
const CROSS_LEAGUE_TEXT_GRANDFATHERED_IDS = new Set(['weekly-rollup-2025-12-08']);

/**
 * Text patterns that name each league in hero/card copy. Keys must cover
 * every registry league — the coverage test below fails when a new league
 * is added without a pattern, so the tripwire can't silently go partial.
 */
const LEAGUE_TEXT_PATTERNS: Record<string, RegExp> = {
  afl: /\bafl\b|afl-fantasy/i,
  theleague: /\bThe ?League\b|\btheleague\b/,
  bb1: /\bbest[- ]ball\b|best-ball-1|\bbb1\b/i,
};

/** JSON-cast data may be malformed — coerce so tests fail with assertions, not TypeErrors. */
function leaguesOf(entry: WhatsNewEntry): string[] {
  return Array.isArray(entry.leagues) ? entry.leagues : [];
}

describe('whats-new.json league scoping', () => {
  it('every registry league has a copy-tripwire text pattern', () => {
    const missing = VALID_LEAGUE_SLUGS.filter((slug) => !LEAGUE_TEXT_PATTERNS[slug]);
    expect(
      missing,
      `Leagues without a LEAGUE_TEXT_PATTERNS entry — the cross-league copy check would ` +
        `silently skip them. Add a pattern for each new league.`,
    ).toEqual([]);
  });

  it('every entry has a non-empty leagues array', () => {
    const untagged = typedEntries.filter((e) => leaguesOf(e).length === 0);
    expect(
      untagged.map((e) => e.id),
      `Entries missing the required "leagues" field. ` +
        `Tag each entry with ["theleague"], ["afl"], or both. Untagged entries are shown NOWHERE.`,
    ).toEqual([]);
  });

  it(`every leagues value is a valid slug (${VALID_LEAGUE_SLUGS.join(' | ')})`, () => {
    const invalid = typedEntries.flatMap((e) =>
      leaguesOf(e)
        .filter((slug) => !VALID_LEAGUE_SLUGS.includes(slug as (typeof VALID_LEAGUE_SLUGS)[number]))
        .map((slug) => `${e.id} -> "${slug}"`),
    );
    expect(
      invalid,
      `Invalid league slugs found (valid: ${VALID_LEAGUE_SLUGS.join(', ')}). ` +
        `A misspelled slug (e.g. "afl-fantasy") silently hides the entry from every league.`,
    ).toEqual([]);
  });

  it('entry links never point into a league the entry is not visible in', () => {
    const violations: string[] = [];
    for (const entry of typedEntries) {
      if (!entry.link) continue;
      const leagues = leaguesOf(entry);
      // For every league in the registry: a link into that league's URL space
      // is only allowed when the entry is visible in EXACTLY that league.
      for (const league of ALL_LEAGUES) {
        const ownsLink =
          entry.link === `/${league.slug}` || entry.link.startsWith(`/${league.slug}/`);
        if (!ownsLink) continue;
        const outsiders = leagues.filter((slug) => slug !== league.navSlug);
        if (outsiders.length > 0) {
          violations.push(
            `${entry.id}: link "${entry.link}" belongs to ${league.navSlug} but entry is also visible in: ${outsiders.join(', ')}`,
          );
        }
      }
    }
    expect(
      violations,
      `Cross-league links found. An entry shown in a league must not send users to another ` +
        `league's pages. Both-league entries must use a league-neutral link or omit the link.`,
    ).toEqual([]);
  });

  it('title/summary never name a league the entry does not belong to (hero/card copy)', () => {
    const violations: string[] = [];
    for (const entry of typedEntries) {
      if (CROSS_LEAGUE_TEXT_GRANDFATHERED_IDS.has(entry.id)) continue;
      const text = `${entry.title} ${entry.summary}`;
      const leagues = leaguesOf(entry);
      // If the copy names league X, the entry must be visible ONLY in league X.
      // This intentionally also blocks both-league entries whose copy names a
      // league: tagging an AFL-titled entry with both leagues would otherwise
      // re-enable the original "AFL feature in The League's hero" leak.
      for (const [named, pattern] of Object.entries(LEAGUE_TEXT_PATTERNS)) {
        if (!pattern.test(text)) continue;
        const outsiders = leagues.filter((slug) => slug !== named);
        if (outsiders.length > 0) {
          violations.push(
            `${entry.id}: title/summary names "${named}" but entry is visible in: ${leagues.join(', ')}`,
          );
        }
      }
    }
    expect(
      violations,
      `Hero/card copy names a league the entry isn't exclusive to — this is the exact "AFL ` +
        `feature in The League's hero" bug. Fix the leagues tag, reword the copy, or split ` +
        `the announcement into per-league entries.`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Weekly changelog staging — league scoping at the source
// ---------------------------------------------------------------------------
//
// The Monday rollup (scripts/weekly-changelog-rollup.mjs) generates one
// What's New entry PER LEAGUE from the staging file, so every staged change
// must declare which league it belongs to. Catching a missing league here
// (at PR time) beats the cron job failing on Monday night.

// Derived from the same registry-backed list the display code uses, so the
// PR-time gate and the Monday cron can never validate different vocabularies.
const VALID_STAGING_LEAGUES = [...VALID_LEAGUE_SLUGS, 'both'];

describe('weekly-changelog-staging.json league scoping', () => {
  interface StagingChange {
    date: string;
    type: string;
    summary: string;
    impact: string;
    area: string;
    league?: string;
  }
  interface StagingFile {
    changes?: StagingChange[];
    featuredImage?: string;
    featuredImageLeague?: string;
  }
  const staging = stagingFile as StagingFile;
  const changes = Array.isArray(staging.changes) ? staging.changes : [];

  it('has a changes array', () => {
    expect(Array.isArray(staging.changes), 'staging "changes" must be an array').toBe(true);
  });

  it(`every staged change declares a league (${VALID_STAGING_LEAGUES.join(' | ')})`, () => {
    const missing = changes
      .filter((c) => !c.league || !VALID_STAGING_LEAGUES.includes(c.league))
      .map(
        (c) =>
          `"${String(c.summary ?? '(no summary)').slice(0, 60)}..." (league: ${JSON.stringify(c.league)})`,
      );
    expect(
      missing,
      `Staged changelog entries missing a valid "league" field. ` +
        `The weekly rollup routes each change to the matching league's What's New — ` +
        `an untagged change would fail the Monday rollup job.`,
    ).toEqual([]);
  });

  it('every staged change has a summary', () => {
    const missing = changes.filter((c) => !c.summary || typeof c.summary !== 'string');
    expect(
      missing.map((c) => JSON.stringify(c).slice(0, 80)),
      'Staged changes must include a user-facing "summary".',
    ).toEqual([]);
  });

  it('featuredImage (when set) declares which league the screenshot belongs to', () => {
    if (!staging.featuredImage) return;
    expect(
      staging.featuredImageLeague,
      `staging "featuredImage" is set, so "featuredImageLeague" must name the league the ` +
        `screenshot depicts (${VALID_LEAGUE_SLUGS.join(' | ')}) — otherwise one league's ` +
        `screenshot could ship on the other league's What's New entry.`,
    ).toBeTruthy();
    expect(VALID_LEAGUE_SLUGS as readonly string[]).toContain(staging.featuredImageLeague!);
  });
});
