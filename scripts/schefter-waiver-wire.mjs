#!/usr/bin/env node
/**
 * The weekly waiver-wire post: one short Schefter post per league, Thursday
 * morning, listing every claim Wednesday night's waiver run awarded and the
 * first-come-first-served adds made after it. Replaces the AI-written waiver
 * column (Brandon, 2026-11-26). The post itself is built in
 * scripts/lib/schefter-waiver-wire.mjs.
 *
 *   node scripts/schefter-waiver-wire.mjs --league theleague [--dry-run] [--replace]
 *
 * Reads MFL LIVE — never the committed transactions.json, which the roster
 * sync holds out of git and which once made the old column report "zero
 * claims" on a $725K week. If MFL cannot be read, nothing is posted.
 *
 * Feed only: no chat post and no push. Each claim already got its own post
 * (and push) from the scanner as it processed.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLiveTransactions, getFeedPath, loadJSON, loadTeams, resolveDataDir } from './article-utils/data-loaders.mjs';
import { isDuplicate, appendToFeed, replaceInFeed } from './article-utils/feed-writer.mjs';
import { getSeasonYear } from './article-utils/week-resolver.mjs';
import { addedIdsOf, buildWaiverWirePost } from './lib/schefter-waiver-wire.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

/** Live MFL records for ids the local players file does not know (a fresh signing). */
async function fetchPlayers(league, year, ids) {
  if (ids.length === 0) return [];
  const reg = LEAGUES[league];
  const url = `https://${reg.mflHost}/${year}/export?TYPE=players&PLAYERS=${ids.join(',')}&JSON=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MFL players export returned ${res.status}`);
  const rows = (await res.json())?.players?.player ?? [];
  return Array.isArray(rows) ? rows : [rows];
}

async function main() {
  const league = value('--league');
  if (!league || !LEAGUES[league]) {
    console.error(`Usage: --league <${Object.keys(LEAGUES).join(' | ')}> [--dry-run] [--replace]`);
    process.exit(1);
  }
  const now = new Date();
  const year = getSeasonYear(now);
  if (!isSeasonWindowOpen(year, now)) {
    console.log(`  [skip] ${league}: the ${year} season is not being played.`);
    return;
  }

  let rows;
  try {
    rows = (await fetchLiveTransactions(league, year)).transactions.transaction;
  } catch (err) {
    // Never post from the committed copy: it can be days old.
    console.warn(`::warning::[waiver-wire] ${league}: live MFL transactions unavailable (${err.message}); not posting.`);
    return;
  }

  const dataDir = resolveDataDir(projectRoot, year, league);
  const players = new Map();
  for (const p of (await loadJSON(path.join(dataDir, 'players.json'))).players?.player ?? []) players.set(p.id, p);
  const unknown = [...new Set(rows.flatMap((r) => (/WAIVER|FREE_AGENT/.test(r.type) ? addedIdsOf(r) : [])))]
    .filter((id) => !players.has(id));
  try {
    for (const p of await fetchPlayers(league, year, unknown)) players.set(p.id, p);
  } catch (err) {
    console.warn(`  [waiver-wire] could not fetch ${unknown.length} new player(s): ${err.message}`);
  }

  const post = buildWaiverWirePost({
    rows,
    players,
    teams: await loadTeams(projectRoot, league),
    league: LEAGUES[league].slug,
    nowSeconds: Math.floor(now.getTime() / 1000),
    zone: LEAGUES[league].officialClock?.zone,
  });
  if (!post) {
    console.log(`  [skip] ${league}: no waiver run in the last week (or a player could not be named).`);
    return;
  }

  console.log(`  ${post.id}\n  ${post.headline}\n\n${post.body}\n`);
  if (flag('--dry-run')) return;

  const feedPath = getFeedPath(projectRoot, league);
  if (flag('--replace')) {
    await replaceInFeed(feedPath, post);
    console.log(`✅ Replaced ${post.id}.`);
    return;
  }
  if (await isDuplicate(feedPath, post.id)) {
    console.log(`  [skip] ${post.id} already posted.`);
    return;
  }
  if (await appendToFeed(feedPath, post)) console.log(`✅ Posted ${post.id}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
