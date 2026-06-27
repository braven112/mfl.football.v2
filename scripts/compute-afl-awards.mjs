#!/usr/bin/env node
/**
 * Compute AFL Fantasy award history → data/afl-fantasy/awards-history.json.
 *
 * Ten awards per season feed the franchise "trophy wall":
 *   - afl-championship  playoff bracket 1 winner
 *   - al-champion       playoff bracket 2 winner
 *   - nl-champion       playoff bracket 3 winner
 *   - nit               playoff bracket 6 winner
 *   - al-north/al-south/nl-east/nl-west   top divpct in each division
 *   - premier-league / dleague-champion   top of each all-play tier
 *
 * DATA SOURCING NOTES (load-bearing — read before editing):
 *
 *   1. The local pre-2024 caches under data/afl-fantasy/mfl-feeds/<year>/ are
 *      CONTAMINATED with TheLeague (13522) data, not AFL. Every year is
 *      validated against the canonical AFL franchise names (afl.config.json,
 *      stable franchise IDs) before its local cache is trusted; on mismatch
 *      the year is fetched online instead. 2024+ local caches are genuine AFL.
 *
 *   2. Tier champions (Premier League / D-League) are NOT auto-derivable. The
 *      MFL all-play page (O=101) returns a SINGLE all-play-sorted list of all
 *      24 teams with no tier markers; the AFL skin splits the two tiers
 *      client-side from per-year membership that isn't in any server response.
 *      Current afl.config membership doesn't match history (teams are promoted/
 *      relegated), so it can't be back-applied. Tier awards are therefore
 *      HAND-ENTERED into awards-history.json (premier-league / dleague-champion
 *      slugs) and this script PRESERVES them on every re-run (per-year merge).
 *
 * Usage:
 *   node scripts/compute-afl-awards.mjs            # local where valid, online to fill gaps
 *   node scripts/compute-afl-awards.mjs --offline  # never hit the network (no pre-2024)
 *   node scripts/compute-afl-awards.mjs --year 2023
 *
 * Re-run safe: an existing awards-history.json is read first; hand-entered tier
 * rows (and any award slug this script doesn't compute) are preserved, and the
 * eight auto-derived slugs are refreshed.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const FEEDS_DIR = path.join(ROOT, 'data/afl-fantasy/mfl-feeds');
const CONFIG_PATH = path.join(ROOT, 'data/afl-fantasy/afl.config.json');
const OUTPUT_PATH = path.join(ROOT, 'data/afl-fantasy/awards-history.json');

const HOST = 'www44';
const LEAGUE_ID = '19621';

const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const ONLINE = !OFFLINE; // online by default; --offline opts out
const yearArgIdx = args.indexOf('--year');
const SINGLE_YEAR = yearArgIdx >= 0 ? parseInt(args[yearArgIdx + 1], 10) : null;

// The AFL Cup era (2016–2017) predates the AL/NL conference format; bracket IDs
// were renumbered when the conference championships were introduced in 2018, so
// brackets are matched by NAME (below), not by fixed ID.
const FIRST_YEAR = 2016;
// Iterate through the current calendar year; per-award guards skip seasons
// whose brackets/standings aren't final yet (points all 0, no determinate winner).
const LAST_YEAR = new Date().getFullYear();

// Division id (MFL) → award slug.
const DIVISION_SLUG = {
  '00': 'al-north',
  '01': 'al-south',
  '02': 'nl-east',
  '03': 'nl-west',
};

// Franchise slots that changed HANDS (not just renamed). Awards a slot won
// before `since` belong to the prior owner, who is no longer in the league, so
// they must NOT credit the current franchise — otherwise an auto-derived title
// (e.g. a division win) would surface on the new owner's trophy wall. The award
// is kept in the record but de-attributed (franchiseId → null, historical
// `priorName` retained). 0013 was "Delirium Tremens" through 2019, then a new
// owner took the slot and renamed it "Muck Juggling Micks".
const OWNERSHIP_CHANGES = {
  '0013': { since: 2020, priorName: 'Delirium Tremens' },
};

// Playoff bracket NAME → award slug. Matching by name is era-robust: the
// "NIT Championship" was bracket 5 in 2016–17 and bracket 6 from 2018 on, and
// the AFL Cup (bracket 15, 2016–17 only) disappeared when AL/NL championships
// (brackets 2/3) arrived. NOTE: MFL's pre-2020 AFL Cup bracket stores only
// seed pointers (no franchise_id/points), so afl-cup never auto-resolves — it
// is hand-entered and preserved by the per-year merge, like the tier awards.
function bracketNameToSlug(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (n === 'afl championship') return 'afl-championship';
  if (n === 'al championship') return 'al-champion';
  if (n === 'nl championship') return 'nl-champion';
  if (n === 'nit championship') return 'nit';
  if (/^afl cup final/.test(n)) return 'afl-cup';
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (m) => console.log(`[afl-awards] ${m}`);
const warn = (m) => console.warn(`[afl-awards] WARN: ${m}`);

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const parseNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    if (err instanceof SyntaxError) return null; // cached HTML pages (option07) etc.
    throw err;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

// --- AFL identity --------------------------------------------------------------

let CANONICAL_NAMES = null;
async function loadCanonicalNames() {
  if (CANONICAL_NAMES) return CANONICAL_NAMES;
  const cfg = await readJson(CONFIG_PATH);
  CANONICAL_NAMES = new Map();
  for (const t of cfg?.teams ?? []) CANONICAL_NAMES.set(t.franchiseId, t.name);
  return CANONICAL_NAMES;
}

// A league.json is genuine AFL if at least one well-known franchise id maps to
// its canonical AFL name (guards against the TheLeague-contaminated caches).
async function isGenuineAfl(leagueJson) {
  const canon = await loadCanonicalNames();
  const franchises = toArray(leagueJson?.league?.franchises?.franchise);
  if (!franchises.length) return false;
  let matches = 0;
  for (const f of franchises) {
    if (canon.get(f.id) && canon.get(f.id) === f.name) matches++;
  }
  // Require a strong majority to call it AFL (renames happen, contamination is total).
  return matches >= Math.ceil(franchises.length / 2);
}

// --- Online fetch --------------------------------------------------------------

const UA = { 'User-Agent': 'mfl.football.v2 awards (+https://github.com/braven112/mfl.football.v2)' };

async function fetchExport(year, type, extra = '') {
  const url = `https://${HOST}.myfantasyleague.com/${year}/export?TYPE=${type}&L=${LEAGUE_ID}&JSON=1${extra}`;
  await sleep(600); // politeness — MFL rate-limits rapid bursts (429)
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// --- Per-year sources (local-if-genuine, else online) --------------------------

async function loadLeague(year) {
  const local = await readJson(path.join(FEEDS_DIR, String(year), 'league.json'));
  if (local && (await isGenuineAfl(local))) return local;
  if (ONLINE) {
    try {
      const online = await fetchExport(year, 'league');
      return online;
    } catch (err) {
      warn(`league fetch ${year} failed: ${err.message}`);
    }
  }
  return null;
}

async function loadStandings(year, leagueIsGenuineLocal) {
  if (leagueIsGenuineLocal) {
    const local = await readJson(path.join(FEEDS_DIR, String(year), 'standings.json'));
    if (local) return local;
  }
  if (ONLINE) {
    try {
      return await fetchExport(year, 'leagueStandings');
    } catch (err) {
      warn(`standings fetch ${year} failed: ${err.message}`);
    }
  }
  return null;
}

// --- Award extraction ----------------------------------------------------------

// Winner of a single playoff bracket payload ({ playoffRound, bracket_id }).
function bracketWinner(playoffBracket) {
  const rounds = toArray(playoffBracket?.playoffRound);
  if (!rounds.length) return null;
  const finalGame = toArray(rounds[rounds.length - 1].playoffGame)[0];
  if (!finalGame?.home || !finalGame?.away) return null;
  const home = finalGame.home;
  const away = finalGame.away;
  if (!home.franchise_id || !away.franchise_id) return null;
  const hp = parseNum(home.points);
  const ap = parseNum(away.points);
  if (hp === 0 && ap === 0) return null; // not played yet
  return hp >= ap ? home.franchise_id : away.franchise_id;
}

// Per-year bracket metadata: [{ id, name }]. Local playoff-brackets.json holds
// it under `playoffBrackets.playoffBracket[]`; online via TYPE=playoffBrackets.
async function bracketMeta(year, localCache) {
  const fromCache = toArray(localCache?.playoffBrackets?.playoffBracket);
  if (fromCache.length) return fromCache.map((b) => ({ id: b.id, name: b.name }));
  if (ONLINE) {
    try {
      const payload = await fetchExport(year, 'playoffBrackets');
      return toArray(payload?.playoffBrackets?.playoffBracket).map((b) => ({ id: b.id, name: b.name }));
    } catch (err) {
      warn(`playoffBrackets meta fetch ${year} failed: ${err.message}`);
    }
  }
  return [];
}

// Bracket winners for a year, mapped by bracket NAME (era-robust). Local
// playoff-brackets.json holds results under `brackets[id].playoffBracket`;
// online we fetch each bracket id directly.
async function bracketWinners(year, useLocal) {
  const out = {};
  const cached = useLocal
    ? await readJson(path.join(FEEDS_DIR, String(year), 'playoff-brackets.json'))
    : null;
  const localBrackets = cached?.brackets ?? cached?.playoffBrackets?.brackets ?? null;

  const meta = await bracketMeta(year, cached);
  for (const { id: bid, name } of meta) {
    const slug = bracketNameToSlug(name);
    if (!slug || out[slug]) continue;
    let winner = null;
    if (localBrackets?.[bid]?.playoffBracket) {
      winner = bracketWinner(localBrackets[bid].playoffBracket);
    }
    if (!winner && ONLINE) {
      try {
        const payload = await fetchExport(year, 'playoffBracket', `&BRACKET_ID=${bid}`);
        winner = bracketWinner(payload?.playoffBracket ?? payload);
      } catch (err) {
        warn(`bracket ${bid} (${name}) fetch ${year} failed: ${err.message}`);
      }
    }
    if (winner) out[slug] = { franchiseId: winner, source: `bracket:${bid}` };
  }
  return out;
}

// Division win pct. Newer standings exports carry `divpct` directly; older
// ones (pre-2023) only expose `divwlt` ("W-L-T") — derive it from there.
function divisionPct(row) {
  const direct = Number(row.divpct);
  if (Number.isFinite(direct) && row.divpct !== '' && row.divpct != null) return direct;
  const m = String(row.divwlt ?? '').match(/^(\d+)-(\d+)-(\d+)$/);
  if (!m) return 0;
  const [w, l, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const games = w + l + t;
  return games ? (w + 0.5 * t) / games : 0;
}

// Division winners: top division win pct in each division
// (tie-break divpf, then pf).
function divisionWinners(league, standings) {
  const out = {};
  const franchises = toArray(league?.league?.franchises?.franchise);
  const divOf = new Map(franchises.map((f) => [f.id, f.division]));
  const rows = toArray(standings?.leagueStandings?.franchise);
  const byDiv = new Map();
  for (const r of rows) {
    const div = divOf.get(r.id);
    if (div == null) continue;
    if (!byDiv.has(div)) byDiv.set(div, []);
    byDiv.get(div).push(r);
  }
  for (const [div, group] of byDiv) {
    const slug = DIVISION_SLUG[div];
    if (!slug) continue;
    group.sort(
      (a, b) =>
        divisionPct(b) - divisionPct(a) ||
        parseNum(b.divpf) - parseNum(a.divpf) ||
        parseNum(b.pf) - parseNum(a.pf)
    );
    const winner = group[0];
    if (winner && (divisionPct(winner) > 0 || parseNum(winner.pf) > 0)) {
      out[slug] = { franchiseId: winner.id, source: 'standings:divpct' };
    }
  }
  return out;
}

// Tier champions (premier-league / dleague-champion) are intentionally NOT
// computed here — see header note 2. They are hand-entered into
// awards-history.json and preserved by the per-year merge in main().

// --- Driver --------------------------------------------------------------------

async function nameMap(league) {
  const map = new Map();
  for (const f of toArray(league?.league?.franchises?.franchise)) map.set(f.id, f.name);
  return map;
}

async function computeYear(year) {
  const localLeague = await readJson(path.join(FEEDS_DIR, String(year), 'league.json'));
  const localGenuine = localLeague ? await isGenuineAfl(localLeague) : false;
  const league = await loadLeague(year);
  if (!league) {
    warn(`${year}: no usable AFL league data, skipping`);
    return null;
  }
  const names = await nameMap(league);
  const standings = await loadStandings(year, localGenuine);

  const awards = {
    ...(await bracketWinners(year, localGenuine)),
    ...(standings ? divisionWinners(league, standings) : {}),
  };

  // Enrich with names; drop empties; de-attribute pre-ownership-change wins.
  const enriched = {};
  for (const [slug, val] of Object.entries(awards)) {
    if (!val?.franchiseId) continue;
    const change = OWNERSHIP_CHANGES[val.franchiseId];
    if (change && year < change.since) {
      // Won by the prior owner — keep the record but don't credit the slot.
      enriched[slug] = { franchiseId: null, name: change.priorName, source: val.source };
      continue;
    }
    enriched[slug] = {
      franchiseId: val.franchiseId,
      name: names.get(val.franchiseId) || val.franchiseId,
      source: val.source,
    };
  }
  const count = Object.keys(enriched).length;
  log(`${year}: ${count} auto-derived awards (${Object.keys(enriched).join(', ') || 'none'})`);
  return count ? { year, awards: enriched } : null;
}

async function main() {
  const years = SINGLE_YEAR
    ? [SINGLE_YEAR]
    : Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

  const existing = await readJson(OUTPUT_PATH);
  const byYear = new Map();
  for (const s of existing?.seasons ?? []) byYear.set(s.year, s);

  for (const year of years) {
    const season = await computeYear(year);
    if (!season) continue;
    // Merge: keep hand-entered tier rows (and any prior award this run didn't
    // resolve), refresh the eight auto-derived slugs.
    const prev = byYear.get(year);
    byYear.set(year, {
      year,
      awards: { ...(prev?.awards ?? {}), ...season.awards },
    });
  }

  const seasons = [...byYear.values()].sort((a, b) => b.year - a.year);
  const output = {
    $comment:
      existing?.$comment ||
      'AFL award winners per season. Generated by scripts/compute-afl-awards.mjs.',
    seasons,
  };
  await writeJson(OUTPUT_PATH, output);
  log(`wrote ${seasons.length} seasons to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error('[afl-awards] fatal:', err);
  process.exit(1);
});
