#!/usr/bin/env node
/**
 * Add each new season's keepers to a league's keeper-history file
 * (data/<league>/derived/keeper-history.json), read by League History through
 * src/utils/league-history/keepers.mjs.
 *
 * Seasons already in the file are never touched: 2005-2026 were rebuilt once
 * from MFL's rosters, transactions and drafts, and a season's keepers do not
 * change after the deadline (2005-2008 are estimated, see the file's note). A later season is taken from our own July roster
 * snapshots (roster-history/rosters-<year>-07-16..31.json, which the retention
 * policy keeps forever): the first snapshot where every franchise holds
 * exactly the league's keeper limit (MFL's `maxKeepers`) is the keeper set.
 * For 2026 that rule matches the rebuilt record for all 24 franchises.
 *
 * Runs in roster-sync after the roster snapshot lands. Idempotent: it writes
 * only when a season settles that the file does not have yet.
 *
 * Usage: node scripts/compute-afl-keeper-history.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { settledKeepers } from '../src/utils/league-history/keepers.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';

const KEEPER_WINDOW = /^rosters-(\d{4})-07-(1[6-9]|[23]\d)\.json$/;
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** "Rodgers, Aaron" → "Aaron Rodgers"; "Packers, Green Bay" → "Green Bay Packers". */
const displayName = (mflName) => {
  const [last, first] = String(mflName).split(', ');
  return first ? `${first} ${last}` : last;
};

for (const league of ALL_LEAGUES) {
  const file = path.join(league.dataPath, 'derived', 'keeper-history.json');
  if (!fs.existsSync(file)) continue;
  const history = readJson(file);
  const feedsDir = path.join(league.dataPath, 'mfl-feeds');
  const known = Object.keys(history.seasons ?? {}).map(Number);
  const last = known.length ? Math.max(...known) : 0;

  const years = fs
    .readdirSync(feedsDir)
    .filter((y) => /^\d{4}$/.test(y) && Number(y) > last)
    .sort();
  let added = 0;
  for (const year of years) {
    const dir = path.join(feedsDir, year);
    const leagueFile = path.join(dir, 'league.json');
    const snapshotDir = path.join(dir, 'roster-history');
    if (!fs.existsSync(leagueFile) || !fs.existsSync(snapshotDir)) continue;
    const meta = readJson(leagueFile);
    const settings = meta.league ?? meta;
    const limit = Number(settings.maxKeepers);
    if (!limit) continue;
    const franchiseIds = asArray(settings.franchises?.franchise).map((f) => f.id);
    const snapshots = fs
      .readdirSync(snapshotDir)
      .filter((name) => KEEPER_WINDOW.test(name) && name.slice(8, 12) === year)
      .map((name) => ({ date: name.slice(8, 18), rosters: readJson(path.join(snapshotDir, name)) }));
    const settled = settledKeepers(snapshots, franchiseIds, limit);
    if (!settled) continue;

    history.seasons[year] = Object.fromEntries([...settled.byFranchise].filter(([f]) => franchiseIds.includes(f)).sort());
    const playersFile = path.join(dir, 'players.json');
    const players = fs.existsSync(playersFile) ? asArray((readJson(playersFile).players ?? {}).player) : [];
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const ids of Object.values(history.seasons[year])) {
      for (const id of ids) {
        const p = byId.get(id);
        if (p) history.players[id] = [displayName(p.name), p.position ?? ''];
        else history.players[id] ??= [id, ''];
      }
    }
    added += 1;
    console.log(`${league.slug}: ${year} keepers from the ${settled.date} roster snapshot`);
  }

  if (added) {
    history.players = Object.fromEntries(Object.entries(history.players).sort(([a], [b]) => a.localeCompare(b)));
    writeJsonIfChanged(file, history);
  } else {
    console.log(`${league.slug}: no new keeper season`);
  }
}
