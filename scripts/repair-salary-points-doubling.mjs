#!/usr/bin/env node
/**
 * One-off repair: remove the doubleheader double count from the committed
 * `mfl-player-salaries-<year>.json` files, and change nothing else.
 *
 * WHY THIS IS SAFE TO RUN OVER TWENTY SEASONS
 * -------------------------------------------
 * `update-salary-averages.mjs` summed player scores across every matchup a
 * franchise appeared in, so each doubleheader week was counted twice (see
 * scripts/lib/player-season-points.mjs). TheLeague has played doubleheaders in
 * every season on record — 2013 had eleven — so roughly three in four
 * historical point totals are inflated.
 *
 * The correction is only trustworthy if it changes the double count and
 * NOTHING ELSE: not stat corrections MFL has made since, not the week range a
 * file was frozen at. So before touching a file this script PROVES it can
 * reproduce that file: it re-runs the ORIGINAL summation over the committed
 * weekly-results feed at each cutoff week, and only proceeds at a cutoff where
 * every single player's stored total comes back exactly. The fixed summation
 * is then run at that same cutoff, over that same feed. The two differ in one
 * respect only — the dedupe — so the rewrite is the double count and nothing
 * more. A file that no cutoff reproduces exactly is skipped and reported.
 *
 * That check is what caught the 2025 files: two of the three copies were
 * frozen on Friday Dec 5 (PT), before week 14 had been scored, so their
 * "frozenWeek: 14" content is really weeks 1-13. They are corrected at 13,
 * preserving what they hold; the early freeze is a separate bug.
 *
 * Only `points` is written. Summary files (`mfl-salary-averages-*`) do not use
 * points and are not touched.
 *
 * Usage:
 *   node scripts/repair-salary-points-doubling.mjs          # dry run
 *   node scripts/repair-salary-points-doubling.mjs --write  # apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { buildPlayerPoints, weeklyEntries } from './lib/player-season-points.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const league = getLeagueBySlug('theleague');

// Every place a copy of these files lives, and who reads it.
const SALARY_DIRS = [
  path.join('src', 'data'), // dead-money, mvp, compute-roster-season-payloads
  path.join('src', 'data', league.slug), // written by update-salary-averages
  league.dataPath, // compute-franchise-history
];
const FEEDS_DIR = path.join(league.dataPath, 'mfl-feeds');
const MAX_WEEK = 18;

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const round2 = (n) => Math.round(n * 100) / 100; // as normalizePlayers stores it

/** The summation exactly as it shipped — kept here only to prove reproduction. */
function legacyDoubledPoints(payload, maxWeek) {
  const totals = new Map();
  for (const entry of weeklyEntries(payload)) {
    const week = Number.parseInt(entry?.week ?? entry?.weekNumber ?? entry?.W ?? 0, 10) || 0;
    if (maxWeek && week > maxWeek) continue;
    for (const matchup of asArray(entry?.matchup)) {
      for (const franchise of asArray(matchup?.franchise)) {
        for (const player of asArray(franchise?.player)) {
          const score = Number.parseFloat(player?.score ?? 0);
          if (!player?.id || Number.isNaN(score)) continue;
          totals.set(player.id, (totals.get(player.id) ?? 0) + score);
        }
      }
    }
  }
  return totals;
}

const reproduces = (players, totals) =>
  players.every((p) => Math.abs(round2(totals.get(p.id) ?? 0) - (Number(p.points) || 0)) < 0.011);

const report = [];
for (const dir of SALARY_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  const files = fs.readdirSync(abs).filter((f) => /^mfl-player-salaries-\d{4}\.json$/.test(f)).sort();
  for (const name of files) {
    const year = name.match(/(\d{4})/)[1];
    const rel = path.join(dir, name);
    const feedPath = path.join(ROOT, FEEDS_DIR, year, 'weekly-results-raw.json');
    if (!fs.existsSync(feedPath)) {
      report.push({ file: rel, status: 'skipped: no weekly feed' });
      continue;
    }
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const data = JSON.parse(text);
    const players = data.players ?? [];
    if (!players.some((p) => Number(p.points))) {
      report.push({ file: rel, status: 'skipped: no points recorded' });
      continue;
    }
    const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));

    let cutoff = null;
    for (let w = 1; w <= MAX_WEEK; w++) {
      if (reproduces(players, legacyDoubledPoints(feed, w))) {
        cutoff = w;
        break;
      }
    }
    if (cutoff == null) {
      // Re-running after a successful repair lands here too: the file no
      // longer matches the old summation because it was already fixed. Say
      // so, rather than reporting a correct file as unprovable.
      let alreadyFixed = false;
      for (let w = 1; w <= MAX_WEEK && !alreadyFixed; w++) {
        alreadyFixed = reproduces(players, buildPlayerPoints(feed, w));
      }
      report.push({
        file: rel,
        status: alreadyFixed ? 'already corrected' : 'SKIPPED: no cutoff reproduces this file exactly',
      });
      continue;
    }

    const fixed = buildPlayerPoints(feed, cutoff);
    let changed = 0;
    let before = 0;
    let after = 0;
    for (const p of players) {
      const old = Number(p.points) || 0;
      const next = round2(fixed.get(p.id) ?? 0);
      before += old;
      after += next;
      if (Math.abs(next - old) >= 0.011) {
        changed++;
        p.points = next;
      }
    }

    if (WRITE && changed) {
      const out = JSON.stringify(data, null, 2) + (text.endsWith('\n') ? '\n' : '');
      fs.writeFileSync(path.join(ROOT, rel), out, 'utf8');
    }
    report.push({
      file: rel,
      status: changed ? (WRITE ? 'rewritten' : 'would rewrite') : 'unchanged',
      cutoff,
      changed: `${changed}/${players.length}`,
      totalBefore: Math.round(before),
      totalAfter: Math.round(after),
    });
  }
}

console.table(report);
const skipped = report.filter((r) => r.status.startsWith('SKIPPED'));
if (skipped.length) {
  console.error(`${skipped.length} file(s) could not be proven — left untouched.`);
  process.exitCode = 1;
}
if (!WRITE) console.log('Dry run. Re-run with --write to apply.');
