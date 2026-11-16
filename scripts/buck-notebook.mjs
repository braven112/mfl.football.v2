#!/usr/bin/env node
/**
 * Buck's Notebook: every Tuesday in season, Buck Archives (the Ask the History
 * historian) posts a few history facts about the coming week to the league's
 * news feed, which also carries them to the league's MFL pages through the
 * news widget. Brandon, 2026-11-16: Tuesdays, a different mix each week,
 * random and unique for each league, every number checked by code.
 *
 * The facts are drawn by src/utils/league-history/notebook.mjs from the
 * league's own League History dataset through the Ask the History engine. No
 * model is called, so a run costs nothing and cannot misstate a number.
 *
 * Usage:
 *   node scripts/buck-notebook.mjs --league theleague [--week N] [--dry-run]
 *
 * --week is the COMING week the issue is about (default: the week after the
 * last completed one). Self-skips outside the season, once the season's
 * champion is crowned, and when this week's issue already exists.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';
import { runQuery } from '../src/utils/league-history/ask-query.mjs';
import { buildNotebook, notebookText, FACT_KEYS } from '../src/utils/league-history/notebook.mjs';
import { getFeedPath, loadTeams, resolveDataDir, tryLoadJSON } from './article-utils/data-loaders.mjs';
import { getCompletedWeek, getSeasonYear } from './article-utils/week-resolver.mjs';
import { appendToFeed, isDuplicate } from './article-utils/feed-writer.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The feed author id, matching SCHEFTER_AUTHORS in src/types/schefter.ts. */
export const BUCK_AUTHOR_ID = 'buck-archives';

/** One issue per league per season-week. Season in the id, so an archived issue never reads as unposted. */
export const notebookPostId = (slug, year, week) => `sf_history_${slug}_${year}_w${week}`;

function parseArgs(argv) {
  const opts = { league: null, week: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--league') opts.league = argv[++i];
    else if (argv[i] === '--week') opts.week = Number.parseInt(argv[++i], 10);
    else if (argv[i] === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** This season's earlier issues, newest first, as the notebook module reads them. */
function earlierIssues(feed, slug, year) {
  const prefix = `sf_history_${slug}_${year}_`;
  return (Array.isArray(feed?.posts) ? feed.posts : [])
    .filter((p) => typeof p?.id === 'string' && p.id.startsWith(prefix) && p.notebook)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .map((p) => ({ factIds: p.notebook.factIds ?? [], keys: p.notebook.keys ?? [] }));
}

/** The first value of one column of a query, or null. */
function firstCell(ds, query) {
  try {
    return runQuery(ds, { ...query, limit: 1 }).rows[0]?.cells[0] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const league = LEAGUES[opts.league];
  if (!league) {
    console.error(`Usage: node scripts/buck-notebook.mjs --league <slug> [--week N] [--dry-run]`);
    process.exit(1);
  }
  const slug = league.slug;
  const year = getSeasonYear();
  console.log(`\n📜 Buck's Notebook (${slug}, ${year})`);

  if (opts.week == null && !isSeasonWindowOpen(year)) {
    console.log('  [skip] Not in season. Exiting cleanly.');
    return;
  }

  const derived = path.join(projectRoot, league.dataPath, 'derived');
  const ds = await readJson(path.join(derived, 'league-history.json'));
  if (!ds?.seasons?.length) {
    console.log('  [skip] No League History dataset for this league. Exiting cleanly.');
    return;
  }
  const players = await readJson(path.join(derived, 'league-history-players.json'));

  // A crowned champion ends the season's notebook: there is no coming week left.
  const years = { from: year, to: year };
  if (firstCell(ds, { unit: 'seasons', years, where: [{ field: 'champion', op: 'eq', value: true }], columns: ['year'] }) != null) {
    console.log(`  [skip] ${year} already has a champion. Exiting cleanly.`);
    return;
  }

  let week = opts.week;
  if (week == null) {
    const results = await tryLoadJSON(path.join(resolveDataDir(projectRoot, year, slug), 'weekly-results.json'));
    let teams = 16;
    try {
      teams = (await loadTeams(projectRoot, slug)).size || teams;
    } catch {
      /* keep the default */
    }
    const completed = getCompletedWeek(results, teams);
    if (completed < 1) {
      console.log('  [skip] No completed week yet this season. Exiting cleanly.');
      return;
    }
    week = completed + 1;
  }
  // Regular-season games each team has played this season, by the same count Ask the History uses.
  const games = Number(firstCell(ds, { unit: 'seasons', years, sort: [{ field: 'games', dir: 'desc' }], columns: ['games'] })) || 0;
  console.log(`  Coming week: ${week} | Games played: ${games}`);

  const feedPath = getFeedPath(projectRoot, slug);
  const id = notebookPostId(slug, year, week);
  if (!opts.dryRun && (await isDuplicate(feedPath, id))) {
    console.log(`  [skip] ${id} is already posted. Exiting cleanly.`);
    return;
  }

  const feed = await readJson(feedPath);
  const notebook = buildNotebook({ ds, players, league: slug, year, week, games, earlier: earlierIssues(feed, slug, year) });
  if (!notebook) {
    console.log('  [skip] Nothing on record worth saying this week. Exiting cleanly.');
    return;
  }
  const { headline, body } = notebookText(notebook, { week });
  console.log(`\n${body}\n`);
  if (opts.dryRun) return;

  const post = {
    id,
    timestamp: new Date().toISOString(),
    type: 'milestone',
    format: 'notebook',
    tier: 'standard',
    headline,
    // The feed renders a body as HTML; nothing a team name holds may become markup.
    body: body.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    authorId: BUCK_AUTHOR_ID,
    franchiseIds: [],
    league: slug,
    link: `/${slug}/history/record-book`,
    linkLabel: 'Open the Record Book →',
    notebook: {
      week,
      games,
      factIds: notebook.facts.map((f) => f.id),
      keys: notebook.facts.map((f) => f.key),
    },
  };
  if (await appendToFeed(feedPath, post)) console.log(`✅ Posted ${id} (${notebook.facts.length} of ${FACT_KEYS.length} kinds).`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
