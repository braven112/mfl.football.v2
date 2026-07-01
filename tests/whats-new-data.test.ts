import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { WhatsNewEntry } from '../src/types/whats-new';
import { VALID_LEAGUE_SLUGS } from '../src/types/whats-new';
import entries from '../src/data/whats-new.json';
import stagingFile from '../src/data/weekly-changelog-staging.json';

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
// League scoping — content separation between The League and the AFL
// ---------------------------------------------------------------------------
//
// Every entry MUST be explicitly tagged with the league(s) it applies to.
// entryAppliesToLeague() fails closed (untagged = shown nowhere), so a
// missing or misspelled `leagues` value can never leak content across
// leagues — but it WOULD silently hide the entry, which is why these tests
// block the build instead.

/**
 * Entries dated after this date must not mention the other league in their
 * title/summary (the text shown in the hero banner and listing cards).
 * Older entries are grandfathered in.
 */
const CROSS_LEAGUE_TEXT_ENFORCEMENT_DATE = '2026-06-30';

describe('whats-new.json league scoping', () => {
  it('every entry has a non-empty leagues array', () => {
    const untagged = typedEntries.filter(
      (e) => !Array.isArray(e.leagues) || e.leagues.length === 0,
    );
    expect(
      untagged.map((e) => e.id),
      `Entries missing the required "leagues" field: ${untagged.map((e) => e.id).join(', ')}. ` +
        `Tag each entry with ["theleague"], ["afl"], or both. Untagged entries are shown NOWHERE.`,
    ).toEqual([]);
  });

  it('every leagues value is a valid slug (theleague | afl)', () => {
    const invalid = typedEntries.flatMap((e) =>
      (e.leagues ?? [])
        .filter((slug) => !VALID_LEAGUE_SLUGS.includes(slug))
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
      const leagues = entry.leagues ?? [];
      if (entry.link.startsWith('/afl-fantasy') && leagues.includes('theleague')) {
        violations.push(`${entry.id}: link "${entry.link}" is AFL but entry is visible on The League`);
      }
      if (entry.link.startsWith('/theleague') && leagues.includes('afl')) {
        violations.push(`${entry.id}: link "${entry.link}" is The League but entry is visible on the AFL`);
      }
    }
    expect(
      violations,
      `Cross-league links found. An entry shown in a league must not send users to the other ` +
        `league's pages. Both-league entries must use a league-neutral link or omit the link.`,
    ).toEqual([]);
  });

  it('title/summary never name the other league (entries after enforcement date)', () => {
    const violations: string[] = [];
    for (const entry of typedEntries) {
      if (entry.date <= CROSS_LEAGUE_TEXT_ENFORCEMENT_DATE) continue;
      const text = `${entry.title} ${entry.summary}`;
      const leagues = entry.leagues ?? [];
      if (/\bAFL\b/.test(text) && leagues.includes('theleague') && !leagues.includes('afl')) {
        violations.push(`${entry.id}: title/summary mentions "AFL" but entry is The League-only`);
      }
      if (/\bThe ?League\b/.test(text) && leagues.includes('afl') && !leagues.includes('theleague')) {
        violations.push(`${entry.id}: title/summary mentions "The League" but entry is AFL-only`);
      }
    }
    expect(
      violations,
      `Hero/card copy names the other league — this is the exact "AFL feature in The League's ` +
        `hero" bug. Fix the leagues tag or reword the copy.`,
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

const VALID_STAGING_LEAGUES = ['theleague', 'afl', 'both'];

describe('weekly-changelog-staging.json league scoping', () => {
  interface StagingChange {
    date: string;
    type: string;
    summary: string;
    impact: string;
    area: string;
    league?: string;
  }
  const changes = (stagingFile as { changes: StagingChange[] }).changes ?? [];

  it('every staged change declares a league (theleague | afl | both)', () => {
    const missing = changes
      .filter((c) => !c.league || !VALID_STAGING_LEAGUES.includes(c.league))
      .map((c) => `"${c.summary.slice(0, 60)}..." (league: ${JSON.stringify(c.league)})`);
    expect(
      missing,
      `Staged changelog entries missing a valid "league" field: ${missing.join('; ')}. ` +
        `The weekly rollup routes each change to the matching league's What's New — ` +
        `an untagged change would fail the Monday rollup job.`,
    ).toEqual([]);
  });
});
