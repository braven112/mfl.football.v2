#!/usr/bin/env node
/**
 * Derive each current franchise's `ownerHistory` from who OWNED it, season by
 * season, rather than from which franchise id it sat in.
 *
 * Why: `buildAttributor` (src/utils/owner-tenures.mjs) credits a season to the
 * franchise id it was played under. That is right for a league whose ids are
 * stable, and wrong for one that RENUMBERS — Archie's reshuffled 33 of its 99
 * current teams across ids between 2021 and 2026 (the SeaBirds were 0100 in
 * 2023-2024 and 0048 from 2025, while 0048 was the Mavericks 2022-2024). With
 * no `ownerHistory`, every 0048 season was credited to the SeaBirds and their
 * own two seasons were dropped. A team NAME is not identity (renames, reused
 * names); the MFL OWNER of each league-year is.
 *
 * ── PRIVACY: NAMES NEVER LEAVE THIS PROCESS ───────────────────────────────
 * Owner names come back only to a commissioner session (see
 * fetch-owner-names.mjs, whose fetcher this reuses), and a league may keep its
 * owners anonymous on the site. This script uses names ONLY as an in-memory
 * join key. Everything it prints or writes is franchise ids and years. Names
 * are never logged, never written, never put in an error message.
 *
 * Usage (needs the same credentials as fetch-owner-names.mjs):
 *   node scripts/derive-owner-history.mjs --league=archies          # dry run
 *   node scripts/derive-owner-history.mjs --league=archies --write  # set ownerHistory in the config
 *
 * A dry run prints the proposal and every case it would NOT decide: an owner
 * holding two franchises in one season, a current team whose owner MFL does
 * not name, and seasons MFL returns anonymously. Those years stay unattributed — the attributor fails closed — rather
 * than being guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { resolveLeagueArg } from './lib/owner-tenure-inputs.mjs';
import { fetchOwnersForYear, resolveCookies } from './fetch-owner-names.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPEN_END = 9999; // the existing ownerHistory convention for "to date"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The join key: case, spacing and punctuation never split one owner in two. */
export const ownerKey = (name) =>
  typeof name === 'string' ? name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null : null;

/**
 * Pure derivation — no network, no names out.
 *
 * @param teams      the league config's current teams (`franchiseId`)
 * @param ownersByYear Map<year, Map<franchiseId, ownerName>>
 * @returns {{ histories: Record<string, {franchiseId,yearStart,yearEnd}[]>, issues: string[] }}
 *   `issues` are id-and-year sentences only, safe to print anywhere.
 */
export function deriveOwnerHistories(teams, ownersByYear) {
  const years = [...ownersByYear.keys()].sort((a, b) => a - b);
  const issues = [];
  if (years.length === 0) return { histories: {}, issues: ['no season carried owner names'] };
  const currentYear = years[years.length - 1];

  // year -> ownerKey -> [franchiseId]
  const idsByOwner = new Map();
  for (const year of years) {
    const m = new Map();
    for (const [fid, name] of ownersByYear.get(year)) {
      const key = ownerKey(name);
      if (!key) continue;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(fid);
    }
    idsByOwner.set(year, m);
  }

  const currentOwners = ownersByYear.get(currentYear);
  const ownerOfCurrent = new Map(); // franchiseId -> ownerKey
  const claimedBy = new Map(); // ownerKey -> [franchiseId] among current teams
  for (const team of teams) {
    const key = ownerKey(currentOwners.get(team.franchiseId));
    if (!key) {
      issues.push(`${team.franchiseId}: MFL names no owner for it in ${currentYear} — left as is`);
      continue;
    }
    ownerOfCurrent.set(team.franchiseId, key);
    claimedBy.set(key, [...(claimedBy.get(key) ?? []), team.franchiseId]);
  }

  const histories = {};
  for (const team of teams) {
    const key = ownerOfCurrent.get(team.franchiseId);
    if (!key) continue;
    if (claimedBy.get(key).length > 1) {
      // One person runs two current teams: which history is which cannot be
      // told from the owner alone. Leave both to a human.
      issues.push(
        `${team.franchiseId}: its ${currentYear} owner also owns ${claimedBy
          .get(key)
          .filter((f) => f !== team.franchiseId)
          .join(', ')} — left as is`
      );
      continue;
    }
    const held = [];
    for (const year of years) {
      const ids = idsByOwner.get(year).get(key) ?? [];
      if (ids.length === 1) held.push({ year, id: ids[0] });
      else if (ids.length > 1) {
        issues.push(`${team.franchiseId}: ${year} owner held ${ids.join(' and ')} — that season left unattributed`);
      }
      // ids.length === 0: this owner was not in the league that season.
    }
    const ranges = [];
    for (const h of held) {
      const last = ranges[ranges.length - 1];
      if (last && last.franchiseId === h.id && last.yearEnd === h.year - 1) last.yearEnd = h.year;
      else ranges.push({ franchiseId: h.id, yearStart: h.year, yearEnd: h.year });
    }
    const tail = ranges[ranges.length - 1];
    if (tail && tail.franchiseId === team.franchiseId && tail.yearEnd === currentYear) tail.yearEnd = OPEN_END;
    histories[team.franchiseId] = ranges;
  }
  return { histories, issues };
}

/** A history that is just "this id, every year" says nothing the default doesn't. */
const isTrivial = (fid, ranges, firstYear) =>
  ranges.length === 1 && ranges[0].franchiseId === fid && ranges[0].yearStart === firstYear && ranges[0].yearEnd === OPEN_END;

const fmt = (ranges) =>
  ranges
    .map((r) => `${r.franchiseId} ${r.yearStart}${r.yearEnd === r.yearStart ? '' : `–${r.yearEnd === OPEN_END ? '' : r.yearEnd}`}`)
    .join(', ');

async function main() {
  let slug = null;
  let write = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--write') write = true;
    else if (arg.startsWith('--league=')) slug = resolveLeagueArg(arg.slice('--league='.length));
  }
  if (!slug) {
    console.error('Usage: node scripts/derive-owner-history.mjs --league=<slug> [--write]');
    process.exit(1);
  }
  const league = LEAGUES[slug];
  const configPath = path.join(ROOT, league.configPath);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const teams = config.teams;
  const feedsDir = path.join(ROOT, league.dataPath, 'mfl-feeds');
  const years = fs
    .readdirSync(feedsDir)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const cookies = await resolveCookies();
  const ownersByYear = new Map();
  let anonymous = 0;
  for (const year of years) {
    const { byFranchise, franchiseCount, leagueId } = await fetchOwnersForYear(league, year, cookies);
    // Counts only — never a name.
    console.log(`  ${year}: L=${leagueId} ${byFranchise.size}/${franchiseCount} franchises carry an owner name`);
    if (byFranchise.size === 0) anonymous += 1;
    else ownersByYear.set(year, byFranchise);
    await sleep(600);
  }
  if (anonymous > 0) {
    console.log(
      `\n  ${anonymous} season(s) came back anonymous — the login is not commissioner of those league-years.\n` +
        '  Their seasons are left out of the proposal (unattributed), never guessed.'
    );
  }

  const { histories, issues } = deriveOwnerHistories(teams, ownersByYear);
  // Trivial is judged against the first FEED year, not the first named one: a
  // season MFL kept anonymous must stay unattributed, and only an explicit
  // ownerHistory keeps the attributor from crediting it by franchise id.
  const firstYear = years[0];
  const changed = Object.entries(histories).filter(([fid, r]) => !isTrivial(fid, r, firstYear));
  console.log(`\n  ${Object.keys(histories).length} current teams derived; ${changed.length} need an ownerHistory:`);
  for (const [fid, ranges] of changed) console.log(`    ${fid}: ${fmt(ranges)}`);
  if (issues.length) {
    console.log(`\n  ⚠ ${issues.length} case(s) left to a human:`);
    for (const line of issues) console.log(`    ! ${line}`);
  }

  if (!write) {
    console.log('\n  DRY RUN — nothing written. Re-run with --write.\n');
    return;
  }
  for (const team of teams) {
    const ranges = histories[team.franchiseId];
    if (ranges && !isTrivial(team.franchiseId, ranges, firstYear)) team.ownerHistory = ranges;
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n  wrote ownerHistory for ${changed.length} teams to ${league.configPath}`);
  console.log('  Now re-run: node scripts/recompute-derived-chain.mjs\n');
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    // err.message comes from fetchOwnersForYear, which withholds response bodies.
    console.error('Error:', err.message);
    process.exit(1);
  });
}
