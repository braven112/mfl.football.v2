#!/usr/bin/env node

/**
 * Weekly Changelog Rollup Script
 *
 * Reads src/data/weekly-changelog-staging.json, groups changes by area,
 * generates a single whats-new.json entry, and resets the staging file.
 *
 * Run manually or via GitHub Actions every Monday at 8pm PT.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'playoffs': 'Playoffs',
  'mvp': 'MVPs',
  'rules': 'Rules',
  'import-rankings': 'Import Rankings',
  'whats-new': "What's New",
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
function buildDescription(groups, totalCount) {
  const areaNames = [...groups.keys()].map((a) => AREA_LABELS[a] || a);
  const intro = `This week's ${totalCount} bug fixes and polish improvements touched several areas of the site:`;

  const paragraphs = [intro];
  for (const [area, changes] of groups) {
    const label = AREA_LABELS[area] || area;
    const summaries = changes.map((c) => c.summary).join('. ');
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
  return `${totalCount} bug fixes and style improvements across ${areaNames.join(', ')}${suffix}.`;
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
    return `${startMonth} ${start.getDate()}-${end.getDate()}`;
  }
  return `${startMonth} ${start.getDate()}-${endMonth} ${end.getDate()}`;
}

// ── Main ──

const staging = JSON.parse(readFileSync(STAGING_PATH, 'utf-8'));

if (!staging.changes || staging.changes.length === 0) {
  console.log('No changes in staging file. Skipping rollup.');
  process.exit(0);
}

const changes = staging.changes;
const groups = groupByArea(changes);
const totalCount = changes.length;

const today = formatDate(getCurrentMonday());
const dateRange = buildDateRange(changes);

const entry = {
  id: `weekly-rollup-${today}`,
  date: today,
  title: `Weekly Fixes & Polish (${dateRange})`,
  summary: buildSummary(totalCount, groups),
  description: buildDescription(groups, totalCount),
  category: 'bug-fix',
  link: '/theleague/whats-new',
  linkLabel: 'See all updates',
  icon: 'wrench',
  excludeFromHero: true,
};

// Include featured screenshot if provided in staging
if (staging.featuredImage) {
  entry.image = staging.featuredImage;
  entry.imageAlt = staging.featuredImageAlt || 'Weekly rollup screenshot';
}

// Prepend to whats-new.json
const whatsNew = JSON.parse(readFileSync(WHATS_NEW_PATH, 'utf-8'));
whatsNew.unshift(entry);
writeFileSync(WHATS_NEW_PATH, JSON.stringify(whatsNew, null, 2) + '\n');

// Reset staging file for next week
const nextMonday = getNextMonday(new Date());
const resetStaging = {
  weekOf: formatDate(nextMonday),
  changes: [],
};
writeFileSync(STAGING_PATH, JSON.stringify(resetStaging, null, 2) + '\n');

console.log(`Rollup complete: "${entry.title}" (${totalCount} changes)`);
console.log(`Staging reset for week of ${resetStaging.weekOf}`);
