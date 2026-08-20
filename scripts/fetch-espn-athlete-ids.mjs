#!/usr/bin/env node
/**
 * fetch-espn-athlete-ids.mjs — backfill the ESPN NFL athlete ids MFL omits.
 *
 * MFL's `players` feed carries `espn_id` for most players and simply does not
 * for some — including starters. As of Aug 2026 that gap covered 23 of the 976
 * skill-position players in the pool, 13 of them ROSTERED in one of our
 * leagues, among them three starting kickers (Cameron Dicker, Jake Elliott,
 * Daniel Carlson), D'Andre Swift and Tony Pollard.
 *
 * That gap is not cosmetic. `PlayerIdentity.nflEspnId` is the join key for
 * every ESPN-backed surface — the live-scoring box score, scoring-play
 * attribution, player news — so a missing id silently drops a real starter out
 * of features he belongs in. It was visible on the live board: the AFL play
 * "Tre Tucker 26 Yd pass from Geno Smith" credited only Geno Smith.
 *
 * Output: data/theleague/derived/espn-nfl-id-backfill.json — a plain
 * mflId → espnId map, consumed by src/utils/player-map.ts. It only FILLS
 * GAPS; MFL's own `espn_id` always wins, so this can never rewrite an id the
 * feed is already sure about.
 *
 * ── Two passes, most-trustworthy first ────────────────────────────────────
 *
 * 1. **Team rosters** (32 fetches). Matching a player against the roster of
 *    the very team MFL says he plays for gives two independent confirmations
 *    — team AND jersey number — on top of the name. This resolves the bulk.
 *
 * 2. **Site search**, only for whoever pass 1 missed. Needed because a player
 *    can be between rosters (Daniel Carlson was on no NFL roster the day this
 *    was written, while MFL still listed him at LVR) and a roster scan by
 *    definition cannot see him.
 *
 * The two passes are independent, and when both ran they agreed on all 20
 * resolutions — worth knowing, because it means a search-only run (see below)
 * is not a degraded result, just a less-confirmed one.
 *
 * The passes also use DIFFERENT hosts: rosters come from site.api.espn.com,
 * search from site.web.api.espn.com. That matters when debugging locally,
 * because the two are not always reachable from the same place — in the dev
 * sandbox the roster host 403s without the agent proxy while the search host
 * answers fine, which shows up as `pass 1: 0/32 rosters` and a warning, with
 * search quietly resolving everything anyway. That is an environment quirk,
 * not a failure: run with NODE_USE_ENV_PROXY=1 to exercise pass 1.
 *
 * ── The one rule that matters ─────────────────────────────────────────────
 *
 * A WRONG id is far worse than a missing one. College and NFL athlete ids are
 * both plain 4-7 digit numbers, so a bad match does not fail — it silently
 * resolves a DIFFERENT athlete and shows his stats next to your player's name
 * (docs/claude/insights/features/player-news.md). Every acceptance path here
 * is therefore conservative:
 *
 *  - Search results are filtered on the `uid` league segment (`~l:28~` = NFL).
 *    ESPN's own uid is what separates the NFL Daniel Carlson (3051909) from
 *    the Arkansas one (3948377); a name match alone cannot.
 *  - A candidate is accepted only when exactly ONE survives filtering.
 *  - Jersey numbers must agree when both sides report one.
 *
 * Players who have never appeared on an NFL roster are expected to stay
 * unresolved, and that is correct rather than a shortfall: ESPN has no NFL
 * athlete entity for them at all. The three left over at time of writing were
 * all 2026 undrafted rookies (`status: R`, `team: FA`), and their only ESPN
 * matches were other people entirely — a UConn running back, and a Stony Brook
 * BASKETBALL player. Those get college headshots via espn-college-ids.json,
 * which is the mechanism that already exists for exactly this case.
 *
 * `tests/espn-athlete-id-coverage.test.ts` enforces the outcome: every
 * rostered player in every league must resolve, and pool coverage must hold
 * above 95%.
 *
 * Usage:
 *   node scripts/fetch-espn-athlete-ids.mjs [--dry-run] [--verbose]
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose') || DRY_RUN;

/** Where the backfill lands. NFL-wide data, so it lives with the other
 *  NFL-wide derived artifacts under the default league's data dir — the same
 *  place espn-college-ids.json and player-identity-union.json already sit. */
const OUT_PATH = join(process.cwd(), 'data/theleague/derived/espn-nfl-id-backfill.json');

/** ESPN's league segment for the NFL inside a `uid` (`s:20~l:28~a:<id>`). */
const NFL_UID_LEAGUE = 'l:28';

const ROSTER_URL = (code) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${code}/roster`;
const SEARCH_URL = (q) =>
  `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}&limit=10`;

/** Canonical ESPN team codes — the roster endpoint's own spelling. */
const ESPN_TEAM_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET',
  'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE',
  'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
];

/**
 * MFL/legacy team code → the ESPN spelling. Mirrors TEAM_CODE_MAP in
 * src/utils/nfl-logo.ts; duplicated rather than imported because this is a
 * plain node script and that module is TypeScript.
 */
const TEAM_CODE_MAP = {
  WAS: 'WSH', JAC: 'JAX', GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO',
  SFO: 'SF', TBB: 'TB', LVR: 'LV', HST: 'HOU', BLT: 'BAL', CLV: 'CLE',
  ARZ: 'ARI', OAK: 'LV', SDC: 'LAC', SD: 'LAC', RAM: 'LAR', STL: 'LAR',
};
const canonTeam = (code) => {
  const upper = String(code ?? '').toUpperCase();
  return TEAM_CODE_MAP[upper] ?? upper;
};

/** Positions we carry. Matches FANTASY_POSITIONS in src/utils/player-map.ts. */
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'Def']);

/**
 * Name suffixes ESPN folds into `lastName` ("Mims Jr.", "Bennett IV") but MFL
 * keeps out of it. Stripping them is what lets those two match on pass 1.
 */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

const normalizeNamePart = (raw) =>
  String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z]/g, ''))
    .filter((w) => w && !SUFFIXES.has(w))
    .join('');

/** MFL stores "Last, First"; ESPN gives firstName/lastName separately. */
const splitMflName = (name) => {
  const raw = String(name ?? '');
  const comma = raw.indexOf(',');
  if (comma === -1) return { first: '', last: normalizeNamePart(raw) };
  return {
    last: normalizeNamePart(raw.slice(0, comma)),
    first: normalizeNamePart(raw.slice(comma + 1)),
  };
};

const isEspnId = (v) => typeof v === 'string' && /^\d{1,12}$/.test(v);

/** Pull the athlete id out of an ESPN `uid`, but only for the NFL league. */
export const nflAthleteIdFromUid = (uid) => {
  if (typeof uid !== 'string' || !uid.includes(`~${NFL_UID_LEAGUE}~`)) return null;
  const id = uid.split('~a:')[1];
  return isEspnId(id) ? id : null;
};

/**
 * Concurrent upstream requests. Kept small on purpose — prebuild runs this
 * beside three other scripts that also hit ESPN, and a wide fan-out buys
 * nothing when the whole job takes seconds either way.
 */
const CONCURRENCY = 4;

async function fetchJson(url, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      });
      if (res.ok) return res.json();
      // 429/5xx are worth another try; a 404 is not.
      if (res.status < 429) throw new Error(`${res.status} ${url}`);
      lastErr = new Error(`${res.status} ${url}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await sleep(400 * (attempt + 1));
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = { ok: true, value: await worker(items[i]) };
        } catch (err) {
          results[i] = { ok: false, err };
        }
      }
    }),
  );
  return results;
}

/** Every MFL player at a fantasy position who has no `espn_id` of his own. */
function loadMissingPlayers() {
  const seen = new Map();
  for (const league of Object.values(ALL_LEAGUES)) {
    const dir = join(process.cwd(), league.dataPath, 'mfl-feeds');
    if (!existsSync(dir)) continue;
    // Newest year wins — a player's team changes, and the freshest row is the
    // one whose team code the roster pass should trust.
    const years = readdirSyncSafe(dir)
      .filter((n) => /^\d{4}$/.test(n))
      .sort((a, b) => Number(b) - Number(a));
    for (const year of years) {
      const file = join(dir, year, 'players.json');
      if (!existsSync(file)) continue;
      let rows = [];
      try {
        rows = JSON.parse(readFileSync(file, 'utf8'))?.players?.player ?? [];
      } catch {
        continue;
      }
      for (const p of rows) {
        if (!p?.id || seen.has(p.id)) continue;
        if (!FANTASY_POSITIONS.has(p.position)) continue;
        seen.set(p.id, p);
      }
      break; // newest year only, per league
    }
  }
  // Team defenses have no athlete id by definition — never chase one.
  return [...seen.values()].filter((p) => !p.espn_id && p.position !== 'Def');
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Pass 1 — match against the roster of the team MFL says he plays for. */
async function resolveFromRosters(missing, log) {
  const rosters = new Map();
  const results = await mapWithConcurrency(ESPN_TEAM_CODES, CONCURRENCY, async (code) => [
    code,
    await fetchJson(ROSTER_URL(code)),
  ]);
  for (const r of results) {
    if (!r?.ok) continue;
    const [code, payload] = r.value;
    const athletes = [];
    for (const group of payload?.athletes ?? []) {
      for (const a of group?.items ?? []) athletes.push(a);
    }
    rosters.set(code, athletes);
  }
  const athleteCount = [...rosters.values()].reduce((s, a) => s + a.length, 0);
  console.log(`[espn-ids] pass 1: ${rosters.size}/${ESPN_TEAM_CODES.length} rosters, ${athleteCount} athletes`);
  if (rosters.size < ESPN_TEAM_CODES.length) {
    // Not fatal — pass 2 can still resolve these — but say so, because a
    // silent roster shortfall means the weaker matching path is doing work
    // the stronger one should have done.
    console.warn(`::warning::[espn-ids] only ${rosters.size}/${ESPN_TEAM_CODES.length} ESPN rosters loaded; falling back to search for the rest`);
  }

  const resolved = new Map();
  for (const p of missing) {
    const roster = rosters.get(canonTeam(p.team));
    if (!roster) continue;
    const { first, last } = splitMflName(p.name);
    const cands = roster.filter(
      (a) =>
        normalizeNamePart(a.lastName) === last && normalizeNamePart(a.firstName) === first,
    );
    // Exactly one candidate, and no contradicting jersey number.
    if (cands.length !== 1) continue;
    const a = cands[0];
    if (p.jersey && a.jersey && String(p.jersey) !== String(a.jersey)) {
      log(`  jersey mismatch, skipping: ${p.name} MFL#${p.jersey} vs ESPN#${a.jersey}`);
      continue;
    }
    if (!isEspnId(String(a.id))) continue;
    resolved.set(p.id, String(a.id));
    log(`  roster  ${p.name} (${p.position} ${p.team}) -> ${a.id}`);
  }
  return resolved;
}

/** Pass 2 — search, for players no roster carries right now. */
async function resolveFromSearch(remaining, log) {
  const resolved = new Map();
  for (const p of remaining) {
    const { first, last } = splitMflName(p.name);
    const query = String(p.name ?? '').split(',').reverse().join(' ').trim();
    let payload;
    try {
      payload = await fetchJson(SEARCH_URL(query));
    } catch {
      continue;
    }
    const players =
      (payload?.results ?? []).find((g) => g?.type === 'player')?.contents ?? [];
    // NFL league only. This filter is the whole safety story for pass 2: it is
    // what stops a college namesake (or, seen live, a men's basketball player)
    // being accepted as an NFL athlete.
    const nfl = players
      .map((c) => ({ id: nflAthleteIdFromUid(c?.uid), name: c?.displayName }))
      .filter((c) => c.id && normalizeNamePart(c.name).endsWith(last) && normalizeNamePart(c.name).startsWith(first));
    if (nfl.length !== 1) {
      log(`  search  ${p.name}: ${nfl.length} NFL matches — leaving unresolved`);
      continue;
    }
    resolved.set(p.id, nfl[0].id);
    log(`  search  ${p.name} (${p.position} ${p.team}) -> ${nfl[0].id} (${nfl[0].name})`);
  }
  return resolved;
}

async function main() {
  const log = (msg) => VERBOSE && console.log(msg);
  const missing = loadMissingPlayers();
  console.log(`[espn-ids] ${missing.length} players with no espn_id in the MFL feeds`);
  if (missing.length === 0) return;

  const fromRosters = await resolveFromRosters(missing, log);
  const stillMissing = missing.filter((p) => !fromRosters.has(p.id));
  log(`pass 2: ${stillMissing.length} remaining`);
  const fromSearch = await resolveFromSearch(stillMissing, log);

  const merged = { ...Object.fromEntries(fromRosters), ...Object.fromEntries(fromSearch) };
  // Sorted so the file is stable run to run — a key-order shuffle would look
  // like a change to writeJsonIfChanged's byte compare and churn git.
  const ids = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => Number(a) - Number(b)));

  const unresolved = missing.filter((p) => !ids[p.id]);
  console.log(
    `[espn-ids] resolved ${Object.keys(ids).length}/${missing.length}` +
      ` (roster ${fromRosters.size}, search ${fromSearch.size}); ${unresolved.length} unresolved`,
  );
  for (const p of unresolved) {
    console.log(`[espn-ids]   unresolved: ${p.name} (${p.position} ${p.team}, status ${p.status ?? '-'})`);
  }

  if (DRY_RUN) {
    console.log('[espn-ids] --dry-run: not writing');
    return;
  }
  const payload = {
    _comment:
      'Generated by scripts/fetch-espn-athlete-ids.mjs. ESPN NFL athlete ids for players MFL omits an espn_id for. MFL\'s own espn_id always wins; this only fills gaps.',
    ids,
  };
  const wrote = writeJsonIfChanged(OUT_PATH, payload);
  console.log(`[espn-ids] ${wrote ? 'wrote' : 'unchanged'} ${OUT_PATH}`);
}

main().catch((err) => {
  // Non-fatal by design: prebuild treats fetch failures as warnings, and a
  // stale-but-present backfill is far better than failing the build.
  console.error('[espn-ids] failed:', err.message);
  process.exitCode = 0;
});
