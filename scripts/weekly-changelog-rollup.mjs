#!/usr/bin/env node

/**
 * Weekly Changelog Rollup Script
 *
 * Reads src/data/weekly-changelog-staging.json and generates ONE What's New
 * article PER LEAGUE — the only thing that publishes in an ordinary week.
 *
 * WHY ONE ARTICLE A WEEK. Between Aug 26 and Sep 6 2026, forty entries landed
 * in whats-new.json: three and a half articles a day, each written at full
 * length, none of them read. Everything user-facing now stages here and
 * compiles on Monday into one scannable list — features first, fixes under
 * them, one line each, with the depth behind a link to a /guides page or to
 * the marquee article that already ran. Fewer things to read; more in each.
 *
 * WHAT THE FEATURED CHANGE DOES. Exactly one staged change per league carries
 * `featured: true`, and it supplies the article's `headline`, its `lede` and
 * its screenshot. The script assembles; it does not write. Voice comes from
 * whoever staged the change, which is the only place a human is in the loop.
 *
 * Every staged change must declare a `league` ("theleague" | "afl" | "both").
 * Changes route to the matching league's article so AFL fixes never appear on
 * The League's What's New page and vice versa. Each generated entry carries an
 * explicit `leagues` tag — display code fails closed on untagged entries, and
 * tests/whats-new-data.test.ts blocks untagged data.
 *
 * The marquee exception still exists: a launch big enough to announce the day
 * it ships gets its own whats-new.json entry, and stages a one-line change
 * carrying `entryId` so the Monday article still names it and links to it.
 *
 * Run manually or via GitHub Actions every Monday at 8pm PT.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { WHATS_NEW_ACTIVE_MAX, WHATS_NEW_ARCHIVE_DIR } from './lib/retention-policy.mjs';
import {
  FEATURE_TYPES,
  FIX_TYPES,
  buildDateRange,
  buildDescription,
  buildSummary,
} from './lib/weekly-changelog-format.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const STAGING_PATH = resolve(ROOT, 'src/data/weekly-changelog-staging.json');
const WHATS_NEW_PATH = resolve(ROOT, 'src/data/whats-new.json');
const ARCHIVE_DIR = resolve(ROOT, WHATS_NEW_ARCHIVE_DIR);

/**
 * Get the Monday of the current week.
 */
function getCurrentMonday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday;
}

/**
 * Get next Monday from a given date.
 */
function getNextMonday(from) {
  const d = new Date(from);
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(d) {
  return d.toISOString().split('T')[0];
}

/**
 * Per-league rollup config derived from the league registry (single source of
 * truth — never hardcode league slugs or paths). Keyed by navSlug (the tag
 * vocabulary used in staging + whats-new.json). The default league keeps the
 * historical unsuffixed `weekly-rollup-<date>` id.
 */
const LEAGUE_ROLLUPS = Object.fromEntries(
  ALL_LEAGUES.map((league) => [
    league.navSlug,
    {
      idSuffix: league.slug === DEFAULT_LEAGUE_SLUG ? '' : `-${league.navSlug}`,
      leagues: [league.navSlug],
    },
  ]),
);

const VALID_CHANGE_LEAGUES = [...Object.keys(LEAGUE_ROLLUPS), 'both'];

// ── Main ──

/**
 * Keep the active file at WHATS_NEW_ACTIVE_MAX entries; everything older
 * moves to src/data/whats-new-archive/<year>.json (append-union by id,
 * newest-first). Only the archive index + permalink pages load the archive
 * files, so the homepage/hero bundle stays bounded while old permalinks
 * keep resolving. Screenshots stay in public/assets/whats-new — archived
 * entries still render them.
 */
const enforceWhatsNewCap = (entries) => {
  if (entries.length <= WHATS_NEW_ACTIVE_MAX) return { active: entries, archived: 0 };
  const active = entries.slice(0, WHATS_NEW_ACTIVE_MAX);
  const overflow = entries.slice(WHATS_NEW_ACTIVE_MAX);
  const byYear = new Map();
  for (const entry of overflow) {
    const year = String(entry.date ?? '').slice(0, 4) || 'undated';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(entry);
  }
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const [year, yearEntries] of byYear) {
    const file = resolve(ARCHIVE_DIR, `${year}.json`);
    let existing = [];
    try {
      existing = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      // new archive year
    }
    const seen = new Set(existing.map((e) => e.id));
    const merged = [...existing, ...yearEntries.filter((e) => !seen.has(e.id))];
    merged.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
    console.log(`Archived ${yearEntries.length} entries -> ${file}`);
  }
  return { active, archived: overflow.length };
};

// This script PUBLISHES and then EMPTIES the staging queue, so an unrecognised
// flag must never be shrugged off. `--dry-run` looks like it should exist,
// doesn't, and used to fall straight through to the real rollup — consuming
// every staged change (including other people's) on what the caller believed
// was a preview.
const KNOWN_FLAGS = new Set(['--cap-only']);
const unknownFlags = process.argv.slice(2).filter((a) => !KNOWN_FLAGS.has(a));
if (unknownFlags.length > 0) {
  console.error(`ERROR: unknown argument(s): ${unknownFlags.join(' ')}`);
  console.error(`Supported flags: ${[...KNOWN_FLAGS].join(', ')} (no arguments = publish the staging queue).`);
  console.error('There is no dry-run mode: this script always writes.');
  process.exit(1);
}

// --cap-only: enforce the active-file cap without publishing staging (used
// for the initial migration and safe to re-run any time).
if (process.argv.includes('--cap-only')) {
  const entries = JSON.parse(readFileSync(WHATS_NEW_PATH, 'utf-8'));
  const { active, archived } = enforceWhatsNewCap(entries);
  if (archived > 0) writeFileSync(WHATS_NEW_PATH, JSON.stringify(active, null, 2) + '\n');
  console.log(`Cap enforced: ${active.length} active, ${archived} moved to archive.`);
  process.exit(0);
}

const staging = JSON.parse(readFileSync(STAGING_PATH, 'utf-8'));

if (!staging.changes || staging.changes.length === 0) {
  console.log('No changes in staging file. Skipping rollup.');
  process.exit(0);
}

const changes = staging.changes;

// Refuse to run with untagged changes — a guessed league is how cross-league
// leaks happen. tests/whats-new-data.test.ts catches this at PR time; this
// check makes the Monday cron fail loudly instead of publishing a mistag.
const untagged = changes.filter((c) => !VALID_CHANGE_LEAGUES.includes(c.league));
if (untagged.length > 0) {
  console.error(`ERROR: staged changes missing a valid "league" (${VALID_CHANGE_LEAGUES.join(' | ')}):`);
  for (const c of untagged) console.error(`  - [${c.date}] ${(c.summary ?? '(no summary)').slice(0, 80)}`);
  process.exit(1);
}

const today = formatDate(getCurrentMonday());
const whatsNew = JSON.parse(readFileSync(WHATS_NEW_PATH, 'utf-8'));
const existingIds = new Set(whatsNew.map((e) => e.id));

const newEntries = [];

for (const [leagueSlug, config] of Object.entries(LEAGUE_ROLLUPS)) {
  const leagueChanges = changes.filter(
    (c) => c.league === leagueSlug || c.league === 'both',
  );
  if (leagueChanges.length === 0) continue;

  const id = `weekly-rollup-${today}${config.idSuffix}`;
  // Same-week re-run guard: this week's rollup was already published (e.g. a
  // mid-week workflow_dispatch after the Monday cron). Abort WITHOUT touching
  // whats-new.json or resetting staging — a duplicate id breaks the uniqueness
  // test and getStaticPaths; the staged changes roll into next Monday instead.
  if (existingIds.has(id)) {
    console.error(
      `ERROR: "${id}" already exists in whats-new.json — this week's rollup was already published. ` +
        `Staged changes are preserved for next Monday's run.`,
    );
    process.exit(1);
  }

  const features = leagueChanges.filter((c) => FEATURE_TYPES.has(c.type));
  const fixes = leagueChanges.filter((c) => FIX_TYPES.has(c.type));
  const dateRange = buildDateRange(leagueChanges);

  // The featured change supplies this article's face: its headline, its lede
  // and its screenshot. Scoped per league rather than per FILE (the old
  // top-level `featuredImage` + `featuredImageLeague` pair) because a change
  // tagged `both` is legitimately both leagues' headline, while one tagged
  // `afl` must never put the AFL's UI on TheLeague's What's New page. Routing
  // it through the change's own league tag makes that structural instead of a
  // second field somebody has to remember to set.
  const featuredForLeague = leagueChanges.filter((c) => c.featured === true);
  if (featuredForLeague.length > 1) {
    console.error(
      `ERROR: ${leagueSlug} has ${featuredForLeague.length} staged changes flagged "featured" ` +
        `— exactly one supplies the week's headline and screenshot. ` +
        `Nothing was published; staging is preserved.\n` +
        featuredForLeague.map((c) => `  - [${c.date}] ${String(c.summary ?? '').slice(0, 70)}`).join('\n'),
    );
    process.exit(1);
  }
  const featured = featuredForLeague[0] ?? null;

  // A week that shipped a page or a feature and flagged nothing has no
  // screenshot and no headline — the exact "wall of text nobody reads" this
  // format replaced. Fail before publishing rather than after.
  if (!featured && features.length > 0) {
    console.error(
      `ERROR: ${leagueSlug} staged ${features.length} feature-level change(s) but none is flagged ` +
        `"featured": true. The weekly article needs one to supply its headline, lede and screenshot. ` +
        `Nothing was published; staging is preserved.`,
    );
    process.exit(1);
  }

  const entry = {
    id,
    date: today,
    title: featured?.headline || `The Week in Review (${dateRange})`,
    summary: featured?.lede || buildSummary({ features, fixes }),
    description: buildDescription({ features, fixes, dateRange }),
    category: 'weekly',
    // No `link`: the homepage card and the hero CTA both fall back to this
    // entry's own article, which is where the week's detail actually is.
    // Pointing at /whats-new sent the reader to a list of the thing they were
    // already reading.
    icon: 'news',
    // Hero eligibility is a per-change human call made at staging time, not a
    // property of the week. One flagged change is enough to put the week's
    // article in the rotation — where P0/P1 league events still outrank it
    // (see resolveHeroState), which is the point: in season, the auction
    // beats the changelog.
    excludeFromHero: !leagueChanges.some((c) => c.heroWorthy === true),
    leagues: config.leagues,
  };

  // AFL-only copy, passed through from the featured change: the AFL homepage
  // hero renders a two-part display line (a plain phrase plus a colour-accented
  // closing word) and derives it from `title` when unset. A rollup title runs
  // long for that condensed type, so a featured change may author the pair
  // itself. Half a pair is worse copy than the derived one, hence both or
  // neither — `whats-new-data` enforces that on the published entry, and the
  // staging test catches it a week earlier.
  if (featured?.heroHeadline) {
    entry.heroHeadline = featured.heroHeadline;
    if (featured.heroAccentWord) entry.heroAccentWord = featured.heroAccentWord;
  }

  if (featured?.image) {
    // `entry.image` is a BARE FILENAME — every consumer builds the URL as
    // `/assets/whats-new/${entry.image}` (WhatsNewDetailPage, WhatsNewRow,
    // FeatureCompositeHero). A staged full path copied verbatim published
    // `/assets/whats-new//assets/whats-new/foo.webp` — a broken image on the
    // live entry and a red `whats-new-data` test blocking every PR until
    // someone repaired the published JSON by hand. Accept either form, store
    // the basename.
    entry.image = featured.image.split('/').pop();
    entry.imageAlt = featured.imageAlt || 'This week on the site';
  }

  newEntries.push({ leagueSlug, entry });
}

// Prepend to whats-new.json (newest first), then enforce the active cap —
// overflow moves to the per-year archive files.
whatsNew.unshift(...newEntries.map((n) => n.entry));
const { active } = enforceWhatsNewCap(whatsNew);
writeFileSync(WHATS_NEW_PATH, JSON.stringify(active, null, 2) + '\n');

// Reset staging file for next week
const nextMonday = getNextMonday(new Date());
const resetStaging = {
  weekOf: formatDate(nextMonday),
  changes: [],
};
writeFileSync(STAGING_PATH, JSON.stringify(resetStaging, null, 2) + '\n');

for (const { entry } of newEntries) {
  console.log(`Rollup complete: "${entry.title}" [${entry.leagues.join(', ')}] (${entry.id})`);
}
console.log(`Staging reset for week of ${resetStaging.weekOf}`);
