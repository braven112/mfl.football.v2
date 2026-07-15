#!/usr/bin/env node
/**
 * Compute AFL Fantasy tier (Premier League / D-League) movement for a completed
 * season and roll the makeup forward → data/afl-fantasy/tier-history.json.
 *
 * For each target season it:
 *   1. reads that year's tier membership from tier-history.json (the source of
 *      truth — MFL does not store tiers); the latest completed season can be
 *      seeded from afl.config.json when membership isn't recorded yet,
 *   2. computes each franchise's all-play record from the per-year weekly
 *      results, gated to afl.config.json#tierCompetition.cutoffWeek,
 *   3. ranks within each tier and applies the constitution movement rule
 *      (scripts/lib/afl-tier-standings.mjs) to name the two tier champions and
 *      derive next season's makeup, and
 *   4. writes the computed champions back onto the season and the rolled-forward
 *      membership onto the NEXT season.
 *
 * Re-run safe / idempotent: an existing tier-history.json is read first;
 * hand-entered champions for years WITHOUT membership (pre-2025, never
 * recoverable from MFL) are preserved, computed champions/membership are
 * refreshed. Same conventions as scripts/backfill-afl-championship-history.mjs
 * and scripts/compute-afl-awards.mjs (offline-by-default, --online to fill
 * gaps, --year for a single season, genuine-AFL cache validation).
 *
 * OWNER-TURNOVER CAVEAT (constitution rule the formula can't see): owners who
 * JOIN the league always start in the D-League, regardless of which tier their
 * franchise slot competed in — so a turnover year relegates correspondingly
 * fewer Premier League teams. This roll-forward is franchise-id-based and
 * cannot detect owner changes; when an owner leaves, hand-correct the NEXT
 * season's membership in tier-history.json after running this (the re-run
 * preserves the correction). Also why 2017-2019 membership can't be
 * reconstructed by formula (2016→2017 alone had slot swaps AND new owners).
 *
 * DATA SOURCING NOTE (load-bearing): pre-2024 local feeds under
 * data/afl-fantasy/mfl-feeds/<year>/ are CONTAMINATED with TheLeague (13522)
 * data. Every year's weekly results are validated against the canonical AFL
 * franchise names (afl.config.json, stable ids) before being trusted; on
 * mismatch the year is fetched online (www44/L=19621) when --online is set,
 * else skipped. 2024+ local caches are genuine AFL.
 *
 * Usage:
 *   node scripts/compute-afl-tier-movement.mjs            # latest completed season
 *   node scripts/compute-afl-tier-movement.mjs --year 2025
 *   node scripts/compute-afl-tier-movement.mjs --all      # every season with membership
 *   node scripts/compute-afl-tier-movement.mjs --online   # allow MFL fetch for contaminated/missing years
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchExport as sharedFetchExport } from './lib/mfl-api.mjs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

import {
  PREMIER,
  DLEAGUE,
  computeAllPlayThroughCutoff,
  computeTierMovement,
} from './lib/afl-tier-standings.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const AFL_LEAGUE = getLeagueBySlug('afl-fantasy');

const FEEDS_DIR = path.join(ROOT, AFL_LEAGUE.dataPath, 'mfl-feeds');
const CONFIG_PATH = path.join(ROOT, AFL_LEAGUE.dataPath, 'afl.config.json');
const OUTPUT_PATH = path.join(ROOT, AFL_LEAGUE.dataPath, 'tier-history.json');

// fetchExport wants the bare host prefix (it appends '.myfantasyleague.com'
// itself), so derive it from the registry's full mflHost.
const HOST = AFL_LEAGUE.mflHost.split('.')[0];
const LEAGUE_ID = AFL_LEAGUE.id;

const args = process.argv.slice(2);
const ONLINE = args.includes('--online');
const ALL = args.includes('--all');
const yearArgIdx = args.indexOf('--year');
const SINGLE_YEAR = yearArgIdx >= 0 ? parseInt(args[yearArgIdx + 1], 10) : null;

// NFL fantasy seasons run Aug → Feb; the current calendar year's season is
// never complete mid-year, so the latest completed season is last year.
const LATEST_COMPLETED = new Date().getFullYear() - 1;

const log = (m) => console.log(`[afl-tier] ${m}`);
const warn = (m) => console.warn(`[afl-tier] WARN: ${m}`);

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    if (err instanceof SyntaxError) return null; // cached HTML pages etc.
    throw err;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

// --- AFL identity (guards against TheLeague-contaminated caches) ---------------

let CANONICAL_NAMES = null;
async function loadConfig() {
  const cfg = await readJson(CONFIG_PATH);
  if (!cfg?.teams) throw new Error(`afl.config.json missing/malformed at ${CONFIG_PATH}`);
  return cfg;
}
async function canonicalNames(cfg) {
  if (CANONICAL_NAMES) return CANONICAL_NAMES;
  CANONICAL_NAMES = new Map((cfg.teams ?? []).map((t) => [t.franchiseId, t.name]));
  return CANONICAL_NAMES;
}

async function isGenuineAfl(cfg, leagueJson) {
  const canon = await canonicalNames(cfg);
  const franchises = toArray(leagueJson?.league?.franchises?.franchise);
  if (!franchises.length) return false;
  let matches = 0;
  for (const f of franchises) {
    if (canon.get(f.id) && canon.get(f.id) === f.name) matches++;
  }
  return matches >= Math.ceil(franchises.length / 2);
}

// --- Online fetch (only when local cache is contaminated/missing) --------------

const UA = 'mfl.football.v2 tier-movement (+https://github.com/braven112/mfl.football.v2)';

// 600ms politeness sleep before the (single) attempt — MFL rate-limits rapid
// bursts. retries: 0 preserves the original no-retry behavior.
const fetchExport = (year, type, extra = '') =>
  sharedFetchExport(
    { host: HOST, leagueId: LEAGUE_ID, year, type, extra },
    { userAgent: UA, retries: 0, sleepMs: 600 },
  );

// Build compact weekly results ({ weeks: [{ week, scores }] }) from MFL's
// matchup-shaped weeklyResults export, for weeks 1..cutoff.
async function fetchWeeklyResultsOnline(year, cutoffWeek) {
  const weeks = [];
  for (let w = 1; w <= cutoffWeek; w++) {
    let payload;
    try {
      payload = await fetchExport(year, 'weeklyResults', `&W=${w}`);
    } catch (err) {
      warn(`weeklyResults ${year} W=${w} failed: ${err.message}`);
      continue;
    }
    const matchups = toArray(payload?.weeklyResults?.matchup);
    const scores = {};
    for (const m of matchups) {
      for (const f of toArray(m.franchise)) {
        const s = Number(f.score);
        if (f.id && Number.isFinite(s)) scores[f.id] = s;
      }
    }
    if (Object.keys(scores).length) weeks.push({ week: w, scores });
  }
  return { weeks };
}

// Per-year weekly results, gated to the genuine-AFL check.
async function loadWeeklyResults(cfg, year, cutoffWeek) {
  const localLeague = await readJson(path.join(FEEDS_DIR, String(year), 'league.json'));
  const genuineLocal = localLeague ? await isGenuineAfl(cfg, localLeague) : false;

  if (genuineLocal) {
    const compact = await readJson(
      path.join(FEEDS_DIR, String(year), 'weekly-results.json')
    );
    if (compact?.weeks?.length) return compact;
  } else if (localLeague) {
    warn(`${year}: local feed is contaminated (not AFL) — ${ONLINE ? 'fetching online' : 'skipping (pass --online)'}`);
  }

  if (ONLINE) {
    try {
      const online = await fetchWeeklyResultsOnline(year, cutoffWeek);
      if (online.weeks.length) return online;
    } catch (err) {
      warn(`online weekly results ${year} failed: ${err.message}`);
    }
  }
  return null;
}

// --- Membership resolution -----------------------------------------------------

// Membership for a season: tier-history if present, else (for the latest
// completed season only) seed from afl.config.json, which mirrors the makeup
// teams competed in that season.
function resolveMembership(history, cfg, year) {
  const recorded = history.seasons?.[String(year)]?.membership;
  if (recorded && Object.keys(recorded).length) {
    return { membership: recorded, source: 'tier-history' };
  }
  if (year === LATEST_COMPLETED) {
    const fromConfig = {};
    for (const t of cfg.teams) if (t.tier) fromConfig[t.franchiseId] = t.tier;
    return { membership: fromConfig, source: 'afl.config snapshot (latest completed season)' };
  }
  return { membership: null, source: null };
}

const nameFor = (cfg, id) =>
  cfg.teams.find((t) => t.franchiseId === id)?.name || id;

// --- Driver --------------------------------------------------------------------

async function computeSeason(history, cfg, year, cutoffWeek) {
  const { membership, source } = resolveMembership(history, cfg, year);
  if (!membership) {
    warn(`${year}: no recorded tier membership — leaving as-is (champions, if any, preserved)`);
    return null;
  }

  const weekly = await loadWeeklyResults(cfg, year, cutoffWeek);
  if (!weekly) {
    warn(`${year}: no usable weekly results — cannot compute`);
    return null;
  }

  const allPlay = computeAllPlayThroughCutoff(weekly, cutoffWeek);
  const movement = computeTierMovement(membership, allPlay, history.movementRules);

  const champ = movement.champions;
  log(
    `${year}: ${PREMIER} champ ${champ['premier-league']} (${nameFor(cfg, champ['premier-league'])}), ` +
      `${DLEAGUE} champ ${champ['dleague-champion']} (${nameFor(cfg, champ['dleague-champion'])})`
  );
  if (movement.autoRelegated.length)
    log(`  relegated: ${movement.autoRelegated.map((id) => `${id} ${nameFor(cfg, id)}`).join(', ')}`);
  if (movement.autoPromoted.length)
    log(`  promoted:  ${movement.autoPromoted.map((id) => `${id} ${nameFor(cfg, id)}`).join(', ')}`);
  if (movement.swing)
    log(
      `  swing playoff → Premier: ${movement.swing.promoted.map((id) => nameFor(cfg, id)).join(', ')}`
    );

  return { year, membership, membershipSource: source, movement };
}

async function main() {
  const cfg = await loadConfig();
  const cutoffWeek = cfg.tierCompetition?.cutoffWeek ?? 17;

  const history = (await readJson(OUTPUT_PATH)) ?? { seasons: {} };
  history.seasons = history.seasons ?? {};

  let years;
  if (SINGLE_YEAR) years = [SINGLE_YEAR];
  else if (ALL)
    years = Object.keys(history.seasons)
      .filter((y) => history.seasons[y].membership)
      .map(Number)
      .sort((a, b) => a - b);
  else years = [LATEST_COMPLETED];

  if (!years.length) {
    warn('no seasons to process');
    return;
  }

  for (const year of years) {
    const result = await computeSeason(history, cfg, year, cutoffWeek);
    if (!result) continue;

    // Write computed champions + (seeded) membership onto this season.
    const season = history.seasons[String(year)] ?? {};
    season.membership = result.membership;
    if (!season.membershipSource || result.membershipSource !== 'tier-history') {
      season.membershipSource = result.membershipSource;
    }
    season.champions = result.movement.champions;
    season.championsSource = 'computed';
    season.allPlayStandings = {
      [PREMIER]: result.movement.standings[PREMIER],
      [DLEAGUE]: result.movement.standings[DLEAGUE],
    };
    history.seasons[String(year)] = season;

    // Roll the makeup forward onto the next season's membership. Preserve any
    // champions already recorded for next year (e.g. if it later completes).
    const nextYear = String(year + 1);
    const nextSeason = history.seasons[nextYear] ?? {};
    nextSeason.membership = result.movement.nextMembership;
    nextSeason.membershipSource = `rollforward:${year}`;
    history.seasons[nextYear] = nextSeason;
    log(`  → ${nextYear} makeup rolled forward (${result.movement.next[PREMIER].length} Premier / ${result.movement.next[DLEAGUE].length} D-League)`);
  }

  await writeJson(OUTPUT_PATH, history);
  log(`wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error('[afl-tier] fatal:', err);
  process.exit(1);
});
