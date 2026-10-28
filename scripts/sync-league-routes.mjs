#!/usr/bin/env node
/**
 * Bring package leagues' pages, site-search entries and nav in line with their
 * registry features and the page kit (scripts/lib/package-kit.mjs).
 *
 *   node scripts/sync-league-routes.mjs --all            # after editing a template
 *   node scripts/sync-league-routes.mjs --league archies # after changing its features
 *   node scripts/sync-league-routes.mjs --all --check    # exit 1 if anything is out of line
 *
 * Only manifest routes (src/config/package-league-routes.mjs) are touched: a
 * league's own pages (Archie's Gauntlet, its theme previews) are never written
 * or deleted here.
 */
import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { isPackageLeague } from '../src/config/package-league-routes.mjs';
import { applyChanges, syncPlan } from './lib/package-kit.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check') || args.includes('--dry-run');
const slug = args.includes('--league') ? args[args.indexOf('--league') + 1] : null;

let leagues;
if (args.includes('--all')) {
  leagues = ALL_LEAGUES.filter(isPackageLeague);
} else if (slug) {
  const league = getLeagueBySlug(slug);
  if (!league || !isPackageLeague(league)) {
    console.error(`${slug} is not a package league (registry pageKit: 'package').`);
    process.exit(1);
  }
  leagues = [league];
} else {
  console.error('Usage: node scripts/sync-league-routes.mjs (--all | --league <slug>) [--check]');
  process.exit(1);
}

let pending = 0;
for (const league of leagues) {
  // One league at a time: each plan reads the directory/nav the previous wrote.
  const changes = syncPlan(league);
  pending += changes.length;
  for (const c of changes) console.log(`${league.slug}: ${c.content === null ? 'delete' : 'write'} ${c.path}`);
  if (!check) applyChanges(changes);
}
if (!pending) console.log(`In line: ${leagues.map((l) => l.slug).join(', ')}`);
if (check && pending) {
  console.error(`\n${pending} change(s) pending — run without --check to apply.`);
  process.exit(1);
}
