#!/usr/bin/env node

/**
 * Fetch the top defensive players for every NFL team (for the Free Agents hero
 * "DEF spotlight" face rotation).
 *
 * TheLeague uses team defenses (D/ST) only, so a DEF free agent has no headshot.
 * When the hero spotlight lands on a team defense we show that team's marquee
 * defenders' ESPN headshots (rotating between them) over the team-logo watermark.
 * This script keeps that roster current and gives us ≥5 players per team to
 * rotate through.
 *
 * How it ranks:
 *   1. Fetch each team's CURRENT roster (defense group) — this is the source of
 *      truth for "who is on the team right now" (+ headshot, position, experience).
 *   2. Fetch each rostered defender's most-recent-season statistics and compute a
 *      playmaking-weighted score: sacks / INTs / passes-defended / TFL / QB hits /
 *      forced fumbles are weighted heavily, raw tackle volume lightly, so premium
 *      corners and edge rushers aren't buried under tackle-happy linebackers. A
 *      small experience prior breaks ties toward established players.
 *   3. Rank each team's defenders by that score and keep the top N whose headshot
 *      resolves. Because ranking follows the CURRENT roster, a star traded in the
 *      offseason is scored (from his prior-season stats) and ranks on his new team.
 *
 * Output: src/data/theleague/def-spotlight-players.json
 *   { generatedAt, season, source, teams: { CODE: [{ name, espnId, position }] } }
 *
 * Runs weekly via GitHub Actions (def-spotlight-sync.yml). Also runnable locally:
 *   node scripts/fetch-def-spotlight-players.mjs
 *   node scripts/fetch-def-spotlight-players.mjs --season 2025 --top 6
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const OUT_PATH = path.join(root, 'src/data/theleague/def-spotlight-players.json');

// Minimum players we want per team so the spotlight has something to rotate
// through; TOP_N is how many we keep when the roster/ranking supports it.
const MIN_PER_TEAM = 5;
const DEFAULT_TOP_N = 6;

// --- CLI args ---------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
};
const TOP_N = Number(getArg('top')) || DEFAULT_TOP_N;
const SEASON_OVERRIDE = getArg('season') ? Number(getArg('season')) : undefined;

// --- Team code mapping ------------------------------------------------------
// JSON keys use the normalized codes that free-agent objects carry in
// `player.team` (see MFL_TEAM_CODE_MAP / normalizeMflTeam in players.astro).
// ESPN's roster/leaders use its own abbreviations — only Washington differs
// (WAS → WSH); the rest of the normalized set matches ESPN 1:1.
const APP_TO_ESPN = { WAS: 'WSH' };
const ESPN_TO_APP = { WSH: 'WAS' };
const appCode = (espnAbbr) => ESPN_TO_APP[espnAbbr] ?? espnAbbr;
const espnCode = (app) => APP_TO_ESPN[app] ?? app;

// The 32 normalized team codes we expect to emit (matches the DEF free agents).
const EXPECTED_TEAMS = [
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU',
  'IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT',
  'SEA','SF','TB','TEN','WAS',
];

// --- Scoring weights --------------------------------------------------------
// Playmaking-weighted score from per-athlete season stats. Impact/coverage plays
// (sacks, INTs, passes-defended, TFL, QB hits, forced fumbles, defensive TDs) are
// weighted heavily; raw tackle volume is weighted lightly so tackle-happy depth
// linebackers don't outrank premium corners and edge rushers. Keys are matched
// against a flattened merge of a player's defensive stat categories.
const STAT_WEIGHTS = {
  sacks: 6,
  interceptions: 9,
  passesDefended: 2.5,
  tacklesForLoss: 2.4,
  QBHits: 1.2,
  fumblesForced: 4,
  fumblesRecovered: 3,
  totalTackles: 0.12, // volume — deliberately light (soloTackles ignored to avoid double count)
};
// Any defensive stat key ending in "Touchdowns" (INT/fumble return TDs) — big play.
const TOUCHDOWN_WEIGHT = 8;

// Tiebreaker position-impact weight (for players with equal/zero production).
const POSITION_WEIGHT = {
  DE: 5, EDGE: 5, OLB: 4.5, DT: 4, NT: 4, LB: 4, ILB: 4, MLB: 4,
  CB: 3.5, S: 3.5, FS: 3.5, SS: 3.5, DB: 3,
};

// --- Marquee "always include" defenders -------------------------------------
// Pro Bowl + All-Pro defenders are the star-reputation signal that raw counting
// stats miss (a shutdown corner like Surtain gets few tackles because QBs avoid
// him). Any current-roster defender whose name is in this set is PINNED to the
// front of his team's pool, ahead of the stat-ranked field.
//
// The list is sourced from def-marquee-defenders.json, regenerated yearly from
// Wikipedia by scripts/fetch-marquee-defenders.mjs (marquee-defenders-sync.yml),
// since ESPN's API doesn't expose Pro Bowl / All-Pro rosters. Matching is
// name-based against the LIVE roster, so a player traded in the offseason is
// still pinned on his new team, and a name that no longer matches any roster is
// simply ignored (and logged).
const MARQUEE_DEFENDER_NAMES = (() => {
  try {
    const p = path.join(root, 'src/data/theleague/def-marquee-defenders.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).names ?? [];
  } catch (err) {
    console.warn(`⚠ Could not load marquee defenders (${err.message}); pinning disabled.`);
    return [];
  }
})();

// Normalize for matching: strip diacritics, suffixes (Jr/Sr/II/III/IV/V), and all
// non-alphanumerics so "T.J. Watt" === "T. J. Watt" and "Kevin Byard III" === "Kevin Byard".
function normalizeName(name) {
  return String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
const MARQUEE_SET = new Set(MARQUEE_DEFENDER_NAMES.map(normalizeName));

// --- HTTP helpers -----------------------------------------------------------
async function getJson(url, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'mfl-football/def-spotlight-sync' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

// Run tasks with bounded concurrency.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// --- Fetch steps ------------------------------------------------------------
async function fetchTeams() {
  const d = await getJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40');
  const teams = [];
  for (const sport of d.sports ?? []) {
    for (const league of sport.leagues ?? []) {
      for (const t of league.teams ?? []) {
        const team = t.team;
        if (team?.abbreviation && team?.id) {
          teams.push({ id: String(team.id), abbrev: team.abbreviation });
        }
      }
    }
  }
  return teams;
}

async function resolveSeason(sampleTeamId) {
  if (SEASON_OVERRIDE) return SEASON_OVERRIDE;
  // Most recent completed regular season. Before September, last year's season
  // is the most recent completed one; probe downward until leaders exist.
  const now = new Date();
  const startYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  for (let y = startYear; y >= startYear - 2; y--) {
    try {
      const d = await getJson(
        `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${y}/types/2/teams/${sampleTeamId}/leaders?lang=en&region=us`
      );
      const hasDefense = (d.categories ?? []).some(
        (c) => ['sacks', 'totalTackles', 'interceptions'].includes(c.name) && (c.leaders ?? []).length > 0
      );
      if (hasDefense) return y;
    } catch { /* try previous year */ }
  }
  return startYear;
}

async function fetchRosterDefenders(espnAbbr) {
  const d = await getJson(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnAbbr}/roster`
  );
  const defenders = [];
  for (const grp of d.athletes ?? []) {
    if (grp.position !== 'defense') continue;
    for (const a of grp.items ?? []) {
      const statusType = a.status?.type;
      if (statusType && statusType !== 'active') continue; // skip IR/PUP/retired
      defenders.push({
        espnId: String(a.id),
        name: a.displayName,
        position: a.position?.abbreviation || a.position?.parent?.abbreviation || 'DEF',
        experience: a.experience?.years ?? 0,
        headshot: a.headshot?.href || `https://a.espncdn.com/i/headshots/nfl/players/full/${a.id}.png`,
      });
    }
  }
  return defenders;
}

// Fetch one athlete's most-recent-season defensive stats and compute a
// playmaking-weighted score. Returns { score, gamesPlayed } (0 if no stats).
const DEFENSIVE_CATEGORIES = new Set(['defensive', 'defensiveInterceptions', 'general']);
async function scoreAthlete(espnId, season) {
  let data;
  try {
    data = await getJson(
      `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/athletes/${espnId}/statistics?lang=en&region=us`,
      { retries: 2 }
    );
  } catch {
    return { score: 0, gamesPlayed: 0 };
  }
  // Merge every defensive stat category into one flat name → value map.
  const flat = {};
  for (const cat of data.splits?.categories ?? []) {
    if (!DEFENSIVE_CATEGORIES.has(cat.name)) continue;
    for (const s of cat.stats ?? []) {
      if (typeof s.value === 'number') flat[s.name] = s.value;
    }
  }
  let score = 0;
  for (const [key, weight] of Object.entries(STAT_WEIGHTS)) {
    if (flat[key]) score += flat[key] * weight;
  }
  for (const [key, value] of Object.entries(flat)) {
    if (key.endsWith('Touchdowns') && value) score += value * TOUCHDOWN_WEIGHT;
  }
  return { score, gamesPlayed: flat.gamesPlayed || 0 };
}

// --- Main -------------------------------------------------------------------
async function main() {
  console.log('Fetching NFL teams…');
  const teams = await fetchTeams();
  const byAbbrev = new Map(teams.map((t) => [t.abbrev, t]));

  const sampleId = byAbbrev.get('DEN')?.id || teams[0]?.id;
  const season = await resolveSeason(sampleId);
  console.log(`Using season ${season} for production ranking.`);

  const targets = EXPECTED_TEAMS
    .map((app) => ({ app, espn: espnCode(app), id: byAbbrev.get(espnCode(app))?.id }))
    .filter((t) => t.id);

  const missing = EXPECTED_TEAMS.filter((app) => !byAbbrev.get(espnCode(app)));
  if (missing.length) console.warn(`⚠ No ESPN team match for: ${missing.join(', ')}`);

  // 1. Current rosters (defense group) for all teams.
  console.log(`Fetching rosters for ${targets.length} teams…`);
  const rosters = new Map();
  await mapLimit(targets, 8, async (t) => {
    const defenders = await fetchRosterDefenders(t.espn).catch((e) => {
      console.warn(`  roster ${t.app} failed: ${e.message}`);
      return [];
    });
    rosters.set(t.app, defenders);
  });

  // 2. Per-athlete season stats → score, for every rostered defender. Flattened
  //    into one big concurrency pool so the ~1.3k calls stay saturated.
  const allDefenders = targets.flatMap((t) => (rosters.get(t.app) || []).map((d) => ({ ...d, app: t.app })));
  console.log(`Scoring ${allDefenders.length} defenders (season ${season})…`);
  const scoreById = new Map();
  await mapLimit(allDefenders, 20, async (d) => {
    const { score, gamesPlayed } = await scoreAthlete(d.espnId, season);
    scoreById.set(d.espnId, { score, gamesPlayed });
  });

  // 3. Rank each team's current defenders and keep the top N with a live headshot.
  console.log('Ranking and validating headshots…');
  const teamsOut = {};
  let totalPlayers = 0;
  const thinTeams = [];
  const matchedMarquee = new Set(); // normalized names actually found on a roster

  await mapLimit(targets, 8, async (t) => {
    const defenders = rosters.get(t.app) || [];
    const ranked = defenders
      .map((d) => {
        const base = scoreById.get(d.espnId)?.score || 0;
        // Modest experience prior — nudges established veterans above no-name depth
        // at similar production, without overriding a genuine breakout.
        const prior = Math.min(d.experience, 10) * 0.5;
        const pinned = MARQUEE_SET.has(normalizeName(d.name));
        if (pinned) matchedMarquee.add(normalizeName(d.name));
        return { ...d, score: base + prior, pinned, posWeight: POSITION_WEIGHT[d.position] ?? 2 };
      })
      // Pro Bowl / All-Pro stars first (ordered among themselves by production),
      // then the stat-ranked field.
      .sort((a, b) =>
        (b.pinned - a.pinned) ||
        b.score - a.score ||
        b.experience - a.experience ||
        b.posWeight - a.posWeight ||
        a.name.localeCompare(b.name)
      );

    // Keep the best players whose headshot actually resolves, up to TOP_N.
    const kept = [];
    for (const d of ranked) {
      if (kept.length >= TOP_N) break;
      if (await headOk(d.headshot)) {
        kept.push({ name: d.name, espnId: d.espnId, position: d.position });
      }
    }
    teamsOut[t.app] = kept;
    totalPlayers += kept.length;
    if (kept.length < MIN_PER_TEAM) thinTeams.push(`${t.app}(${kept.length})`);
  });

  if (thinTeams.length) {
    console.warn(`⚠ Below ${MIN_PER_TEAM} players: ${thinTeams.join(', ')}`);
  }

  // Flag marquee names that matched no current roster — likely retired, or a
  // typo/renamed entry that needs attention at the next annual refresh.
  console.log(`Pinned ${matchedMarquee.size}/${MARQUEE_SET.size} marquee defenders to their teams.`);
  const unmatched = MARQUEE_DEFENDER_NAMES.filter((n) => !matchedMarquee.has(normalizeName(n)));
  if (unmatched.length) {
    console.warn(`⚠ Marquee names not found on any roster: ${unmatched.join(', ')}`);
  }

  // Sort team keys for a stable, reviewable diff.
  const sortedTeams = {};
  for (const code of EXPECTED_TEAMS) {
    if (teamsOut[code]?.length) sortedTeams[code] = teamsOut[code];
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    season,
    source: 'ESPN',
    note: 'Auto-generated by scripts/fetch-def-spotlight-players.mjs. Do not edit by hand.',
    teams: sortedTeams,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `\n✓ Wrote ${Object.keys(sortedTeams).length} teams / ${totalPlayers} players → ${path.relative(root, OUT_PATH)}`
  );
}

main().catch((err) => {
  console.error('fetch-def-spotlight-players failed:', err);
  process.exit(1);
});
