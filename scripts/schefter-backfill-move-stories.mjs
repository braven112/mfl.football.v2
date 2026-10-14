#!/usr/bin/env node
/**
 * One-off: rewrite this league year's template transaction posts as Schefter
 * move stories (scripts/lib/schefter-move-story.mjs).
 *
 * The scanner writes a story for every NEW move. This catches up the moves it
 * scanned before that existed, so the Transactions page reads as Schefter's
 * wire from the first move of the season rather than from the deploy.
 *
 * Idempotent: a post already at MOVE_STORY_VERSION is skipped, and a failed
 * generation leaves the template in place for the next run to retry. Progress
 * is flushed every BATCH posts, so a timeout keeps what it finished.
 *
 * Rewrites posts IN PLACE — id, timestamp, tier and every other field stay, so
 * permalinks, reactions and the watch-list watermark are untouched. The feed
 * merge (scripts/lib/merge-schefter-feed.mjs) keeps the higher storyVersion on
 * an id collision, so a scan that checked out before this commit cannot push
 * the template back.
 *
 * Usage:
 *   node scripts/schefter-backfill-move-stories.mjs                 # every Schefter league
 *   node scripts/schefter-backfill-move-stories.mjs --league afl
 *   node scripts/schefter-backfill-move-stories.mjs --dry-run       # count, call nothing, write nothing
 *   node scripts/schefter-backfill-move-stories.mjs --limit 20      # cap the rewrites per league
 *
 * Needs ANTHROPIC_API_KEY (and network to MFL; falls back to the committed
 * transactions feed).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SCHEFTER_LEAGUES, getSchefterLeague } from './lib/schefter-leagues.mjs';
import { leagueYearFor } from './lib/schefter-league-year.mjs';
import { parseRosterMove, rosterMoveString } from './lib/roster-move-parse.mjs';
import { LEAGUES as REGISTRY_LEAGUES } from '../src/config/leagues-data.mjs';
import {
  MOVE_STORY_SUBTYPES,
  MOVE_STORY_VERSION,
  applyMoveStory,
  factsFromRawMove,
  formatSalary,
  writeMoveStory,
} from './lib/schefter-move-story.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const LIMIT = Number(argValue('--limit')) || Infinity;
const BATCH = 25;
const CONCURRENCY = 4;
const MFL_HOST = process.env.MFL_HOST || 'api.myfantasyleague.com';

const ROSTER_TYPES = new Set(['FREE_AGENT', 'WAIVER', 'BBID_WAIVER']);

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Live MFL first (it has moves the last sync missed), the committed feed second. */
async function loadRawTransactions(league, year) {
  try {
    const url = `https://${MFL_HOST}/${year}/export?TYPE=transactions&L=${league.leagueId}&JSON=1`;
    const res = await fetch(url);
    if (res.ok) {
      const rows = asArray((await res.json())?.transactions?.transaction);
      if (rows.length) return rows;
    }
  } catch {
    // fall through to the committed copy
  }
  return asArray((await readJson(league.feedFilePath(year, 'transactions.json')))?.transactions?.transaction);
}

async function loadPlayers(league, year) {
  for (const y of [year, year - 1]) {
    const rows = asArray((await readJson(league.playersPath(y)))?.players?.player);
    if (rows.length) {
      return new Map(rows.map((p) => [p.id, { name: p.name, position: p.position, nflTeam: p.team }]));
    }
  }
  return new Map();
}

async function loadTeams(league) {
  const config = await readJson(league.configPath);
  return new Map((config?.teams ?? []).map((t) => [t.franchiseId, { name: t.name }]));
}

/**
 * The MFL row a template post was written from: same timestamp, same
 * franchise, a type of the post's family — narrowed by the player the post
 * names when a blind-bid batch stamped several claims on one timestamp.
 */
export function findRawRow(post, index) {
  const fid = post.franchiseIds?.[0];
  const candidates = (index.get(`${post.sourceTimestamp}|${fid}`) ?? []).filter((raw) =>
    post.transactionSubType === 'AUCTION_WON' ? raw.type === 'AUCTION_WON' : ROSTER_TYPES.has(raw.type),
  );
  if (candidates.length <= 1) return candidates[0] ?? null;
  const named = post.playerIds?.[0] ?? post.bigDrop?.playerId;
  if (!named) return null;
  const hits = candidates.filter((raw) => rosterMoveString(raw).split(/[|,]/).includes(named));
  return hits.length === 1 ? hits[0] : null;
}

/** Every file holding this league's posts: the active feed and its archive years. */
async function postFiles(league, year) {
  const files = [{ file: league.feedPath, kind: 'feed' }];
  const dir = path.join(path.dirname(league.feedPath), 'schefter-archive');
  try {
    for (const name of (await fs.readdir(dir)).sort()) {
      const y = Number(name.replace(/\.json$/, ''));
      // An archive file is a CALENDAR year; the league year can start in it.
      if (/^\d{4}\.json$/.test(name) && y >= year) files.push({ file: path.join(dir, name), kind: 'archive' });
    }
  } catch {
    // no archive yet
  }
  return files;
}

async function backfillLeague(league) {
  const registry = REGISTRY_LEAGUES[league.registrySlug];
  const year = leagueYearFor(league);
  console.log(`\n=== ${league.slug} — league year ${year} ===`);

  const [rawRows, players, teams] = await Promise.all([
    loadRawTransactions(league, year),
    loadPlayers(league, year),
    loadTeams(league),
  ]);
  const index = new Map();
  for (const raw of rawRows) {
    const key = `${raw.timestamp}|${raw.franchise}`;
    index.set(key, [...(index.get(key) ?? []), raw]);
  }
  console.log(`  ${rawRows.length} MFL rows, ${players.size} players, ${teams.size} teams`);

  let rewritten = 0;
  let failed = 0;
  let unmatched = 0;
  for (const { file, kind } of await postFiles(league, year)) {
    const doc = await readJson(file);
    if (!doc) continue;
    const posts = kind === 'feed' ? doc.posts : Array.isArray(doc) ? doc : doc.posts;
    const todo = (posts ?? []).filter(
      (p) =>
        p?.type === 'transaction' &&
        MOVE_STORY_SUBTYPES.has(p.transactionSubType) &&
        (Number(p.storyVersion) || 0) < MOVE_STORY_VERSION,
    );
    console.log(`  ${path.relative(process.cwd(), file)}: ${todo.length} template move post(s)`);

    const jobs = [];
    for (const post of todo) {
      if (rewritten + jobs.length >= LIMIT) break;
      const raw = findRawRow(post, index);
      if (!raw) {
        unmatched += 1;
        continue;
      }
      const facts = factsFromRawMove(raw, {
        players,
        parseRosterMove,
        leagueName: registry?.name ?? league.slug,
        hasSalaries: !!registry?.features?.salaryCap,
        dropSalary: post.bigDrop ? formatSalary(post.bigDrop.salary) : null,
      });
      if (!facts) {
        unmatched += 1;
        continue;
      }
      jobs.push({ post, facts });
    }
    if (DRY_RUN) {
      console.log(`  [dry-run] would rewrite ${jobs.length}`);
      rewritten += jobs.length;
      continue;
    }

    const flush = () => fs.writeFile(file, JSON.stringify(doc, null, 2) + '\n');
    for (let i = 0; i < jobs.length; i += BATCH) {
      const batch = jobs.slice(i, i + BATCH);
      for (let j = 0; j < batch.length; j += CONCURRENCY) {
        await Promise.all(
          batch.slice(j, j + CONCURRENCY).map(async ({ post, facts }) => {
            const story = await writeMoveStory({ facts, teams, apiKey: process.env.ANTHROPIC_API_KEY });
            if (!story) {
              failed += 1;
              return;
            }
            applyMoveStory(post, story, facts);
            rewritten += 1;
          }),
        );
      }
      await flush();
      console.log(`  …${Math.min(i + BATCH, jobs.length)}/${jobs.length}`);
    }
  }
  console.log(`  rewrote ${rewritten}, failed ${failed}, no MFL row ${unmatched}`);
  return { rewritten, failed };
}

async function main() {
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required (or pass --dry-run).');
    process.exit(1);
  }
  const leagueArg = argValue('--league');
  const leagues = leagueArg ? [getSchefterLeague(leagueArg)] : SCHEFTER_LEAGUES;
  for (const league of leagues) await backfillLeague(league);
}

// Only run when executed directly, so tests can import findRawRow.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
