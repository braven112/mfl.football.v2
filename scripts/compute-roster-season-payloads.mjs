#!/usr/bin/env node
/**
 * Precompute the historical roster-season payloads for /theleague/rosters.
 *
 * The rosters page used to rebuild the enriched payload for ALL ~20 seasons
 * on EVERY request, and its all-years import.meta.glob calls baked 30+ MB of
 * feed JSON into the server chunk. Historical seasons are frozen data — the
 * 2015 payload can only change if this code changes — so they are a build
 * artifact, not a request-time computation (same reasoning as
 * compute-player-identity-union.mjs).
 *
 * For every season with a src/data/mfl-player-salaries-<year>.json EXCEPT
 * the current league year and current season year (the page still builds
 * those live, with Redis roster cache / live odds / injuries / trade bait),
 * this script rebuilds the exact per-season context the page used to build
 * from its globs — players.json, rosters.json, league.json, standings.json,
 * salaryAdjustments.json — and runs the shared
 * scripts/lib/roster-season-payload.mjs#buildSeasonPayload over it.
 *
 * Live-only inputs are empty/neutral for historical seasons: no odds, no
 * weekly scores, no injuries, no projections, no trade bait. (Previously the
 * CURRENT season's odds/scores/injuries leaked into historical payloads via
 * the payload builder's `?? …[currentSeasonYearStr]` fallbacks; frozen
 * seasons now render the '-'/null/'BYE' neutral values instead, which is the
 * correct presentation for a season that ended years ago.)
 *
 * Output: data/theleague/derived/roster-season-payloads.json
 *   { generatedAt, seasons: { '<year>': <payload> } }
 *
 * The file is committed (CLAUDE.md precedent: derived files like
 * franchise-history.json). Content-stable: the write is skipped when the
 * seasons content is unchanged so `generatedAt` doesn't churn the diff on
 * every prebuild.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
import {
  buildSeasonPayload,
  buildSeasonRecords,
  buildSeasonLeagueMeta,
  buildSeasonSalaryAdjustments,
  indexPlayersFeed,
  indexRosterFeed,
} from './lib/roster-season-payload.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEAGUE = getLeagueBySlug(DEFAULT_LEAGUE_SLUG);
const DATA_DIR = join(ROOT, LEAGUE.dataPath);
const FEEDS_DIR = join(DATA_DIR, 'mfl-feeds');
const SALARY_DIR = join(ROOT, 'src', 'data');
const OUT_PATH = join(DATA_DIR, 'derived', 'roster-season-payloads.json');

const readJson = (path) => {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn(`[roster-season-payloads] failed to read ${path}: ${e.message}`);
  }
  return null;
};

const loadFeedJson = (year, filename) => readJson(join(FEEDS_DIR, String(year), filename));

// ── Player identity map — on-disk port of src/utils/player-map.ts ──────────
// buildSeasonPayload reads identity.{name,position,nflTeam,espnId,headshot};
// buildSeasonSalaryAdjustments reads identity.{name,espnId,headshot}. The
// logic below mirrors getPlayerMap/toIdentity exactly for those fields.

/** Mirrors FANTASY_POSITIONS in src/utils/player-map.ts. */
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'Def']);

/** Mirrors TEAM_CODE_MAP in src/utils/nfl-logo.ts (identity map's normalizer). */
const IDENTITY_TEAM_CODE_MAP = {
  'WAS': 'WSH', 'JAC': 'JAX', 'GBP': 'GB', 'KCC': 'KC', 'NEP': 'NE',
  'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB', 'LVR': 'LV', 'HST': 'HOU',
  'BLT': 'BAL', 'CLV': 'CLE', 'ARZ': 'ARI', 'OAK': 'LV', 'SDC': 'LAC',
  'SD': 'LAC', 'RAM': 'LAR', 'STL': 'LAR', 'FA': 'NFL', 'FA*': 'NFL',
  'UFA': 'NFL',
};

const identityNormalizeTeamCode = (teamCode) => {
  if (!teamCode) return '';
  const upper = teamCode.toUpperCase();
  return IDENTITY_TEAM_CODE_MAP[upper] || upper;
};

// Photo host mirrors src/constants/roster-constants.ts#MFL_PHOTO_HOST — the
// default league's registry host is the canonical photo host for every league.
const MFL_PHOTO_HOST = LEAGUE.mflHost;
const DEFAULT_HEADSHOT_URL = `https://${MFL_PHOTO_HOST}/player_photos_2010/no_photo_available.jpg`;
const getPlayerImageUrl = (playerId) =>
  playerId
    ? `https://${MFL_PHOTO_HOST}/player_photos_big_2014/${playerId}_thumb.jpg`
    : DEFAULT_HEADSHOT_URL;
const getPlayerHeadshot = (mflId, espnId) => {
  if (espnId) return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  return getPlayerImageUrl(mflId);
};
const getCollegeHeadshot = (espnId) =>
  `https://a.espncdn.com/i/headshots/college-football/players/full/${espnId}.png`;

/** Mirrors formatName in src/utils/player-map.ts. */
const formatName = (mflName, position) => {
  const commaIndex = mflName.indexOf(',');
  if (commaIndex === -1) return mflName;
  const part1 = mflName.slice(0, commaIndex).trim();
  const part2 = mflName.slice(commaIndex + 1).trim();
  if (position === 'Def' || position === 'DEF') {
    return `${part2} ${part1}`;
  }
  return `${part2} ${part1}`;
};

const espnCollegeIds = readJson(join(DATA_DIR, 'espn-college-ids.json')) ?? {};
const collegeIdMap = espnCollegeIds.players || {};

/** Mirrors toIdentity in src/utils/player-map.ts (identity fields only). */
const toIdentity = (p) => {
  const position = p.position || '';
  if (!FANTASY_POSITIONS.has(position)) return null;

  const mflId = p.id;
  const nflEspnId = p.espn_id || '';
  const collegeEspnId = collegeIdMap[mflId]?.espnCollegeId || '';
  const espnId = p.espn_id || collegeIdMap[mflId]?.espnCollegeId || null;
  const headshot = nflEspnId
    ? getPlayerHeadshot(mflId, nflEspnId)
    : collegeEspnId
      ? getCollegeHeadshot(collegeEspnId)
      : getPlayerImageUrl(mflId);

  return {
    mflId,
    name: formatName(p.name || '', position),
    position: position === 'Def' ? 'DEF' : position,
    nflTeam: identityNormalizeTeamCode(p.team || ''),
    headshot,
    espnId,
    draftYear: p.draft_year || '',
  };
};

const identityCache = new Map();
const getIdentityMap = (year) => {
  const cached = identityCache.get(year);
  if (cached) return cached;
  const playerMap = new Map();
  const raw = loadFeedJson(year, 'players.json');
  const players = raw?.players?.player || [];
  for (const p of players) {
    const identity = toIdentity(p);
    if (identity) playerMap.set(identity.mflId, identity);
  }
  identityCache.set(year, playerMap);
  return playerMap;
};

// ── College assets — mirrors the page's collegeLogosNormalized lookup ──────

const collegeLogos = readJson(join(ROOT, 'src', 'data', 'college-logos.json')) ?? {};
const collegeLogosNormalized = Object.fromEntries(
  Object.entries(collegeLogos).map(([name, data]) => [name.toLowerCase(), data])
);
const getCollegeAssets = (collegeName) => {
  if (!collegeName) return null;
  return collegeLogosNormalized[collegeName.toLowerCase()] ?? null;
};

// ── Season discovery ───────────────────────────────────────────────────────

const { currentLeagueYear, currentSeasonYear } = getCurrentYears();
const liveYears = new Set([String(currentLeagueYear), String(currentSeasonYear)]);

const salaryYears = readdirSync(SALARY_DIR)
  .map((name) => name.match(/^mfl-player-salaries-(\d{4})\.json$/)?.[1])
  .filter(Boolean)
  .sort();

const historicalYears = salaryYears.filter((year) => !liveYears.has(year));

if (!historicalYears.length) {
  console.error('[roster-season-payloads] no historical salary years found — refusing to write');
  process.exit(1);
}

// ── Build the per-season context from committed feeds, then the payloads ───

/**
 * Exported for the golden-master check: build the exact historical context
 * for the given seasons.
 */
export const buildHistoricalContext = (years) => {
  const playersFeedBySeason = {};
  const liveRosterDataByPlayerId = {};
  const leagueMetaBySeason = {};
  const feedSalaryAdjustmentsBySeason = {};
  const recordsBySeason = {};

  for (const year of years) {
    const playersFeed = indexPlayersFeed(loadFeedJson(year, 'players.json'));
    if (playersFeed) playersFeedBySeason[year] = playersFeed;

    const rosterIndex = indexRosterFeed(loadFeedJson(year, 'rosters.json'));
    if (rosterIndex) liveRosterDataByPlayerId[year] = rosterIndex;

    const leagueMeta = buildSeasonLeagueMeta(loadFeedJson(year, 'league.json'));
    if (leagueMeta) leagueMetaBySeason[year] = leagueMeta;

    const adjustments = buildSeasonSalaryAdjustments(
      loadFeedJson(year, 'salaryAdjustments.json'),
      getIdentityMap(Number(year))
    );
    if (adjustments) feedSalaryAdjustmentsBySeason[year] = adjustments;

    const records = buildSeasonRecords(loadFeedJson(year, 'standings.json'));
    if (records) recordsBySeason[year] = records;
  }

  return {
    playersFeedBySeason,
    getIdentityMap,
    liveRosterDataByPlayerId,
    // Live-only inputs are empty/neutral for historical seasons. Note the
    // payload builder's `?? projectedScoresBySeason[currentSeasonYearStr]`
    // fallback resolves to {} here — exactly what the page produced for
    // historical seasons when no current data existed.
    projectedScoresBySeason: {},
    currentSeasonYearStr: String(currentSeasonYear),
    currentLeagueYear,
    liveOddsData: {},
    isDemoMode: false,
    fantasyPointsAllowedBySeason: {},
    trendWeeks: [],
    playerScoresMap: new Map(),
    espnCollegeIds,
    getPlayerHeadshot,
    getCollegeAssets,
    mflInjuryData: {},
    recordsBySeason,
    leagueMetaBySeason,
    feedSalaryAdjustmentsBySeason,
  };
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const context = buildHistoricalContext(historicalYears);

  const seasons = {};
  for (const year of historicalYears) {
    const rawData = readJson(join(SALARY_DIR, `mfl-player-salaries-${year}.json`));
    if (!rawData) {
      console.warn(`[roster-season-payloads] missing salary file for ${year} — skipping`);
      continue;
    }
    // tradeBait is a live-write surface; historical seasons get an empty set
    // (matching the page, which only ever loaded trade bait for the current
    // league/season years).
    seasons[year] = buildSeasonPayload(context, year, rawData, new Set());
  }

  const seasonKeys = Object.keys(seasons);
  if (!seasonKeys.length) {
    console.error('[roster-season-payloads] built zero seasons — refusing to write');
    process.exit(1);
  }
  for (const year of seasonKeys) {
    const teamCount = Object.keys(seasons[year].teams).length;
    if (!teamCount) {
      console.error(`[roster-season-payloads] season ${year} has no teams — refusing to write`);
      process.exit(1);
    }
  }

  // Skip the write when content is unchanged so `generatedAt` doesn't churn
  // the committed file on every prebuild.
  const existing = readJson(OUT_PATH);
  const nextSeasonsJson = JSON.stringify(seasons);
  if (existing?.seasons && JSON.stringify(existing.seasons) === nextSeasonsJson) {
    console.log(`[roster-season-payloads] unchanged (${seasonKeys.length} seasons) — skipping write`);
  } else {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(
      OUT_PATH,
      JSON.stringify({ generatedAt: new Date().toISOString(), seasons }, null, 1)
    );
    const bytes = readFileSync(OUT_PATH).length;
    console.log(
      `[roster-season-payloads] ${seasonKeys.length} seasons ` +
        `(${seasonKeys[0]}–${seasonKeys[seasonKeys.length - 1]}, live years ${[...liveYears].join('/')} excluded) ` +
        `→ ${(bytes / 1048576).toFixed(2)} MB`
    );
  }
}
