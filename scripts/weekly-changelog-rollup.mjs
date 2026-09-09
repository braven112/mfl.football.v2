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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const STAGING_PATH = resolve(ROOT, 'src/data/weekly-changelog-staging.json');
const WHATS_NEW_PATH = resolve(ROOT, 'src/data/whats-new.json');
const ARCHIVE_DIR = resolve(ROOT, WHATS_NEW_ARCHIVE_DIR);

/** Map area slugs to display names */
const AREA_LABELS = {
  'free-agents': 'Free Agents',
  'rosters': 'Rosters',
  'navigation': 'Navigation & Routing',
  'design-system': 'Design System & Theming',
  'homepage': 'Homepage',
  'rankings': 'Rankings',
  'trade-builder': 'Trade Builder',
  'salary': 'Salary',
  'league-summary': 'League Summary',
  'calendar': 'Calendar',
  'standings': 'Standings',
  'live-scoring': 'Live Scoring',
  'playoffs': 'Playoffs',
  'mvp': 'MVPs',
  'rules': 'Rules',
  'import-rankings': 'Import Rankings',
  'whats-new': "What's New",
  'admin': 'Admin',
  'schefter': 'Schefter Report',
  'draft': 'Draft',
  'keeper-analysis': 'Keeper Report Card',
  'awards': 'Awards & Trophies',
  'franchises': 'Franchise Pages',
  'owners': 'Owner Pages',
  'notifications': 'Notifications',
  'sunday-ticket': 'Sunday Ticket',
  'other': 'Other',
};

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
 * Format a date as "Mon DD" (e.g., "Feb 16").
 */
function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Group changes by area, preserving insertion order.
 */
function groupByArea(changes) {
  const groups = new Map();
  for (const change of changes) {
    const area = change.area || 'other';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(change);
  }
  return groups;
}

/**
 * Which staged types read as "something new" versus "something mended".
 *
 * The split IS the article: one list of things you can now do, one list of
 * things that stopped being wrong. An `enhancement` sits in the first because
 * a changed feature is news to whoever uses it; a `style-tweak` sits in the
 * second because nobody came to read that a crest is no longer cropped.
 */
const FEATURE_TYPES = new Set(['new-page', 'new-feature', 'enhancement']);
const FIX_TYPES = new Set(['bug-fix', 'style-tweak']);

/** "1 fix" / "3 fixes" — per-league splits make single-change weeks common. */
function countPhrase(total, singular, plural) {
  return `${total} ${total === 1 ? singular : plural}`;
}

/** Join a list into readable prose: "a", "a and b", "a, b and c". */
function joinPhrases(parts) {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * One line of the article, as inline HTML.
 *
 * The summary carries the news; the trailing anchor carries the depth. A
 * change may point at a `guide` (an evergreen how-to under /guides) or at the
 * `entryId` of a marquee article that already published mid-week — never
 * both, and the marquee link wins because it is the fuller read.
 *
 * Hrefs are written LEAGUE-NEUTRAL on purpose: one body is stored per league
 * but `rewriteDescriptionLinks` still prefixes each href for the reader and
 * the apex hosts serve them bare. See src/utils/whats-new-links.ts.
 */
function buildChangeLine(change) {
  const summary = String(change.summary ?? '').trim().replace(/\s+$/, '');
  const body = /[.!?)]$/.test(summary) ? summary : `${summary}.`;

  if (change.entryId) {
    return `${body} <a href="/whats-new/${change.entryId}">Read the full story</a>.`;
  }
  if (change.guide) {
    const href = change.guide.startsWith('/') ? change.guide : `/guides/${change.guide}`;
    return `${body} <a href="${href}">How to use it</a>.`;
  }
  return body;
}

/**
 * Build the article body: a screenshot's worth of lede, then one line per
 * change under a heading. Deliberately NOT prose paragraphs per area — the
 * previous rollup concatenated every summary into a run-on wall nobody read,
 * which is the whole reason this format exists.
 *
 * Fixes stay grouped by area (a reader scanning for "did they fix the draft
 * room" wants them together); features do not, because a week has two or three
 * and a heading per area would be more chrome than content.
 */
function buildDescription({ features, fixes, dateRange }) {
  const blocks = [];

  if (features.length > 0) {
    blocks.push({
      type: 'list',
      heading: 'New this week',
      items: features.map(buildChangeLine),
    });
  }

  if (fixes.length > 0) {
    const groups = groupByArea(fixes);
    const items = [];
    for (const [area, changes] of groups) {
      const label = AREA_LABELS[area] || area;
      for (const change of changes) {
        items.push(`<strong>${label}</strong> \u2014 ${buildChangeLine(change)}`);
      }
    }
    blocks.push({ type: 'list', heading: 'Fixes & polish', items });
  }

  // "in the week of" rather than "between": a one-day range reads as
  // "between Sep 7", which is not a range at all.
  blocks.push(
    `Everything above shipped in the week of ${dateRange}. Older weeks are in ` +
      `<a href="/whats-new">the archive</a>, and the how-to pages for each feature ` +
      `live in <a href="/guides">the guides</a>.`,
  );

  return blocks;
}

/**
 * The card/hero summary line, when the featured change did not author a lede.
 *
 * A fallback, not the goal: a week worth reading has a human sentence on it.
 */
function buildSummary({ features, fixes }) {
  const parts = [];
  if (features.length > 0) {
    parts.push(countPhrase(features.length, 'new feature', 'new features'));
  }
  if (fixes.length > 0) parts.push(countPhrase(fixes.length, 'fix', 'fixes'));
  const what = joinPhrases(parts) || 'A quiet week';
  return `${what} across the site this week.`;
}

/**
 * Compute the date range string for the title (e.g., "Feb 16-22").
 */
function buildDateRange(changes) {
  const dates = changes.map((c) => c.date).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  const start = new Date(earliest + 'T12:00:00');
  const end = new Date(latest + 'T12:00:00');

  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });

  if (startMonth === endMonth) {
    if (start.getDate() === end.getDate()) {
      return `${startMonth} ${start.getDate()}`;
    }
    return `${startMonth} ${start.getDate()}-${end.getDate()}`;
  }
  return `${startMonth} ${start.getDate()}-${endMonth} ${end.getDate()}`;
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
