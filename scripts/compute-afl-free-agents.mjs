#!/usr/bin/env node
/**
 * Compute the AFL Free Agents snapshot → data/afl-fantasy/derived/free-agents.json.
 *
 * Why this exists (load-bearing — read before editing):
 *
 * The page src/pages/afl-fantasy/players.astro MUST be server-rendered (SSR),
 * not prerendered: the apex-domain middleware (src/middleware.ts) rewrites
 * www.afl-fantasy.com/players → /afl-fantasy/players via context.rewrite(),
 * which only resolves to routes registered in the SSR function. A prerendered
 * target is a static CDN file with no SSR route, so the rewrite 404s (that was
 * the original apex bug).
 *
 * But an SSR page that eager-globs every year of AFL feeds
 * (data/afl-fantasy/mfl-feeds/*​/{players,weekly-results-raw}.json — ~50MB
 * across 24 years) bundles all of it into the shared `_render` serverless
 * function, which already runs near Vercel's 250MB limit (see
 * docs/claude/insights/domains/deployment.md). Prerendering dodged that by
 * running the globs at build time — but broke apex routing.
 *
 * Resolution: do the heavy multi-year read HERE, at build time, in a node
 * script whose fs reads are NOT traced into the serverless function. We emit a
 * single small derived JSON (just the finished free-agent rows + counts), and
 * the SSR page imports that one file. Routing works (SSR) and the function
 * stays at ~baseline size (the page contributes ~1MB, not ~15MB of globs).
 *
 * This mirrors the derived-data pattern already used for
 * data/theleague/derived/franchise-history.json and
 * data/afl-fantasy/resolved-events.json — regenerated every deploy in prebuild.
 *
 * Usage: node scripts/compute-afl-free-agents.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Mirror astro.config.ts: hydrate process.env from .env / .env.local so this
// standalone Node script resolves PUBLIC_BASE_YEAR / PUBLIC_MFL_YEAR exactly the
// way the app does via import.meta.env (real environment variables always win).
// On Vercel those vars are already in process.env; this only matters for local
// .env-file-driven runs, so the derived snapshot picks the same season year the
// page would have.
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', ROOT, '');
for (const [k, v] of Object.entries(fileEnv)) process.env[k] ??= v;

const aflLeague = getLeagueBySlug('afl-fantasy');
const FEEDS_DIR = path.join(ROOT, aflLeague.dataPath, 'mfl-feeds');
const OUTPUT_DIR = path.join(ROOT, aflLeague.dataPath, 'derived');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'free-agents.json');
const COLLEGE_LOGOS_PATH = path.join(ROOT, 'src/data/college-logos.json');
// Intentionally cross-league: AFL free-agent computation reuses TheLeague's
// ESPN college-id mapping since it's a shared static reference dataset, not
// per-league MFL data — only the path prefix is sourced from the registry.
const ESPN_COLLEGE_IDS_PATH = path.join(ROOT, getLeagueBySlug('theleague').dataPath, 'espn-college-ids.json');

const mflHost = aflLeague.mflHost;

// ── Season-year math (ported from src/utils/league-year.ts; keep in sync) ──
// Labor Day = first Monday in September.
function getLaborDay(year) {
  const septemberFirst = new Date(year, 8, 1);
  const dayOfWeek = septemberFirst.getDay();
  const daysUntilMonday = dayOfWeek === 1 ? 0 : (8 - dayOfWeek) % 7;
  return new Date(year, 8, 1 + daysUntilMonday);
}
function calculateBaseYear(date) {
  const calendarYear = date.getFullYear();
  return date >= getLaborDay(calendarYear) ? calendarYear : calendarYear - 1;
}
// getCurrentSeasonYear(): the last completed NFL season, advancing on Labor Day.
// Honors the same PUBLIC_BASE_YEAR / PUBLIC_MFL_YEAR overrides the app reads via
// import.meta.env (Astro sources those from process.env at build), so the build
// script and the page resolve the same year.
function getCurrentSeasonYear(date = new Date()) {
  const envBaseYear = process.env.PUBLIC_BASE_YEAR || process.env.PUBLIC_MFL_YEAR;
  const baseYear = envBaseYear ? parseInt(envBaseYear, 10) : calculateBaseYear(date);
  return date >= getLaborDay(date.getFullYear()) ? baseYear + 1 : baseYear;
}

// ── JSON helpers ──
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
};
const readFeed = (year, file) => readJson(path.join(FEEDS_DIR, String(year), file));

const collegeLogos = readJson(COLLEGE_LOGOS_PATH) ?? {};
const espnCollegeIds = readJson(ESPN_COLLEGE_IDS_PATH) ?? {};

// College logo lookup (case-insensitive)
const collegeLogosNormalized = Object.fromEntries(
  Object.entries(collegeLogos).map(([name, data]) => [name.toLowerCase(), data])
);
function getCollegeLogo(collegeName) {
  if (!collegeName) return null;
  const entry = collegeLogosNormalized[collegeName.toLowerCase()];
  return entry?.logo ?? null;
}

// MFL team code → local SVG filename normalization
const MFL_TEAM_CODE_MAP = {
  GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO',
  SFO: 'SF', TBB: 'TB', LVR: 'LV', HST: 'HOU',
  BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI', JAC: 'JAX',
};
function normalizeMflTeam(code) {
  if (!code) return 'FA';
  return MFL_TEAM_CODE_MAP[code] || code;
}

// ── Resolve years ──
// currentYear: most recent season whose rosters feed actually carries
// franchises (skips empty/errored placeholder years MFL leaves pre-season).
function resolveCurrentYear() {
  const years = fs
    .readdirSync(FEEDS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => parseInt(d.name, 10))
    .sort((a, b) => b - a);
  for (const yr of years) {
    const rosters = readFeed(yr, 'rosters.json');
    if (rosters?.rosters?.franchise) return yr;
  }
  // No season has a populated rosters feed — fall back to the season year
  // (matches the old page: `availableYears[0] ?? getCurrentSeasonYear()`, where
  // availableYears only counted years whose rosters feed carried franchises).
  return getCurrentSeasonYear();
}

const currentYear = resolveCurrentYear();
const seasonYear = getCurrentSeasonYear();

const playersData = readFeed(currentYear, 'players.json');
const rostersData = readFeed(currentYear, 'rosters.json');
const projectedScoresData = readFeed(currentYear, 'projectedScores.json');
const adpDynastyData = readFeed(currentYear, 'adp-dynasty.json');
const lastYearData = readFeed(seasonYear, 'weekly-results-raw.json');

// Dynasty ADP (current year only)
const adpDynMap = new Map();
{
  const players = adpDynastyData?.adp?.player
    ? (Array.isArray(adpDynastyData.adp.player) ? adpDynastyData.adp.player : [adpDynastyData.adp.player])
    : [];
  for (const p of players) {
    if (p?.id && p?.averagePick) {
      const pick = parseFloat(p.averagePick);
      if (pick > 0) adpDynMap.set(p.id, pick);
    }
  }
}

// Projected points
const projectedMap = new Map();
if (projectedScoresData?.projectedScores?.playerScore) {
  const scores = Array.isArray(projectedScoresData.projectedScores.playerScore)
    ? projectedScoresData.projectedScores.playerScore
    : [projectedScoresData.projectedScores.playerScore];
  for (const s of scores) {
    if (s?.id && s?.score) {
      const score = parseFloat(s.score);
      if (score > 0) projectedMap.set(s.id, score);
    }
  }
}

// Last completed season's total points + games played (from weekly results)
const lastYrPtsMap = new Map();
const lastYrGamesMap = new Map();
if (Array.isArray(lastYearData)) {
  for (const weekPayload of lastYearData) {
    const matchups = weekPayload?.weeklyResults?.matchup;
    if (!matchups) continue;
    const matchupArr = Array.isArray(matchups) ? matchups : [matchups];
    for (const m of matchupArr) {
      const franchises = m?.franchise ? (Array.isArray(m.franchise) ? m.franchise : [m.franchise]) : [];
      for (const f of franchises) {
        const players = f?.player ? (Array.isArray(f.player) ? f.player : [f.player]) : [];
        for (const p of players) {
          if (!p?.id || !p?.score) continue;
          const score = parseFloat(p.score);
          if (!isNaN(score) && score > 0) {
            lastYrPtsMap.set(p.id, (lastYrPtsMap.get(p.id) || 0) + score);
            lastYrGamesMap.set(p.id, (lastYrGamesMap.get(p.id) || 0) + 1);
          }
        }
      }
    }
  }
}

// Rostered player set (AFL has no salaries/contracts — membership only)
const rosteredIds = new Set();
if (rostersData?.rosters?.franchise) {
  const franchises = Array.isArray(rostersData.rosters.franchise)
    ? rostersData.rosters.franchise
    : [rostersData.rosters.franchise];
  for (const franchise of franchises) {
    const rosterPlayers = franchise?.player
      ? (Array.isArray(franchise.player) ? franchise.player : [franchise.player])
      : [];
    for (const p of rosterPlayers) {
      if (p?.id) rosteredIds.add(p.id);
    }
  }
}

// Fantasy-relevant positions (AFL is offense + K + team DEF, no IDP)
const fantasyPositions = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'Def', 'DEF']);

const allPlayers = playersData?.players?.player;
const playerList = [];

if (Array.isArray(allPlayers)) {
  const now = Date.now() / 1000;
  for (const p of allPlayers) {
    if (!p?.id || !p?.name || !p?.position) continue;
    if (!fantasyPositions.has(p.position)) continue;

    const pos = p.position === 'Def' ? 'DEF' : p.position;

    // MFL name "Last, First" → "First Last" (DEF "Bills, Buffalo" → "Buffalo Bills")
    const nameParts = p.name.split(', ');
    const displayName = nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : p.name;

    let age = null;
    if (p.birthdate) {
      const birthTimestamp = parseInt(p.birthdate, 10);
      if (birthTimestamp > 0) {
        age = Math.floor((now - birthTimestamp) / (365.25 * 24 * 60 * 60));
      }
    }

    const draftYr = p.draft_year ? parseInt(p.draft_year, 10) : null;
    const exp = draftYr && draftYr > 0 ? currentYear - draftYr : null;
    const draftRd = p.draft_round ? parseInt(p.draft_round, 10) : null;

    let heightInches = null;
    let weightLbs = null;
    if (p.height) {
      const inches = parseInt(p.height, 10);
      if (inches > 0) heightInches = inches;
    }
    if (p.weight) weightLbs = parseInt(p.weight, 10) || null;

    const pts = lastYrPtsMap.get(p.id);
    const gp = lastYrGamesMap.get(p.id);

    playerList.push({
      id: p.id,
      name: displayName,
      position: pos,
      team: normalizeMflTeam(p.team || ''),
      // Team defenses have no birthdate/draft year; give them neutral
      // placeholder age/experience so age- and exp-range filters don't drop
      // every DEF (mirrors the sibling theleague/players page).
      age: pos === 'DEF' ? 25 : age,
      espnId: p.espn_id || espnCollegeIds.players?.[p.id]?.espnCollegeId || null,
      projected: projectedMap.get(p.id) ?? null,
      rostered: rosteredIds.has(p.id),
      exp: pos === 'DEF' ? 5 : exp,
      draftRd: (draftRd && draftRd > 0) ? draftRd : null,
      college: p.college || null,
      collegeLogo: getCollegeLogo(p.college),
      height: heightInches,
      weight: weightLbs,
      adpDyn: adpDynMap.get(p.id) ?? null,
      lastYrPts: pts != null ? Math.round(pts * 10) / 10 : null,
      games: gp ?? null,
      ppg: (pts && gp && gp > 0) ? Math.round((pts / gp) * 10) / 10 : null,
      rookie: p.status === 'R',
      birthdate: p.birthdate ? parseInt(p.birthdate, 10) : null,
      jersey: p.jersey || null,
      draftYear: draftYr,
      draftTeam: p.draft_team || null,
      draftPick: p.draft_pick ? parseInt(p.draft_pick, 10) : null,
    });
  }
}

const hasProjected = projectedMap.size > 0;
const hasLastYrPts = lastYrPtsMap.size > 0;
const hasAdp = adpDynMap.size > 0;

// Default sort: projected points when available, else dynasty ADP, else last-year pts.
const defaultSort = hasProjected ? 'projected' : (hasAdp ? 'adpDyn' : 'lastYrPts');
const defaultDir = defaultSort === 'adpDyn' ? 'asc' : 'desc';
playerList.sort((a, b) => {
  if (defaultSort === 'adpDyn') {
    const aVal = a.adpDyn ?? Infinity;
    const bVal = b.adpDyn ?? Infinity;
    return aVal - bVal;
  }
  const aVal = a[defaultSort] ?? -1;
  const bVal = b[defaultSort] ?? -1;
  return bVal - aVal;
});

// Count free agents by position for the category pills
const freeAgents = playerList.filter((p) => !p.rostered);
const faCounts = { ALL: freeAgents.length };
for (const p of freeAgents) {
  faCounts[p.position] = (faCounts[p.position] || 0) + 1;
}

// Initial hero spotlight: top free agent by the default sort.
const top = freeAgents[0] ?? null;
const topFa = top
  ? {
      id: top.id,
      name: top.name,
      position: top.position,
      team: top.team,
      espnId: top.espnId,
      projected: top.projected,
    }
  : null;

// Unique NFL teams for the team filter dropdown
const nflTeamsSet = new Set();
for (const p of playerList) {
  if (p.team && p.team !== 'FA') nflTeamsSet.add(p.team);
}
const nflTeamsList = [...nflTeamsSet].sort();

const output = {
  generatedForYear: currentYear,
  seasonYear,
  mflHost,
  hasProjected,
  hasLastYrPts,
  hasAdp,
  defaultSort,
  defaultDir,
  faCounts,
  nflTeamsList,
  topFa,
  players: playerList,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output) + '\n');
console.log(
  `[compute-afl-free-agents] year=${currentYear} season=${seasonYear} ` +
    `players=${playerList.length} freeAgents=${freeAgents.length} → ${path.relative(ROOT, OUTPUT_PATH)}`
);
