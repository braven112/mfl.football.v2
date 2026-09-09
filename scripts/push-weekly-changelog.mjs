#!/usr/bin/env node
/**
 * Push "What's new on the site" — the `site-update` category.
 *
 * Runs immediately after scripts/weekly-changelog-rollup.mjs, in the same
 * Monday job, and sends ONE notification per league: the week's article, its
 * headline, its lede, a link to itself.
 *
 * ONE A WEEK IS THE WHOLE POINT. The changelog used to publish three and a
 * half articles a day and buzz nobody, because pushing that volume would have
 * cost the league its push permission outright. A single Monday-evening
 * notification is a cadence an owner can live with, which is why `site-update`
 * is opt-in (`defaultOn: false`) and why this script sends exactly one per
 * league per run — never one per change.
 *
 * WHICH ENTRY IT SENDS. The rollup writes `weekly-rollup-<monday>[-<league>]`
 * to the top of whats-new.json. This reads that file back and matches on the
 * id rather than taking an argument, so the two scripts cannot drift apart on
 * what "this week's article" means. Nothing published this week (a quiet week,
 * or a rollup that exited before writing) means nothing to send.
 *
 * Never fails the job: the article is already published and committed by the
 * time this runs, and a push outage must not roll that back.
 *
 * Usage:
 *   node scripts/push-weekly-changelog.mjs [--dry-run]
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { sendPushFanout, broadcast } from './lib/push-fanout.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WHATS_NEW_PATH = resolve(ROOT, 'src/data/whats-new.json');

const DRY_RUN = process.argv.includes('--dry-run');

const CATEGORY = 'site-update';

/** Monday of the current week, matching the rollup's own id derivation. */
function currentMonday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

/** Every franchise id in a league, read from its registry-declared config. */
function franchiseIdsFor(league) {
  try {
    const config = JSON.parse(
      readFileSync(resolve(ROOT, ...league.configPath.split('/')), 'utf8'),
    );
    return (config.teams ?? []).map((t) => t.franchiseId).filter(Boolean);
  } catch (err) {
    console.warn(`  [push] could not read ${league.navSlug} teams: ${err.message}`);
    return [];
  }
}

async function main() {
  let entries;
  try {
    entries = JSON.parse(readFileSync(WHATS_NEW_PATH, 'utf8'));
  } catch (err) {
    console.warn(`Could not read whats-new.json (${err.message}); nothing pushed.`);
    return;
  }

  const monday = currentMonday();

  for (const league of ALL_LEAGUES) {
    const suffix = league.slug === DEFAULT_LEAGUE_SLUG ? '' : `-${league.navSlug}`;
    const id = `weekly-rollup-${monday}${suffix}`;
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      console.log(`No ${id} in whats-new.json — nothing to push for ${league.navSlug}.`);
      continue;
    }

    const franchiseIds = franchiseIdsFor(league);
    if (franchiseIds.length === 0) {
      console.warn(`  [push] ${league.navSlug} has no franchises; skipping.`);
      continue;
    }

    // The article's own permalink, league-prefixed. `sendPushFanout` resolves
    // the origin from the registry, so this stays a path — never an origin
    // concatenated by hand (docs/claude/rules/league-urls.md).
    const url = `/${league.slug}/whats-new/${entry.id}`;

    const result = await sendPushFanout({
      league,
      dryRun: DRY_RUN,
      category: CATEGORY,
      notifications: broadcast({
        franchiseIds,
        title: entry.title,
        // 160 chars is the practical ceiling before Android and iOS both
        // truncate; the lede is written to fit, this only guards a long one.
        body: String(entry.summary ?? '').slice(0, 160),
        url,
        // Tagged by entry id so a re-run of the Monday job replaces the
        // notification rather than stacking a second copy on the lock screen.
        tag: entry.id,
      }),
    });

    console.log(
      `${league.navSlug}: ${result.skipped ? `not sent (${result.skipped})` : `pushed to ${result.sent}`}`,
    );
  }
}

main().catch((err) => {
  // Deliberately non-fatal: the week's article is already published and
  // committed. A failed push is worth a line in the log, not a red job that
  // suggests the rollup itself broke.
  console.warn(`Weekly changelog push failed: ${err.message}`);
});
