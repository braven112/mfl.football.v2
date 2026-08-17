#!/usr/bin/env node
/**
 * Compute AFL Fantasy award history → data/afl-fantasy/awards-history.json.
 *
 * Award slugs that can feed the franchise "trophy wall" (a season carries only
 * the ones it actually held — eras differ; see below):
 *   - afl-championship  playoff bracket 1 winner
 *   - al-champion / nl-champion   conference-championship brackets (2018+)
 *   - nit               NIT-championship bracket
 *   - afl-cup           AFL Cup final (2016–2017 era; hand-entered — see note 2)
 *   - al-north/al-south/nl-east/nl-west (+ al-central/nl-pacific pre-2013)
 *                       first row of each division in MFL's official
 *                       leagueStandings order (MFL applies the constitution's
 *                       tiebreakers itself — never re-sort here)
 *   - premier-league / dleague-champion   top of each all-play tier
 *                       (derived from tier-history.json — note 2)
 *
 * DATA SOURCING NOTES (load-bearing — read before editing):
 *
 *   1. Some historical caches under data/afl-fantasy/mfl-feeds/<year>/ were
 *      once CONTAMINATED with TheLeague (13522) data, not AFL. Every year's
 *      league.json is validated before its local cache is trusted — its
 *      league id must match that year's AFL league id (year-host-map.json);
 *      on mismatch the year is fetched online instead.
 *
 *   2. Tier champions (Premier League / D-League) are derived from
 *      data/afl-fantasy/tier-history.json — the per-season tier source of truth
 *      written by scripts/compute-afl-tier-movement.mjs. MFL has no tier markers
 *      (its all-play export O=101 returns one 24-team list), so membership lives
 *      in that file; given it, the two tier champions are deterministic. This
 *      closes the old hand-entry gap: tier-history values supersede legacy
 *      `manual:tier-champion` rows on re-run. Years tier-history doesn't record
 *      (pre-2020 tier champions were never captured) simply get no tier award.
 *
 * Usage:
 *   node scripts/compute-afl-awards.mjs            # local where valid, online to fill gaps
 *   node scripts/compute-afl-awards.mjs --offline  # never hit the network (no pre-2024)
 *   node scripts/compute-afl-awards.mjs --year 2023
 *
 * Re-run safe: an existing awards-history.json is read first; remaining
 * hand-curated rows (e.g. afl-cup, pre-2016 titles) and any award slug this
 * script doesn't compute are preserved, while the auto-derived slugs — the
 * bracket/division awards plus the two tier champions — are refreshed.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchExport as sharedFetchExport, mflHostPrefix } from './lib/mfl-api.mjs';
import { isSeasonComplete } from './lib/afl-season-complete.mjs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const AFL_LEAGUE = getLeagueBySlug('afl-fantasy');

const FEEDS_DIR = path.join(ROOT, AFL_LEAGUE.dataPath, 'mfl-feeds');
const CONFIG_PATH = path.join(ROOT, AFL_LEAGUE.dataPath, 'afl.config.json');
const OUTPUT_PATH = path.join(ROOT, AFL_LEAGUE.dataPath, 'awards-history.json');
const TIER_HISTORY_PATH = path.join(ROOT, AFL_LEAGUE.dataPath, 'tier-history.json');

// Per-year MFL host + league id. Pre-2016 the AFL lived on a different host and
// league id every season (see data/afl-fantasy/year-host-map.json); 2016+
// settled on www44/19621. Loaded in main().
const HOST_MAP_PATH = path.join(ROOT, AFL_LEAGUE.dataPath, 'year-host-map.json');
const DEFAULT_HOST = mflHostPrefix(AFL_LEAGUE.mflHost);
const DEFAULT_LEAGUE_ID = AFL_LEAGUE.id;
let HOST_MAP = {};

function hostFor(year) {
  const e = HOST_MAP?.[String(year)];
  return { host: e?.host || DEFAULT_HOST, leagueId: e?.leagueId || DEFAULT_LEAGUE_ID };
}

const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const ONLINE = !OFFLINE; // online by default; --offline opts out
const yearArgIdx = args.indexOf('--year');
const SINGLE_YEAR = yearArgIdx >= 0 ? parseInt(args[yearArgIdx + 1], 10) : null;

// The AFL Cup era (2016–2017) predates the AL/NL conference format; bracket IDs
// were renumbered when the conference championships were introduced in 2018, so
// brackets are matched by NAME (below), not by fixed ID.
// 2003 exists in MFL but recorded no division play (all divw/divl = 0, pf = 0),
// so nothing is derivable there — start the divisional backfill at 2004.
const FIRST_YEAR = 2004;
// Iterate through the current calendar year; per-award guards skip seasons
// whose brackets/standings aren't final yet (points all 0, no determinate winner).
const LAST_YEAR = new Date().getFullYear();

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
let NAME_TO_ID = null; // current team name + every alias (lowercased) → franchiseId
let NAME_HISTORY = null; // franchiseId → [{ name, yearStart, yearEnd }]
async function loadCanonicalNames() {
  if (CANONICAL_NAMES) return CANONICAL_NAMES;
  const cfg = await readJson(CONFIG_PATH);
  CANONICAL_NAMES = new Map();
  NAME_TO_ID = new Map();
  NAME_HISTORY = new Map();
  const norm = (s) => String(s || '').trim().toLowerCase();
  for (const t of cfg?.teams ?? []) {
    CANONICAL_NAMES.set(t.franchiseId, t.name);
    NAME_TO_ID.set(norm(t.name), t.franchiseId);
    for (const a of t.aliases ?? []) NAME_TO_ID.set(norm(a), t.franchiseId);
    if (Array.isArray(t.history) && t.history.length) {
      NAME_HISTORY.set(t.franchiseId, t.history);
    }
  }
  return CANONICAL_NAMES;
}

// An award records the name the franchise wore WHEN IT WON, not the name it
// wears today — the trophy wall says "Thundering Herd, 2023", because that is
// who won it. Stamping the current name instead rewrites history every time a
// team rebrands, and the AFL rebrands its last-place finisher every year, so
// this is an annual event rather than an edge case. (2026: 0014 became "A Bruin
// Pegs Me" and the next offline re-run restamped its 2008/2016/2018/2023 titles
// with the punishment name.)
//
// Same rule and same year-matching as getTeamIdentityForYear /
// resolveConfigForYear (src/utils/team-names.ts), which is what every historical
// surface on the site displays — the ledger has to agree with the page. Kept as
// a small local mirror rather than an import because that module is TS and this
// is a plain-node prebuild script; the shape it reads (`history[]` with
// yearStart/yearEnd) is the same committed config.
//
// ONLY VALID FOR 2016+. A franchise's history[] is indexed by SLOT id, and the
// slot is only owner-stable from 2016 on (before that the AFL was recreated as
// a fresh MFL league every season). Pre-2016 the same number belonged to
// different owners in different years, so resolving a name through it answers
// "who held this number then", not "what was this winner called" — see the
// pre-2016 branch in computeYear, which uses the season's own feed name instead.
function nameForYear(franchiseId, year, fallback) {
  for (const entry of NAME_HISTORY?.get(franchiseId) ?? []) {
    if (year >= entry.yearStart && year <= entry.yearEnd) return entry.name;
  }
  return CANONICAL_NAMES?.get(franchiseId) || fallback;
}

// Resolve a historical team NAME to the current franchise that owns it (by
// name/alias). Pre-2016 the AFL was recreated as a fresh MFL league every year,
// so franchise NUMBERS are NOT owner-stable — only the team name carries owner
// identity. Returns null for defunct/unrecognized teams.
function currentIdForName(name) {
  return NAME_TO_ID?.get(String(name || '').trim().toLowerCase()) ?? null;
}

// A league.json is genuine AFL if its own league id matches the expected AFL
// league id for that year (year-host-map.json — the AFL was a fresh MFL league
// every season pre-2016, so franchise ids/names are NOT stable that far back;
// the TheLeague-contaminated caches carry TheLeague's id instead). Falls back
// to the id→canonical-name majority check for caches missing a league id.
async function isGenuineAfl(leagueJson, year) {
  const cachedId = String(leagueJson?.league?.id ?? '');
  if (cachedId && year != null) {
    return cachedId === String(hostFor(year).leagueId);
  }
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

const UA = 'mfl.football.v2 awards (+https://github.com/braven112/mfl.football.v2)';

// Politeness + 429 backoff — MFL rate-limits rapid bursts. Retry a 429 a
// couple times with escalating waits before giving up to the caller.
// (sleepMs is multiplied per attempt by the shared helper, matching the
// original 1400 * (attempt + 1) escalation.)
function fetchExport(year, type, extra = '') {
  const { host, leagueId } = hostFor(year);
  return sharedFetchExport(
    { host, leagueId, year, type, extra },
    {
      userAgent: UA,
      retries: 2,
      sleepMs: 1400,
      onRetry: (url, attempt) => warn(`${url} → 429, retrying (attempt ${attempt + 2})`),
    },
  );
}

// --- Per-year sources (local-if-genuine, else online) --------------------------

async function loadLeague(year) {
  const local = await readJson(path.join(FEEDS_DIR, String(year), 'league.json'));
  if (local && (await isGenuineAfl(local, year))) return local;
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
      // ALL=1 for the same reason backfill-standings-points.mjs uses it: an
      // archive year returns only the columns THAT league-year had configured
      // for display, and a trimmed response (no pf/divpct/divwlt) would fail
      // divisionWinners' played-season guard and silently drop that year's
      // four division titles.
      return await fetchExport(year, 'leagueStandings', '&ALL=1');
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
  if (hp === ap) return null; // exact tie — undeterminable, don't guess
  return hp > ap ? home.franchise_id : away.franchise_id;
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

// Division NAME (lowercased) → award slug. Era-proof: the 2004-2012 league had
// six divisions (incl. AL Central and NL Pacific, which have their own badges);
// 2013+ has the four below. Matching by name rather than id is what makes this
// work across eras — the division ids were renumbered when the league dropped
// from six divisions to four. Names are unique across the two conferences.
const DIVISION_NAME_SLUG = {
  north: 'al-north',
  central: 'al-central',
  south: 'al-south',
  east: 'nl-east',
  west: 'nl-west',
  pacific: 'nl-pacific',
  // 2006 only: the NL's third division (slot 05) was called "Atlantic" for
  // that one season — "Pacific" in both 2005 and 2007, same slot, same
  // conference. It is the same division under a one-year name, so it earns
  // the nl-pacific badge; without this entry 2006 silently credited five
  // division titles instead of six. These seven names are the complete set
  // ever used by the AFL (verified across every committed league.json).
  atlantic: 'nl-pacific',
};

// Division winners: MFL's leagueStandings rows arrive in the league's
// OFFICIAL final order — overall record first, ties broken by the league's
// configured tiebreakers (the constitution's chain: h2h → div% → conf% →
// PWR → PF → all-play → VP → most PA). The first row of each division IS
// the division winner; the league's own MFL skin reads winners off exactly
// that row (see mfl-feeds/2020/option07.json). Divisions are matched by
// NAME via DIVISION_NAME_SLUG; any name not in that map is skipped.
function divisionWinners(league, standings) {
  const out = {};
  const divisions = toArray(league?.league?.divisions?.division);
  const nameOfDiv = new Map(
    divisions.map((d) => [String(d.id), String(d.name || '').trim().toLowerCase()])
  );
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
    const slug = DIVISION_NAME_SLUG[nameOfDiv.get(String(div)) ?? ''];
    if (!slug) continue; // unmapped division name — skip
    // DO NOT SORT. Rows were pushed in feed order, which is MFL's official
    // final standings order with the constitution's tiebreakers already
    // applied. Any local re-sort here is a re-derivation of history — the
    // old divpct-primary sort (and a pf tiebreak before it) miscredited 22
    // division titles between 2004 and 2025, fixed 2026-08-11.
    // tests/afl-division-titles.test.ts locks winner === first feed row.
    const winner = group[0];
    if (winner && (divisionPct(winner) > 0 || parseNum(winner.pf) > 0)) {
      out[slug] = { franchiseId: winner.id, source: 'standings:mfl-order' };
    }
  }
  return out;
}

// Tier champions (premier-league / dleague-champion) are derived from the
// per-season tier source of truth, data/afl-fantasy/tier-history.json, written
// by scripts/compute-afl-tier-movement.mjs (see header note 2). This closes the
// old hand-entry gap. Years tier-history doesn't record champions for yield no
// tier award; the per-year merge in main() lets these tier-history values
// supersede any legacy `manual:tier-champion` rows.
let TIER_HISTORY = null;
async function loadTierHistory() {
  if (!TIER_HISTORY) TIER_HISTORY = (await readJson(TIER_HISTORY_PATH)) ?? { seasons: {} };
  return TIER_HISTORY;
}

async function tierChampions(year) {
  const history = await loadTierHistory();
  const champs = history.seasons?.[String(year)]?.champions;
  if (!champs) return {};
  const out = {};
  if (champs['premier-league'])
    out['premier-league'] = { franchiseId: champs['premier-league'], source: 'tier-history' };
  if (champs['dleague-champion'])
    out['dleague-champion'] = { franchiseId: champs['dleague-champion'], source: 'tier-history' };
  return out;
}

// --- Driver --------------------------------------------------------------------

async function nameMap(league) {
  const map = new Map();
  for (const f of toArray(league?.league?.franchises?.franchise)) map.set(f.id, f.name);
  return map;
}

async function computeYear(year) {
  await loadCanonicalNames(); // ensures CANONICAL_NAMES + NAME_TO_ID are built
  const localLeague = await readJson(path.join(FEEDS_DIR, String(year), 'league.json'));
  const localGenuine = localLeague ? await isGenuineAfl(localLeague, year) : false;
  const league = await loadLeague(year);
  if (!league) {
    warn(`${year}: no usable AFL league data, skipping`);
    return null;
  }
  const names = await nameMap(league);
  const standings = await loadStandings(year, localGenuine);

  // Brackets (championship / cup / conference / NIT) are auto-derived only for
  // 2016+. Pre-2016 those titles are hand-curated from the official League
  // Awards table (and the manual-preserving merge keeps them). Division titles
  // derive from standings for every year back to 2004 — but only once the
  // season has actually finished (see isSeasonComplete).
  const brackets = year >= 2016 ? await bracketWinners(year, localGenuine) : {};
  const seasonComplete = isSeasonComplete(year, brackets, LAST_YEAR);
  if (standings && !seasonComplete) {
    log(`${year}: season still in progress — no division titles credited yet`);
  }
  const awards = {
    ...brackets,
    ...(standings && seasonComplete ? divisionWinners(league, standings) : {}),
    ...(await tierChampions(year)),
  };

  // Enrich with names; drop empties; account for owner turnover.
  const enriched = {};
  for (const [slug, val] of Object.entries(awards)) {
    if (!val?.franchiseId) continue;
    const histName = names.get(val.franchiseId) || val.franchiseId;

    // Pre-2016 the AFL was recreated as a fresh league every season — owners
    // changed AND some owners moved slot numbers, so the slot id is not a
    // reliable owner key. Attribute by the historical team NAME instead: credit
    // the current franchise whose name/alias matches (owner identity travels
    // with the team name). Unrecognized names are defunct owners — record the
    // name but leave the title uncredited.
    if (year < 2016) {
      // Record the CONTEMPORANEOUS name (histName, straight from that season's
      // own league.json), never a name resolved from the current config. In
      // this era the slot id is not owner-stable, so `mapped` is an OWNER
      // pointer, not a slot the winner held — the current config's history[]
      // for that slot describes whoever else occupied the number back then. In
      // 2007 the champion was the team called Chatmaster, which was slot 0007
      // that season and is franchise 0021 today; 0021's own history[] says "Da
      // Dangsters" for 2007, because a different owner held 0021 then. Resolving
      // the name through the slot credits the title to the wrong team's name.
      const mapped = currentIdForName(histName);
      enriched[slug] = mapped
        ? { franchiseId: mapped, name: histName, source: val.source }
        : { franchiseId: null, name: histName, source: val.source };
      continue;
    }

    // 2016+: the league is continuous and slot ids are owner-stable. Honor known
    // ownership changes (stable slot, new owner from `since`).
    const change = OWNERSHIP_CHANGES[val.franchiseId];
    if (change && year < change.since) {
      enriched[slug] = { franchiseId: null, name: change.priorName, source: val.source };
      continue;
    }

    enriched[slug] = {
      franchiseId: val.franchiseId,
      name: nameForYear(val.franchiseId, year, histName),
      source: val.source,
    };
  }
  const count = Object.keys(enriched).length;
  log(`${year}: ${count} auto-derived awards (${Object.keys(enriched).join(', ') || 'none'})`);
  return count ? { year, awards: enriched } : null;
}

async function main() {
  HOST_MAP = (await readJson(HOST_MAP_PATH))?.years ?? {};

  const years = SINGLE_YEAR
    ? [SINGLE_YEAR]
    : Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

  const existing = await readJson(OUTPUT_PATH);
  const byYear = new Map();
  for (const s of existing?.seasons ?? []) byYear.set(s.year, s);

  for (const year of years) {
    const season = await computeYear(year);
    if (!season) continue;
    // Merge: hand-curated rows (source "manual:*") always win — they come from
    // the official League Awards table and must not be clobbered by an
    // auto-derived value. Other slots are refreshed from this run.
    const prev = byYear.get(year);
    const merged = { ...(prev?.awards ?? {}) };
    for (const [slug, val] of Object.entries(season.awards)) {
      const existingAward = merged[slug];
      const existingSource =
        typeof existingAward?.source === 'string' ? existingAward.source : '';
      // Hand-curated rows (source "manual:*") always win — EXCEPT the tier
      // champions, which are now auto-derived from tier-history.json and
      // supersede the legacy `manual:tier-champion` entries.
      if (
        existingSource.startsWith('manual:') &&
        !(val.source === 'tier-history' && existingSource === 'manual:tier-champion')
      ) {
        continue;
      }
      merged[slug] = val;
    }
    byYear.set(year, { year, awards: merged });
  }

  // The AFL Champion won their conference to reach the final, so they are also
  // that year's AL/NL champion. Brackets already capture this 2018+, but earlier
  // seasons (and the AFL Cup era) lack a conference-championship bracket — fill
  // the conference badge in. Conference is read from the division the champion
  // played in that year, else inferred as the opposite of the other recorded
  // conference champion.
  const AL_DIVS = ['al-north', 'al-central', 'al-south'];
  const NL_DIVS = ['nl-east', 'nl-west', 'nl-pacific'];
  for (const season of byYear.values()) {
    const champ = season.awards['afl-championship'];
    if (!champ?.franchiseId) continue; // uncredited (defunct) champion — skip
    const id = champ.franchiseId;
    if (season.awards['al-champion']?.franchiseId === id || season.awards['nl-champion']?.franchiseId === id) {
      continue; // already credited as conference champ
    }
    let conf = null;
    if (AL_DIVS.some((s) => season.awards[s]?.franchiseId === id)) conf = 'al';
    else if (NL_DIVS.some((s) => season.awards[s]?.franchiseId === id)) conf = 'nl';
    else if (season.awards['nl-champion']) conf = 'al';
    else if (season.awards['al-champion']) conf = 'nl';
    if (!conf) {
      warn(`${season.year}: cannot infer conference for AFL champion ${champ.name} — no conference badge added`);
      continue;
    }
    const slug = `${conf}-champion`;
    if (!season.awards[slug]) {
      season.awards[slug] = { franchiseId: id, name: champ.name, source: 'derived:afl-champion' };
    }
  }

  // Heal stale display names on 2016+ rows, whatever wrote them. The
  // enrichment above only reaches slugs this RUN could derive: bracket rows
  // need MFL reachable (an --offline run can't refresh them — the local 2018
  // playoff-brackets.json has no `brackets` key), and `manual:*` rows are
  // skipped by the merge entirely. So without this pass a rename half-lands —
  // 2018's nl-west got rewritten to the 2018 name while the same season's NIT
  // kept 0012's 2026 name, and the two rows disagreed about who won what.
  //
  // This is NOT a violation of manual-rows-always-win: that rule protects WHO
  // WON (franchiseId/source) from being clobbered by a re-derivation, while
  // `name` is a rendering of franchiseId + year that nothing curates
  // independently.
  //
  // STRICTLY 2016+. Before that a slot id is not owner-stable, so nameForYear
  // answers "who held this number then" rather than "what was this winner
  // called" — running this pass over all years renamed the 2007 champion
  // (Chatmaster, slot 0007 that season, franchise 0021 today) to "Da
  // Dangsters". Pre-2016 rows keep the season feed name the enrichment gave
  // them. Rows with a null franchiseId are skipped in both eras: those are
  // defunct owners the config has no identity for, where the recorded
  // historical name is the ONLY record of who won.
  for (const season of byYear.values()) {
    if (season.year < 2016) continue;
    for (const award of Object.values(season.awards)) {
      if (!award?.franchiseId) continue;
      award.name = nameForYear(award.franchiseId, season.year, award.name);
    }
  }

  const seasons = [...byYear.values()].sort((a, b) => b.year - a.year);
  const output = {
    // Always rewritten (not `existing?.$comment ||`) so the description of how
    // titles are derived can never go stale — but it MUST keep documenting the
    // hand-curated rows, because the merge in main() still depends on them and
    // this prose is the only place a reader of the JSON learns they exist.
    $comment:
      'AFL award winners per season, 2003-present. Division titles are taken ' +
      'straight from the FIRST ROW of each division in MFL’s official ' +
      'leagueStandings order (source "standings:mfl-order") — MFL applies the ' +
      'constitution’s tiebreakers itself, so nothing is re-sorted locally; see ' +
      'tests/afl-division-titles.test.ts. League Champion (afl-championship), ' +
      'AL/NL champions and the NIT are auto-derived for 2016+ from playoff ' +
      'brackets matched by NAME. Premier League + D-League tier champions are ' +
      `auto-derived from ${path.relative(ROOT, TIER_HISTORY_PATH)} (source ` +
      '"tier-history"), superseding the legacy hand-entered ' +
      '"manual:tier-champion" rows. Still HAND-ENTERED from the official League ' +
      'Awards table (source "manual:league-awards" / "manual:champion-history") ' +
      'and NEVER clobbered by a re-run: the AFL Cup (2015 knockout, 2016 ' +
      'all-play, and 2017 — the Cup’s last season, an all-play table ' +
      'decided at its week-16 cutoff, won by Smokane FC and confirmed against ' +
      'the season’s payout records), pre-2016 League Champions, and select ' +
      'pre-2016 conference champions. A null franchiseId means the winner is a defunct/pre-2016 ' +
      'franchise with no current page — the historical name is retained.',
    seasons,
  };
  await writeJson(OUTPUT_PATH, output);
  log(`wrote ${seasons.length} seasons to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error('[afl-awards] fatal:', err);
  process.exit(1);
});
