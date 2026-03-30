#!/usr/bin/env node
/**
 * Schefter Weekly Articles — Central Entry Point
 *
 * Generates automated Schefter articles by type. Each article type follows
 * the same pipeline: load data → build fact sheet → AI voice → validate → feed append.
 *
 * ALL data is pre-resolved by deterministic fact sheet builders.
 * The AI only adds voice/commentary — it never interprets raw data.
 *
 * Usage:
 *   node scripts/schefter-weekly-articles.mjs --type weekly-recap [--week 3] [--year 2026] [--dry-run]
 *
 * Article types:
 *   weekly-recap        Week N recap (Tuesday)
 *   waiver-pickups      BBID waiver claims (Wednesday)
 *   weekend-preview     Upcoming NFL weekend (Friday)
 *   matchup-preview     Fantasy matchups + broadcast guide (Saturday)
 *   cut-watch           Teams over roster limit (daily, Jul 15–Aug 16)
 *   championship-recap  Season champion (manual)
 *   draft-grades        Rookie draft grade cards (manual)
 *   team-grades         Pre-season roster grades (manual)
 *
 * Environment:
 *   ANTHROPIC_API_KEY — Required for Schefter voice generation
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJSON, resolveDataDir, getFeedPath } from './article-utils/data-loaders.mjs';
import { getSeasonYear, getCurrentNFLWeek, getCompletedWeek } from './article-utils/week-resolver.mjs';
import { callAnthropic } from './article-utils/ai-client.mjs';
import { isDuplicate, appendToFeed } from './article-utils/feed-writer.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const VALID_TYPES = [
  'weekly-recap',
  'waiver-pickups',
  'weekend-preview',
  'matchup-preview',
  'cut-watch',
  'championship-recap',
  'draft-grades',
  'team-grades',
];

// ── CLI Parsing ──

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { type: null, week: null, year: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--type': opts.type = args[++i]; break;
      case '--week': opts.week = parseInt(args[++i], 10); break;
      case '--year': opts.year = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }

  if (!opts.type || !VALID_TYPES.includes(opts.type)) {
    console.error(`Usage: node scripts/schefter-weekly-articles.mjs --type <type> [--week N] [--year N] [--dry-run]`);
    console.error(`Valid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  return opts;
}

// ── Data File Loader ──

const DATA_FILE_MAP = {
  'weekly-results-raw': 'weekly-results-raw.json',
  'weekly-results': 'weekly-results.json',
  'standings': 'standings.json',
  'transactions': 'transactions.json',
  'rosters': 'rosters.json',
  'projectedScores': 'projectedScores.json',
  'players': 'players.json',
  'league': 'league.json',
  'draftResults': 'draftResults.json',
};

async function loadDataFiles(dataDir, keys) {
  const data = {};
  await Promise.all(keys.map(async key => {
    const fileName = DATA_FILE_MAP[key];
    if (!fileName) throw new Error(`Unknown data key: ${key}`);
    data[key] = await loadJSON(path.join(dataDir, fileName));
  }));
  return data;
}

// ── Main Pipeline ──

async function main() {
  const opts = parseArgs();
  const { type, dryRun } = opts;

  console.log(`\n🎙️ Schefter Article Generator — ${type}\n`);

  // Step 1: Resolve year + week
  const year = opts.year ?? getSeasonYear();
  const dataDir = resolveDataDir(projectRoot, year);

  // Load weekly results for completed week detection
  let weeklyResults;
  try {
    weeklyResults = await loadJSON(path.join(dataDir, 'weekly-results.json'));
  } catch {
    weeklyResults = { weeks: [] };
  }

  const completedWeek = getCompletedWeek(weeklyResults);
  const currentWeek = getCurrentNFLWeek(year);
  const week = opts.week ?? completedWeek;

  console.log(`  Season: ${year} | Current NFL week: ${currentWeek} | Last completed: ${completedWeek} | Target week: ${week}`);

  // Step 2: Dynamic import of article type module
  const mod = await import(`./article-types/${type}.mjs`);

  // Step 3: Season guard (skip if week explicitly overridden via --week)
  const guardResult = opts.week != null
    ? true
    : mod.guardSeason(week, year, new Date(), { completedWeek, currentWeek });
  if (guardResult === false) {
    console.log('  [skip] Outside valid window for this article type. Exiting cleanly.');
    return;
  }

  // Step 4: Generate deterministic article ID
  const articleId = mod.config.id(year, week);
  console.log(`  Article ID: ${articleId}`);

  // Step 5: Dedup check
  const feedPath = getFeedPath(projectRoot);
  if (await isDuplicate(feedPath, articleId)) {
    console.log(`  [skip] Article ${articleId} already exists in feed. Exiting.`);
    return;
  }

  // Step 6: Load required data files
  console.log(`  Loading data: ${mod.config.requiredData.join(', ')}`);
  const data = await loadDataFiles(dataDir, mod.config.requiredData);

  // Also load broadcast mappings if needed
  if (mod.config.requiredData.includes('broadcast-mappings')) {
    const mainRepo = projectRoot.includes('.claude/worktrees/')
      ? projectRoot.replace(/\.claude\/worktrees\/[^/]+$/, '')
      : projectRoot;
    data['broadcast-mappings'] = await loadJSON(
      path.join(mainRepo, 'data', 'theleague', 'broadcast-mappings.json')
    );
  }

  // Step 7: Build fact sheet (deterministic — no AI)
  console.log('  Building fact sheet...');
  const { factSheet, enrichment } = await mod.buildFactSheet(data, week, year, projectRoot);

  if (dryRun) {
    console.log('\n--- FACT SHEET (dry run) ---\n');
    console.log(factSheet);
    console.log('\n--- END FACT SHEET ---');
    return;
  }

  // Step 8: Call Anthropic API
  console.log('  Generating Schefter article...');
  const systemPrompt = mod.getSystemPrompt();
  const userPrompt = mod.getUserPrompt(factSheet);
  const aiOutput = await callAnthropic(systemPrompt, userPrompt, mod.config.maxTokens);
  console.log(`  Headline: ${aiOutput.headline}`);

  // Step 9: Validate
  const errors = mod.validate(aiOutput);
  if (errors.length > 0) {
    console.warn('  Validation warnings:', errors);
  } else {
    console.log('  Validation passed');
  }

  // Step 10: Build post and append to feed
  const post = mod.buildPost(aiOutput, enrichment, articleId);
  const written = await appendToFeed(feedPath, post);
  if (written) {
    console.log(`\n✅ Article "${post.headline}" appended to feed.`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
