import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import type { WhatsNewEntry } from '../src/types/whats-new';
import { VALID_LEAGUE_SLUGS } from '../src/types/whats-new';
import { ALL_LEAGUES } from '../src/config/leagues';
import entries from '../src/data/whats-new.json';
import stagingFile from '../src/data/weekly-changelog-staging.json';
import { describeSpriteIconValidation } from './helpers/sprite-icons';
import { astroRouteExists } from './helpers/astro-routes';
import { stripTags } from '../src/utils/whats-new-links';
import { WHATS_NEW_ACTIVE_MAX } from '../scripts/lib/retention-policy.mjs';
import {
  AREA_LABELS,
  BOTH_TAG,
  leaguesForStagedChange,
} from '../scripts/lib/weekly-changelog-format.mjs';

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

// Validate the FULL history: the active file is capped at
// WHATS_NEW_ACTIVE_MAX (scripts/lib/retention-policy.mjs) and the overflow
// lives in per-year archive files that the archive index and permalink pages
// still render — so every convention here (screenshots on disk, unique ids,
// league tags) applies to archived entries too.
const activeEntries = entries as WhatsNewEntry[];
const ARCHIVE_DIR = resolve(__dirname, '../src/data/whats-new-archive');
const archiveEntries: WhatsNewEntry[] = existsSync(ARCHIVE_DIR)
  ? readdirSync(ARCHIVE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .flatMap((f) => JSON.parse(readFileSync(resolve(ARCHIVE_DIR, f), 'utf-8')))
  : [];
const typedEntries: WhatsNewEntry[] = [...activeEntries, ...archiveEntries];

describe('whats-new.json retention cap', () => {
  /**
   * An entry still inside its hero rotation window, which the cap deliberately
   * retains past WHATS_NEW_ACTIVE_MAX.
   *
   * The hero resolver and the homepage row read whats-new-entries.ts, which
   * imports the ACTIVE file only — so archiving a live promo pulls it off the
   * homepage before its campaign ends. Publishing two entries into a full
   * 40/40 file did that to the AFL's Throwback Week promo (14-day window, six
   * days still to run). The cap bounds the bundle; it does not end campaigns.
   */
  const FEATURE_HERO_DAYS = 7;
  const stillPromoting = (entry: WhatsNewEntry): boolean => {
    if (entry.excludeFromHero === true) return false;
    const at = Date.parse(`${entry.date}T12:00:00Z`);
    if (Number.isNaN(at)) return false;
    const days = (Date.now() - at) / 86_400_000;
    return days >= 0 && days <= (entry.heroRotationDays ?? FEATURE_HERO_DAYS);
  };

  it(`active file stays within WHATS_NEW_ACTIVE_MAX (${WHATS_NEW_ACTIVE_MAX}), plus open hero windows`, () => {
    // The weekly rollup enforces this (and `--cap-only` re-enforces it), so a
    // failure here means an entry was hand-prepended without running the cap —
    // run: node scripts/weekly-changelog-rollup.mjs --cap-only
    const retained = activeEntries.filter(stillPromoting);
    const capped = activeEntries.length - retained.length;
    expect(
      capped,
      `${activeEntries.length} active entries, of which ${retained.length} are held past the ` +
        `cap for an open hero window (${retained.map((e) => e.id).join(', ')}). ` +
        `The rest must fit WHATS_NEW_ACTIVE_MAX.`,
    ).toBeLessThanOrEqual(WHATS_NEW_ACTIVE_MAX);
  });

  it('archive files only ever contain entries older than the newest active entry', () => {
    if (archiveEntries.length === 0) return;
    const oldestActive = activeEntries.at(-1)?.date ?? '';
    const misplaced = archiveEntries.filter((e) => e.date > oldestActive);
    expect(
      misplaced.map((e) => `${e.id} (${e.date})`),
      'Archived entries newer than the active window — the archive is append-only overflow, not a second inbox',
    ).toEqual([]);
  });
});

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

  it('heroAccentWord is never set without heroHeadline', () => {
    // The AFL hero's display line is a PAIR. An accent word bolted onto a
    // title-derived headline reads as a mistake, so resolveFeatureHeadline
    // ignores the orphan and derives both halves — which means the authored
    // copy silently never renders. Catch the typo here instead.
    // `.trim()` on both sides, because resolveFeatureHeadline trims: a
    // whitespace-only heroHeadline is treated as ABSENT there, so it would
    // slip past a bare truthiness check while still dropping the accent.
    const orphans = typedEntries.filter(
      (e) => e.heroAccentWord?.trim() && !e.heroHeadline?.trim(),
    );
    expect(
      orphans.map((e) => e.id),
      'Entries with heroAccentWord but no heroHeadline (the accent word is ignored)',
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

  it('a hero-eligible entry always has the art the hero renders', () => {
    // The composite hero renders the entry's screenshot. An entry that is
    // hero-eligible with no image puts a blank frame on the homepage — which
    // the weekly rollup could produce, because `heroWorthy` is a per-change
    // flag while the image only ever arrives via a `featured` change, and a
    // fixes-only week is not required to have one.
    const artless = typedEntries
      .filter((e) => e.excludeFromHero !== true)
      .filter((e) => !e.image && !e.heroArt && !e.heroPlayerId)
      .map((e) => `${e.id} (${e.category}, ${e.date})`);
    expect(
      artless,
      'Hero-eligible entries need an image, heroArt, or a heroPlayerId to cast.',
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
const VALID_STAGING_LEAGUES = [...VALID_LEAGUE_SLUGS, BOTH_TAG];

describe('weekly-changelog-staging.json league scoping', () => {
  interface StagingChange {
    date: string;
    type: string;
    summary: string;
    impact: string;
    area: string;
    league?: string;
    featured?: boolean;
    image?: string;
    imageAlt?: string;
    headline?: string;
    lede?: string;
    heroWorthy?: boolean;
    guide?: string;
    entryId?: string;
    heroHeadline?: string;
    heroAccentWord?: string;
  }
  interface StagingFile {
    changes?: StagingChange[];
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

  // The rollup groups changes by `area` and prints `AREA_LABELS[area] || area`
  // as a section heading. That fallback means a typo'd slug does NOT fail the
  // Monday job — it ships the raw slug as a heading in the article owners read
  // ("free-agent — ..." instead of "Free Agents — ..."). Imported from the
  // rollup's own module rather than restated here, for the same reason
  // VALID_STAGING_LEAGUES is derived: a second copy of the list is a second
  // thing to forget to update. (This used to regex the script's source,
  // because the script could not be imported without running the rollup —
  // extracting the formatting half made a real import possible.)
  const VALID_AREAS = Object.keys(AREA_LABELS);

  it('imports a non-trivial area vocabulary from the rollup module', () => {
    // Guards the import: an empty or renamed AREA_LABELS would validate every
    // staged change against [] and still report green.
    expect(VALID_AREAS.length).toBeGreaterThan(5);
    expect(VALID_AREAS).toContain('other');
  });

  it('every staged change uses an area the rollup can label', () => {
    const bad = changes
      .filter((c) => !c.area || !VALID_AREAS.includes(c.area))
      .map((c) => `${JSON.stringify(c.area)} — "${String(c.summary ?? '').slice(0, 50)}..."`);
    expect(
      bad,
      `Staged changes must use an area slug defined in AREA_LABELS ` +
        `(scripts/lib/weekly-changelog-format.mjs). Unknown slugs don't fail the rollup — ` +
        `they render raw as a section heading in the published entry. ` +
        `Valid: ${VALID_AREAS.join(' | ')}`,
    ).toEqual([]);
  });

  it('every staged change has a valid date, type, and impact', () => {
    const VALID_TYPES = [
      'new-page',
      'new-feature',
      'enhancement',
      'bug-fix',
      'style-tweak',
    ];
    const VALID_IMPACTS = ['user', 'admin'];
    const problems: string[] = [];
    for (const c of changes) {
      const label = `"${String(c.summary ?? '(no summary)').slice(0, 40)}..."`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? '')) {
        problems.push(`${label} date: ${JSON.stringify(c.date)} (want YYYY-MM-DD)`);
      }
      if (!VALID_TYPES.includes(c.type)) {
        problems.push(`${label} type: ${JSON.stringify(c.type)} (want ${VALID_TYPES.join(' | ')})`);
      }
      if (!VALID_IMPACTS.includes(c.impact)) {
        problems.push(
          `${label} impact: ${JSON.stringify(c.impact)} (want ${VALID_IMPACTS.join(' | ')})`,
        );
      }
    }
    expect(
      problems,
      'Staged changelog entries must carry the fields CLAUDE.md specifies. ' +
        'Since Sept 2026 staging is the default path for ALL user-facing work — ' +
        'only a marquee launch gets its own whats-new.json entry.',
    ).toEqual([]);
  });

  // ── The weekly article's shape ──────────────────────────────────────────
  //
  // The rollup is one scannable list, one line per change, with the depth
  // behind a link. Every guard below protects that shape at PR time rather
  // than at 8pm Monday, because the rollup PUBLISHES AND EMPTIES the queue —
  // a failure there costs the week's changes, a failure here costs a rerun.

  /**
   * How the reader sees a line: markup stripped and entities resolved.
   *
   * Both halves matter. The strip uses the shared `stripTags`, which loops
   * until stable — the single-pass `.replace()` this used to do leaves
   * `<script>` behind on input like `<scr<x>ipt>` and CodeQL flags it as an
   * incomplete multi-character sanitizer, the same finding that hardened the
   * original. And an entity is ONE glyph to the reader but five or six
   * characters here, so counting them raw makes the cap quietly stricter than
   * it claims and pushes authors away from writing `&amp;` at all — a live
   * case, since one shipped line reads "Roster & Salary Cap".
   */
  const ENTITIES: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  };
  const visibleLength = (summary: string): number => {
    let text = stripTags(String(summary ?? ''));
    for (const [entity, glyph] of Object.entries(ENTITIES)) {
      text = text.split(entity).join(glyph);
    }
    text = text.replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)));
    return text.trim().length;
  };

  /**
   * One line means one line. Staged summaries used to be 250-430 character
   * paragraphs, which the old rollup concatenated into a wall of prose nobody
   * read — the reason this format exists. Detail belongs in a /guides page or
   * in the marquee article, both of which the line can link to.
   */
  const MAX_SUMMARY_LENGTH = 200;

  it(`every staged summary reads as one line (<= ${MAX_SUMMARY_LENGTH} visible chars)`, () => {
    const tooLong = changes
      .filter((c) => visibleLength(c.summary) > MAX_SUMMARY_LENGTH)
      .map((c) => `${visibleLength(c.summary)} chars — "${String(c.summary).slice(0, 60)}..."`);
    expect(
      tooLong,
      `The weekly article renders one bullet per staged change. Anything longer than ` +
        `${MAX_SUMMARY_LENGTH} characters is an article, not a bullet — write the line, ` +
        `then put the detail in a /guides page and point the change's "guide" field at it.`,
    ).toEqual([]);
  });

  const FEATURE_TYPES = ['new-page', 'new-feature', 'enhancement'];

  /**
   * Which league articles a staged change lands in.
   *
   * The rollup's own helper, imported rather than restated: a second copy of
   * this answer is what let `both` mean "every league in the registry" here
   * while the reader saw something else on the site.
   */
  const leaguesFor = (change: StagingChange): string[] =>
    leaguesForStagedChange(change);

  it('at most one staged change per league is flagged "featured"', () => {
    const byLeague = new Map<string, StagingChange[]>();
    for (const change of changes.filter((c) => c.featured === true)) {
      for (const league of leaguesFor(change)) {
        byLeague.set(league, [...(byLeague.get(league) ?? []), change]);
      }
    }
    const clashes = [...byLeague.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([league, list]) => `${league}: ${list.length} featured changes`);
    expect(
      clashes,
      `Exactly one change per league supplies the week's headline, lede and screenshot. ` +
        `More than one and the rollup exits 1 on Monday night without publishing.`,
    ).toEqual([]);
  });

  it('a week that ships a feature flags one change as "featured"', () => {
    const missing: string[] = [];
    for (const league of VALID_LEAGUE_SLUGS) {
      const forLeague = changes.filter((c) => leaguesFor(c).includes(league));
      const hasFeature = forLeague.some((c) => FEATURE_TYPES.includes(c.type));
      const hasFeatured = forLeague.some((c) => c.featured === true);
      if (hasFeature && !hasFeatured) missing.push(league);
    }
    expect(
      missing,
      `A week with a new page or feature needs a "featured": true change to supply the ` +
        `article's headline, lede and top screenshot. A fixes-only week does not.`,
    ).toEqual([]);
  });

  it('every featured change carries a headline, a lede and a screenshot', () => {
    const problems: string[] = [];
    for (const change of changes.filter((c) => c.featured === true)) {
      const label = `"${String(change.summary ?? '').slice(0, 40)}..."`;
      if (!change.headline) problems.push(`${label} is missing "headline" (the article title)`);
      if (!change.lede) problems.push(`${label} is missing "lede" (the card/hero summary)`);
      if (!change.image) problems.push(`${label} is missing "image" (the week's screenshot)`);
      if (change.image && !change.imageAlt) problems.push(`${label} has "image" but no "imageAlt"`);
    }
    expect(problems, 'The featured change IS the article\'s face.').toEqual([]);
  });

  it('every featured screenshot exists in public/assets/whats-new/', () => {
    const missing = changes
      .filter((c) => c.featured === true && c.image)
      .map((c) => String(c.image).split('/').pop()!)
      .filter((file) => !existsSync(resolve(WHATS_NEW_ASSETS_DIR, file)));
    expect(
      missing,
      `Capture it before Monday: node scripts/capture-whats-new-screenshots.mjs <id>. ` +
        `The rollup copies the filename through verbatim, so a missing file publishes a ` +
        `broken image AND reds the screenshot test for everyone.`,
    ).toEqual([]);
  });

  it('a staged heroAccentWord is never set without a heroHeadline', () => {
    const orphans = changes
      .filter((c) => (c as { heroAccentWord?: string }).heroAccentWord && !(c as { heroHeadline?: string }).heroHeadline)
      .map((c) => `"${String(c.summary).slice(0, 50)}..."`);
    expect(
      orphans,
      `The AFL hero renders a two-part display line. Half an authored pair is ignored, ` +
        `leaving copy that reads worse than the line derived from the title — write both ` +
        `or neither.`,
    ).toEqual([]);
  });

  it('a change never carries both a guide and a marquee entryId', () => {
    const both = changes
      .filter((c) => c.guide && c.entryId)
      .map((c) => `"${String(c.summary).slice(0, 50)}..."`);
    expect(
      both,
      `A line gets ONE trailing link. "entryId" points at the marquee article that already ` +
        `published; "guide" points at the evergreen how-to. Pick the fuller read.`,
    ).toEqual([]);
  });

  it('every staged "guide" points at a real /guides page', () => {
    const broken: string[] = [];
    for (const change of changes.filter((c) => c.guide)) {
      const href = String(change.guide).startsWith('/')
        ? String(change.guide)
        : `/guides/${change.guide}`;
      for (const league of leaguesFor(change)) {
        const prefix = ALL_LEAGUES.find((l) => l.navSlug === league)?.slug;
        if (!prefix) continue;
        if (!astroRouteExists(`/${prefix}${href}`)) {
          broken.push(`${href} does not resolve for ${league}`);
        }
      }
    }
    expect(
      broken,
      `A staged "guide" becomes a link in Monday's article. Write the guide page first.`,
    ).toEqual([]);
  });

  it('every staged "entryId" names a published What\'s New entry', () => {
    const known = new Set(typedEntries.map((e) => e.id));
    const missing = changes
      .filter((c) => c.entryId)
      .map((c) => String(c.entryId))
      .filter((id) => !known.has(id));
    expect(
      missing,
      `"entryId" links the Monday article back to a marquee entry that already published. ` +
        `An id with no entry ships a dead link in the one article everybody reads.`,
    ).toEqual([]);
  });

  it('every staged "entryId" is visible in each league the change lands in', () => {
    // Existing-and-visible are different questions. The [id] route redirects an
    // entry the reader's league is not tagged for straight back to the listing,
    // so a `both`-tagged line pointing at a single-league entry ships a "Read
    // the full story" link that goes nowhere for half the audience. The
    // sibling `guide` check already resolves per league; this closes the same
    // gap for the marquee link.
    const byId = new Map(typedEntries.map((e) => [e.id, e]));
    const broken: string[] = [];
    for (const change of changes.filter((c) => c.entryId)) {
      const entry = byId.get(String(change.entryId));
      if (!entry) continue; // covered above
      const visibleIn = Array.isArray(entry.leagues) ? entry.leagues : [];
      for (const league of leaguesFor(change)) {
        if (!visibleIn.includes(league as (typeof visibleIn)[number])) {
          broken.push(`${change.entryId} is not visible in ${league}`);
        }
      }
    }
    expect(
      broken,
      `Tag the staged change to the leagues the entry is actually visible in, or widen the ` +
        `entry's own \`leagues\`.`,
    ).toEqual([]);
  });
});
