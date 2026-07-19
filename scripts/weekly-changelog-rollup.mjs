#!/usr/bin/env node

/**
 * Weekly Changelog Rollup Script
 *
 * Reads src/data/weekly-changelog-staging.json, groups changes by area,
 * generates ONE whats-new.json entry PER LEAGUE, and resets the staging file.
 *
 * Every staged change must declare a `league` ("theleague" | "afl" | "both").
 * Changes are routed to the matching league's rollup entry so AFL fixes never
 * appear on The League's What's New page and vice versa. Each generated entry
 * carries an explicit `leagues` tag — display code fails closed on untagged
 * entries, and tests/whats-new-data.test.ts blocks untagged data.
 *
 * Run manually or via GitHub Actions every Monday at 8pm PT.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const STAGING_PATH = resolve(ROOT, 'src/data/weekly-changelog-staging.json');
const WHATS_NEW_PATH = resolve(ROOT, 'src/data/whats-new.json');

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
 * Build description paragraphs from grouped changes.
 */
/** "1 bug fix" / "3 bug fixes" — per-league splits make single-change weeks common. */
function countPhrase(totalCount, noun) {
  return `${totalCount} ${noun}${totalCount === 1 ? '' : 'es'}`;
}

function buildDescription(groups, totalCount) {
  const areaNames = [...groups.keys()].map((a) => AREA_LABELS[a] || a);
  const intro = `This week's ${countPhrase(totalCount, 'bug fix')} and polish improvements touched the following areas of the site:`;

  const paragraphs = [intro];
  for (const [area, changes] of groups) {
    const label = AREA_LABELS[area] || area;
    // Strip each summary's own trailing period so the join ('. ') and the
    // paragraph-final '.' don't produce doubled punctuation ('..'). Staging
    // summaries are written as full sentences ending in a period by
    // convention, so normalize here rather than policing every entry.
    const summaries = changes.map((c) => c.summary.replace(/\.\s*$/, '')).join('. ');
    paragraphs.push(`<strong>${label}</strong> \u2014 ${summaries}.`);
  }

  return paragraphs;
}

/**
 * Build the summary line.
 */
function buildSummary(totalCount, groups) {
  const areaNames = [...groups.keys()]
    .slice(0, 4)
    .map((a) => AREA_LABELS[a] || a)
    .map((n) => n.toLowerCase());

  const suffix = groups.size > 4 ? ', and more' : '';
  return `${countPhrase(totalCount, 'bug fix')} and style improvements across ${areaNames.join(', ')}${suffix}.`;
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
      link: `/${league.slug}/whats-new`,
      leagues: [league.navSlug],
    },
  ]),
);

const VALID_CHANGE_LEAGUES = [...Object.keys(LEAGUE_ROLLUPS), 'both'];

// ── Main ──

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

  const groups = groupByArea(leagueChanges);
  const totalCount = leagueChanges.length;
  const dateRange = buildDateRange(leagueChanges);

  const entry = {
    id,
    date: today,
    title: `Weekly Fixes & Polish (${dateRange})`,
    summary: buildSummary(totalCount, groups),
    description: buildDescription(groups, totalCount),
    category: 'bug-fix',
    link: config.link,
    linkLabel: 'See all updates',
    icon: 'wrench',
    excludeFromHero: true,
    leagues: config.leagues,
  };

  newEntries.push({ leagueSlug, entry });
}

// Route the featured screenshot to exactly ONE league's entry. The weekly
// screenshot depicts one league's page — attaching it to both entries would
// show League A's UI on League B's What's New page (cross-league image bleed).
if (staging.featuredImage) {
  const imageLeague =
    staging.featuredImageLeague ??
    (newEntries.length === 1 ? newEntries[0].leagueSlug : null);
  const target = newEntries.find((n) => n.leagueSlug === imageLeague);
  if (target) {
    target.entry.image = staging.featuredImage;
    target.entry.imageAlt = staging.featuredImageAlt || 'Weekly rollup screenshot';
  } else {
    // The weekly screenshot is MANDATORY (CLAUDE.md) — silently publishing
    // without it would hide the mistake. Fail loud, preserve staging, and let
    // a human fix featuredImageLeague (or the staged changes) before re-running.
    console.error(
      `ERROR: featuredImage "${staging.featuredImage}" has no matching league entry ` +
        `(featuredImageLeague: ${JSON.stringify(staging.featuredImageLeague)}, ` +
        `leagues with changes: ${newEntries.map((n) => n.leagueSlug).join(', ')}). ` +
        `Nothing was published; staging is preserved.`,
    );
    process.exit(1);
  }
}

// Prepend to whats-new.json (newest first)
whatsNew.unshift(...newEntries.map((n) => n.entry));
writeFileSync(WHATS_NEW_PATH, JSON.stringify(whatsNew, null, 2) + '\n');

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
