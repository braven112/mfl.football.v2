/**
 * Pull core MFL feeds (rosters, players, salary adjustments, draft results, transactions)
 * and write them into data/<league>/mfl-feeds/<year>/.
 *
 * Caching strategy:
 * - Current year: Fetches daily (data changes throughout season)
 * - Historical years: Caches indefinitely once standings.json exists (static data)
 *   Use --force flag to override and refetch historical data
 *
 * Usage:
 *   node scripts/fetch-mfl-feeds.js [--force]
 *
 * Env variables:
 *   MFL_LEAGUE_ID (required) - e.g., 13522
 *   MFL_YEAR (optional) - defaults to current year
 *   MFL_WEEK (optional) - defaults to 'YTD'
 *   MFL_HOST (optional) - defaults to https://api.myfantasyleague.com
 *   MFL_USER_ID (optional) - MFL user ID for authenticated requests
 *   MFL_APIKEY (optional) - MFL API key for authenticated requests (used for assets endpoint)
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWeeklyResults } from './lib/normalize-weekly-results.mjs';
import { fetchWithRetry } from './lib/fetch-retry.mjs';
import { getNonEmpty } from './lib/env.mjs';
import { getLeagueById, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';

/**
 * Calculate Labor Day for a given year (first Monday in September)
 */
const getLaborDay = (year) => {
  const septemberFirst = new Date(year, 8, 1); // Month 8 = September (0-indexed)
  const dayOfWeek = septemberFirst.getDay(); // 0 = Sunday, 1 = Monday, etc.

  let daysUntilMonday;
  if (dayOfWeek === 1) {
    daysUntilMonday = 0; // Sept 1st is already Monday
  } else if (dayOfWeek === 0) {
    daysUntilMonday = 1; // Sept 1st is Sunday, Labor Day is Sept 2nd
  } else {
    daysUntilMonday = 8 - dayOfWeek; // Days until next Monday
  }

  return new Date(year, 8, 1 + daysUntilMonday, 0, 0, 0, 0);
};

/**
 * Calculate base year automatically based on current date
 * Base year = last completed NFL season (same logic as league-year.ts)
 *
 * Logic:
 * - If today is before Labor Day: base year = previous calendar year
 * - If today is after Labor Day: base year = current calendar year
 */
const calculateBaseYear = (date) => {
  const calendarYear = date.getFullYear();
  const laborDay = getLaborDay(calendarYear);
  return date >= laborDay ? calendarYear : calendarYear - 1;
};

/**
 * Get years to fetch based on current date and league calendar
 * Returns { currentLeagueYear, currentSeasonYear, yearsToFetch }
 */
const getYearsToFetch = () => {
  const now = new Date();

  // Priority: explicit env var > auto-calculate based on Labor Day
  const envYear = getNonEmpty(process.env.PUBLIC_BASE_YEAR) ||
    getNonEmpty(process.env.MFL_YEAR) ||
    getNonEmpty(process.env.MFL_SEASON);

  const baseYear = envYear
    ? parseInt(envYear, 10)
    : calculateBaseYear(now);

  // Feb 14th @ 8:45 PT cutoff (16:45 UTC in PST)
  const febCutoff = new Date(now.getFullYear(), 1, 14, 16, 45, 0, 0);

  // Labor Day cutoff (first Monday in September)
  const laborDay = getLaborDay(now.getFullYear());

  let currentLeagueYear = baseYear;
  let currentSeasonYear = baseYear;

  // After Feb 14th @ 8:45 PT, league year advances (rosters move to new MFL league)
  if (now >= febCutoff) {
    currentLeagueYear = baseYear + 1;
  }

  // After Labor Day, season year advances (standings/playoffs show new season)
  if (now >= laborDay) {
    currentSeasonYear = baseYear + 1;
  }

  // During Feb 14 - Labor Day window, fetch BOTH years
  const yearsToFetch = currentLeagueYear === currentSeasonYear
    ? [currentLeagueYear]
    : [currentLeagueYear, currentSeasonYear];

  return {
    currentLeagueYear,
    currentSeasonYear,
    yearsToFetch: [...new Set(yearsToFetch)], // Remove duplicates
  };
};

const leagueId = getNonEmpty(process.env.MFL_LEAGUE_ID);
if (!leagueId) {
  console.error('Missing MFL_LEAGUE_ID env var');
  process.exit(1);
}
const leagueKey = getNonEmpty(process.env.MFL_LEAGUE_SLUG) || leagueId;

// Determine league name for output directory
// MFL_LEAGUE_NAME env var or default based on league ID
const leagueName = getNonEmpty(process.env.MFL_LEAGUE_NAME) || getLeagueById(leagueId)?.slug || DEFAULT_LEAGUE_SLUG;

// Determine which year(s) to fetch based on league calendar
// If MFL_YEAR is explicitly set, use that (manual override)
// Otherwise, use intelligent year logic based on current date
const manualYear = getNonEmpty(process.env.MFL_YEAR) || getNonEmpty(process.env.MFL_SEASON);
const yearConfig = getYearsToFetch();

// Use manual year if provided, otherwise use currentLeagueYear
const year = manualYear || yearConfig.currentLeagueYear.toString();

// Log dual-year window info
if (!manualYear && yearConfig.yearsToFetch.length > 1) {
  console.log(`📅 Dual-year window detected (Feb 14 - Labor Day):`);
  console.log(`   League Year: ${yearConfig.currentLeagueYear} (rosters, contracts)`);
  console.log(`   Season Year: ${yearConfig.currentSeasonYear} (standings, playoffs)`);
  console.log(`   Fetching: ${year}`);
  console.log(`   Note: Run with MFL_YEAR=${yearConfig.currentSeasonYear} to fetch the other year if needed`);
}

// Only include a week param when explicitly provided; otherwise let MFL serve latest/YTD.
const week = getNonEmpty(process.env.MFL_WEEK) || null;
const host = getNonEmpty(process.env.MFL_HOST) || 'https://api.myfantasyleague.com';
const mflUserId = getNonEmpty(process.env.MFL_USER_ID);
// Accept both spellings — the roster-sync workflow exports MFL_API_KEY while
// this script historically read MFL_APIKEY, so the key silently never applied.
const mflApiKey = getNonEmpty(process.env.MFL_APIKEY) || getNonEmpty(process.env.MFL_API_KEY);

const outDir = path.join('data', leagueName, 'mfl-feeds', year);
fs.mkdirSync(outDir, { recursive: true });
const metaFile = path.join(outDir, 'fetch.meta.json');
const rosterHistoryDir = path.join(outDir, 'roster-history');
const force = process.argv.includes('--force');

const isFreshToday = () => {
  if (!fs.existsSync(metaFile)) return false;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const last = new Date(meta.lastFetched);
    const now = new Date();
    return (
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate()
    );
  } catch (_err) {
    return false;
  }
};

const isHistoricalDataCached = () => {
  // Check if this is a historical year (older than current year)
  const currentYear = new Date().getFullYear();
  const fetchYear = parseInt(year, 10);

  if (fetchYear >= currentYear) {
    return false; // Current or future year - always fetch
  }

  // Historical year - check if standings.json exists and is valid
  const standingsFile = path.join(outDir, 'standings.json');
  if (!fs.existsSync(standingsFile)) {
    return false; // File doesn't exist, need to fetch
  }

  try {
    const data = JSON.parse(fs.readFileSync(standingsFile, 'utf8'));
    // Check if standings data looks valid
    return data && data.leagueStandings && Array.isArray(data.leagueStandings.franchise);
  } catch (_err) {
    return false; // Invalid data, need to refetch
  }
};

const isPlayoffDataFresh = () => {
  const playoffFile = path.join(outDir, 'playoff-brackets.json');

  if (!fs.existsSync(playoffFile)) {
    return false; // File doesn't exist, need to fetch
  }

  try {
    const data = JSON.parse(fs.readFileSync(playoffFile, 'utf8'));

    // Check if we have a lastFetched timestamp
    if (!data.lastFetched) {
      return false; // No timestamp, need to fetch
    }

    const lastFetched = new Date(data.lastFetched);
    const now = new Date();
    const hoursSinceLastFetch = (now - lastFetched) / (1000 * 60 * 60);

    // Consider fresh if fetched within last hour
    return hoursSinceLastFetch < 1;
  } catch (err) {
    console.warn('Error checking playoff data freshness:', err.message);
    return false; // Error reading file, need to fetch
  }
};

const withWeek = (baseUrl) => (week ? `${baseUrl}&W=${week}` : baseUrl);

const withAuth = (baseUrl) => {
  // Add authentication to requests that require it (e.g., assets)
  if (mflApiKey) {
    return `${baseUrl}&APIKEY=${encodeURIComponent(mflApiKey)}`;
  }
  return baseUrl;
};

const parseTradeBait = (data) => {
  // Handle MFL trade bait API response
  // Structure: { tradeBaits: { tradeBait: [ { willGiveUp: "id1,id2,id3", ... }, ... ] } }
  // NOTE: MFL returns a single object (not an array) when only one franchise has trade bait
  const playerIds = new Set();

  if (typeof data === 'object' && data !== null) {
    let tradeBaitArray = data?.tradeBaits?.tradeBait;
    // MFL returns a single object when only one franchise has trade bait — normalize to array
    if (tradeBaitArray && !Array.isArray(tradeBaitArray)) {
      tradeBaitArray = [tradeBaitArray];
    }
    if (Array.isArray(tradeBaitArray)) {
      tradeBaitArray.forEach((item) => {
        if (item.willGiveUp) {
          // willGiveUp can be a comma-separated string of player IDs
          const ids = typeof item.willGiveUp === 'string'
            ? item.willGiveUp.split(',').map(id => id.trim())
            : [item.willGiveUp];

          ids.forEach((id) => {
            // Valid MFL player IDs are 4+ digits (reject IDs like 0522 which are formatting errors)
            if (id && /^\d{4,}$/.test(id)) {
              playerIds.add(id);
            }
          });
        }
      });
    }
  }

  return Array.from(playerIds);
};

// Per-franchise trade bait, same shape scripts/fetch-trade-bait.mjs writes.
// The flat tradeBait.json can't attribute a flag to a franchise, which
// matters in AFL where both conferences roster the same NFL player pool —
// a flat id set would show the player as "on the block" for two teams when
// only one flagged him.
const parseTradeBaitByFranchise = (data) => {
  const byFranchise = {};
  let tradeBaitArray = data?.tradeBaits?.tradeBait;
  if (tradeBaitArray && !Array.isArray(tradeBaitArray)) {
    tradeBaitArray = [tradeBaitArray];
  }
  if (!Array.isArray(tradeBaitArray)) return byFranchise;

  for (const item of tradeBaitArray) {
    const franchiseId = String(
      item?.franchise_id ?? item?.franchiseId ?? item?.franchise ?? '',
    ).trim();
    if (!franchiseId) continue;

    const rawIds = typeof item?.willGiveUp === 'string'
      ? item.willGiveUp.split(',').map((id) => id.trim())
      : item?.willGiveUp != null ? [String(item.willGiveUp)] : [];

    byFranchise[franchiseId] = {
      playerIds: rawIds.filter((id) => /^\d{4,}$/.test(id)),
      willGiveUpComment: typeof item?.willGiveUpComments === 'string'
        ? item.willGiveUpComments.trim()
        : '',
      willTakeComment: typeof item?.willTakeComments === 'string'
        ? item.willTakeComments.trim()
        : '',
    };
  }
  return byFranchise;
};

const writeTradeBaitByFranchise = (data, flatIds) => {
  const file = path.join(outDir, 'tradeBait-by-franchise.json');
  const franchises = parseTradeBaitByFranchise(data);

  // Guard: zero franchises while the flat list has ids means the response
  // carried entries we failed to attribute — don't clobber a good snapshot
  // with `franchises: {}` (pages prefer this file over the flat list, so an
  // empty-but-valid file silently disables the flat fallback). MFL APIKEYs
  // are league-scoped, so a key that matches one league can leave the other
  // league's fetch effectively unauthenticated.
  if (Object.keys(franchises).length === 0 && Array.isArray(flatIds) && flatIds.length > 0) {
    console.warn(`Skipping tradeBait-by-franchise write — 0 franchises parsed but flat list has ${flatIds.length} id(s); keeping previous snapshot.`);
    return;
  }

  const payload = {
    fetchedAt: Date.now(),
    franchises,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved tradeBait-by-franchise -> ${file}`);
};

// Mirrors normalizeInjuryStatus in scripts/fetch-live-lineups.mjs and
// the TypeScript client at src/utils/mfl-matchup-api.ts. Keep these in
// sync if you change one.
const normalizeInjuryStatus = (status) => {
  if (!status) return 'Healthy';
  const normalized = String(status).toLowerCase().trim();
  if (normalized.startsWith('ir-') || normalized.startsWith('ir ')) return 'IR';
  switch (normalized) {
    case 'out':
    case 'o':
      return 'Out';
    case 'doubtful':
    case 'd':
      return 'Doubtful';
    case 'questionable':
    case 'q':
      return 'Questionable';
    case 'ir':
    case 'injured reserve':
      return 'IR';
    case 'suspended':
      return 'Suspended';
    case 'retired':
      return 'Retired';
    case 'holdout':
      return 'Holdout';
    default:
      return 'Healthy';
  }
};

const endpoints = [
  {
    key: 'rosters',
    url: withWeek(`${host}/${year}/export?TYPE=rosters&L=${leagueId}&JSON=1`),
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'players',
    url: `${host}/${year}/export?TYPE=players&DETAILS=1&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    // League-agnostic NFL game schedule for the current week (W omitted =
    // MFL's current week; week 1 during the preseason). Carries kickoff
    // timestamps per matchup — powers "earliest game of the week" hero
    // casting (kickoff-game headliner).
    key: 'nflSchedule',
    url: `${host}/${year}/export?TYPE=nflSchedule&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'salaryAdjustments',
    url: `${host}/${year}/export?TYPE=salaryAdjustments&L=${leagueId}&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'draftResults',
    url: `${host}/${year}/export?TYPE=draftResults&L=${leagueId}&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'auctionResults',
    url: `${host}/${year}/export?TYPE=auctionResults&L=${leagueId}&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'transactions',
    url: withWeek(`${host}/${year}/export?TYPE=transactions&L=${leagueId}&JSON=1`),
    parser: (t) => JSON.parse(t),
  },
  {
    // MFL's TYPE=injuries is league-agnostic (no L= param). Returns the live
    // NFL injury report keyed by player. Transformed here into the same
    // shape rosters.astro previously consumed from live-injury-data-week-*.json
    // (an artifact of the old fetch-live-lineups.mjs script that only ran
    // in-season): `{ generatedAt, year, injuredPlayers, injuries: { [id]: { injuryStatus, injuryBodyPart, expectedReturn } } }`.
    // Status values normalized so the badge rendering ('Q' / 'O' / 'IR' / etc.)
    // matches what owners see on MFL itself.
    key: 'injuries',
    url: `${host}/${year}/export?TYPE=injuries&JSON=1`,
    parser: (t) => {
      const raw = JSON.parse(t);
      const list = Array.isArray(raw?.injuries?.injury)
        ? raw.injuries.injury
        : raw?.injuries?.injury
          ? [raw.injuries.injury]
          : [];
      const injuries = {};
      let injuredPlayers = 0;
      for (const inj of list) {
        if (!inj?.id || !inj?.status) continue;
        injuredPlayers++;
        injuries[inj.id] = {
          injuryStatus: normalizeInjuryStatus(inj.status),
          injuryBodyPart: inj.details || '',
          expectedReturn: inj.exp_return || '',
        };
      }
      return {
        generatedAt: new Date().toISOString(),
        year: parseInt(year, 10),
        injuredPlayers,
        injuries,
      };
    },
  },
  {
    key: 'tradeBait',
    // withAuth: MFL's tradeBait export is owner-gated for private leagues
    // (AFL) — unauthenticated requests get 200 with an empty payload, which
    // is why AFL's tradeBait.json synced as [] while owners had players
    // flagged. Public leagues (TheLeague) ignore the extra param.
    url: withAuth(`${host}/${year}/export?TYPE=tradeBait&L=${leagueId}&JSON=1`),
    parser: (t) => {
      try {
        const data = JSON.parse(t);
        const flat = parseTradeBait(data);
        // Side effect: persist the franchise-attributed shape alongside the
        // flat list, so UIs can show WHO flagged a player (see
        // parseTradeBaitByFranchise above for why the flat list isn't enough).
        writeTradeBaitByFranchise(data, flat);
        return flat;
      } catch (err) {
        console.error('Failed to parse tradeBait JSON:', err.message);
        return [];
      }
    },
  },
  {
    key: 'league',
    url: `${host}/${year}/export?TYPE=league&L=${leagueId}&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'standings',
    url: withWeek(`${host}/${year}/export?TYPE=standings&L=${leagueId}&JSON=1`),
    parser: (t) => JSON.parse(t),
  },
  {
    // Full-season H2H pairings. Historically only the backfill script wrote
    // schedule.json, so current-year copies existed only for leagues that had
    // been backfilled (AFL 2026 had none). Schedule-strength depends on it.
    key: 'schedule',
    url: `${host}/${year}/export?TYPE=schedule&L=${leagueId}&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'weekly-results',
    url: null, // handled separately per-week
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'playoff-brackets',
    url: null, // handled separately - fetches metadata + individual brackets
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'assets',
    url: withAuth(`${host}/${year}/export?TYPE=assets&L=${leagueId}&JSON=1`),
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'futureDraftPicks',
    url: withAuth(`${host}/${year}/export?TYPE=futureDraftPicks&L=${leagueId}&JSON=1`),
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'projectedScores',
    url: withWeek(`${host}/${year}/export?TYPE=projectedScores&L=${leagueId}&JSON=1`),
    parser: (t) => JSON.parse(t),
  },
  // IS_KEEPER takes league-type LETTER codes (N=redraft, D=dynasty) — numeric
  // or omitted values are silently ignored and return the unfiltered
  // aggregate, making both files identical. Keep these in lockstep with
  // scripts/fetch-adp.mjs (which carries the identical-payload guard): this
  // duplicate fetch runs every 5 min via roster-sync and overwrites the same
  // committed files, so a fix applied only there is reverted here.
  {
    key: 'adp-redraft',
    url: `${host}/${year}/export?TYPE=adp&IS_PPR=1&IS_KEEPER=N&IS_MOCK=0&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'adp-dynasty',
    url: `${host}/${year}/export?TYPE=adp&IS_PPR=1&IS_KEEPER=D&IS_MOCK=0&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'playerScores',
    url: `${host}/${year}/export?TYPE=playerScores&L=${leagueId}&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
];

// Redact the APIKEY from anything logged — workflow logs are visible to
// anyone with repo read access.
const redactUrl = (url) => String(url).replace(/APIKEY=[^&]+/, 'APIKEY=***');

const fetchText = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${redactUrl(url)}`);
  return res.text();
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const fetchTextWithRetry = (url, retries = 3, baseDelayMs = 1500) =>
  fetchWithRetry(url, {
    attempts: retries,
    baseDelayMs,
    parse: 'text',
    formatHttpError: (res, u) => `Fetch failed ${res.status} ${redactUrl(u)}`,
    onRetry: (err, attempt, wait) => console.warn(`Retrying ${redactUrl(url)} in ${wait}ms (${err.message})`),
  });

const writeOut = (key, data) => {
  const file = path.join(outDir, `${key}.json`);
  fs.writeFileSync(
    file,
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    'utf8'
  );
  console.log(`Saved ${key} -> ${file}`);

  // Archive a daily snapshot of rosters so weekly history is preserved.
  if (key === 'rosters') {
    const dateSlug = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const historyFile = path.join(rosterHistoryDir, `rosters-${dateSlug}.json`);
    if (fs.existsSync(historyFile)) {
      console.log(`Roster history already captured for ${dateSlug}; skipping archive.`);
    } else {
      fs.mkdirSync(rosterHistoryDir, { recursive: true });
      fs.writeFileSync(
        historyFile,
        typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        'utf8'
      );
      console.log(`Archived rosters -> ${historyFile}`);
    }
  }
};

/**
 * Generate predicted playoff brackets based on current standings
 * Uses seed-based matchups for championship and toilet bowl brackets
 */
const generatePredictedBrackets = (standingsData) => {
  // Predicted bracket metadata (matches MFL structure when no actual brackets exist)
  const playoffBrackets = {
    playoffBracket: [
      {
        startWeek: '15',
        teamsInvolved: '7',
        id: '1',
        startWeekGames: '3',
        bracketWinnerTitle: 'The League Champion',
        name: 'The League Championship',
      },
      {
        startWeek: '17',
        teamsInvolved: '2',
        name: 'The Consolation Bracket',
        startWeekGames: '1',
        bracketWinnerTitle: '3rd Place',
        id: '2',
      },
      {
        startWeek: '15',
        id: '3',
        bracketWinnerTitle: '5th Place',
        name: "The Loser's Bracket",
        startWeekGames: '1',
        teamsInvolved: '5',
      },
      {
        startWeek: '15',
        name: 'The Toilet Bowl Challenge',
        bracketWinnerTitle: 'Winner of pick 1.17',
        startWeekGames: '3',
        id: '5',
        teamsInvolved: '7',
      },
      {
        teamsInvolved: '2',
        id: '6',
        bracketWinnerTitle: 'Winner of pick 2.17',
        name: 'The Toilet Bowl Consolation',
        startWeekGames: '1',
        startWeek: '17',
      },
      {
        teamsInvolved: '4',
        id: '7',
        startWeekGames: '2',
        name: 'The Toilet Bowl Consolation 2',
        bracketWinnerTitle: 'Winner of pick 2.18',
        startWeek: '16',
      },
    ],
  };

  // Predicted bracket structures (seed-based, no actual franchise_ids assigned yet)
  const brackets = {
    '1': {
      playoffBracket: {
        bracket_id: '1',
        playoffRound: [
          {
            playoffGame: [
              { home: { seed: '2' }, game_id: '1', away: { seed: '7' } },
              { game_id: '2', home: { seed: '3' }, away: { seed: '6' } },
              { away: { seed: '5' }, game_id: '3', home: { seed: '4' } },
            ],
            week: '15',
          },
          {
            week: '16',
            playoffGame: [
              { away: { winner_of_game: '2' }, home: { winner_of_game: '1' }, game_id: '4' },
              { away: { winner_of_game: '3' }, home: { seed: '1' }, game_id: '5' },
            ],
          },
          {
            playoffGame: { away: { winner_of_game: '4' }, game_id: '6', home: { winner_of_game: '5' } },
            week: '17',
          },
        ],
      },
    },
    '2': {
      playoffBracket: {
        playoffRound: { playoffGame: { away: { loser_of_game: '4', bracket: '1' }, home: { loser_of_game: '5', bracket: '1' }, game_id: '1' }, week: '17' },
        bracket_id: '2',
      },
    },
    '3': {
      playoffBracket: {
        playoffRound: [
          { playoffGame: { game_id: '1', home: { seed: '8' }, away: { seed: '9' } }, week: '15' },
          {
            playoffGame: [
              { game_id: '2', home: { bracket: '1', loser_of_game: '3' }, away: { winner_of_game: '1' } },
              { game_id: '3', home: { loser_of_game: '2', bracket: '1' }, away: { loser_of_game: '1', bracket: '1' } },
            ],
            week: '16',
          },
          { playoffGame: { home: { winner_of_game: '3' }, game_id: '4', away: { winner_of_game: '2' } }, week: '17' },
        ],
        bracket_id: '3',
      },
    },
    '5': {
      playoffBracket: {
        bracket_id: '5',
        playoffRound: [
          {
            week: '15',
            playoffGame: [
              { game_id: '1', home: { seed: '2' }, away: { seed: '7' } },
              { away: { seed: '6' }, game_id: '2', home: { seed: '3' } },
              { away: { seed: '5' }, game_id: '3', home: { seed: '4' } },
            ],
          },
          {
            week: '16',
            playoffGame: [
              { away: { winner_of_game: '1' }, home: { seed: '1' }, game_id: '4' },
              { away: { winner_of_game: '2' }, game_id: '5', home: { winner_of_game: '3' } },
            ],
          },
          { playoffGame: { away: { winner_of_game: '4' }, game_id: '6', home: { winner_of_game: '5' } }, week: '17' },
        ],
      },
    },
    '6': {
      playoffBracket: {
        bracket_id: '6',
        playoffRound: {
          playoffGame: { away: { loser_of_game: '5', bracket: '5' }, game_id: '1', home: { bracket: '5', loser_of_game: '4' } },
          week: '17',
        },
      },
    },
    '7': {
      playoffBracket: {
        bracket_id: '7',
        playoffRound: [
          {
            week: '16',
            playoffGame: [
              { away: { loser_of_game: '2', bracket: '5' }, home: { loser_of_game: '3', bracket: '5' }, game_id: '1' },
              { away: { bracket: '5', loser_of_game: '1' }, home: { loser_of_game: '1', bracket: '3' }, game_id: '2' },
            ],
          },
          { playoffGame: { game_id: '3', home: { winner_of_game: '2' }, away: { winner_of_game: '1' } }, week: '17' },
        ],
      },
    },
  };

  return {
    playoffBrackets,
    brackets,
  };
};

const run = async () => {
  // Always fetch tradeBait + ADP (public, no auth) to get latest data every build
  const alwaysFetchKeys = new Set(['tradeBait', 'adp-redraft', 'adp-dynasty']);

  // Check if historical data is already cached (skip to avoid rate limits)
  if (!force && isHistoricalDataCached()) {
    console.log(`📦 Historical standings data for ${year} already cached; skipping fetch to avoid rate limits.`);
    return;
  }

  if (!force && isFreshToday()) {
    console.log(`Feeds already fetched today for ${year}; using cached data in ${outDir}.`);
    // Still fetch tradeBait for latest trade bait
    for (const { key, url, parser } of endpoints.filter(e => alwaysFetchKeys.has(e.key))) {
      try {
        console.log(`Fetching ${key} from ${redactUrl(url)}`);
        const text = await fetchText(url);
        const parsed = parser(text);
        writeOut(key, parsed);
      } catch (err) {
        console.error(`Failed ${key}:`, err.message);
      }
    }
    return;
  }

  for (const { key, url, parser } of endpoints) {
    try {
      console.log(`Fetching ${key} from ${redactUrl(url)}`);
      const text = await fetchText(url);
      const parsed = parser(text);
      writeOut(key, parsed);
    } catch (err) {
      console.error(`Failed ${key}:`, err.message);
    }
  }

  // Fetch weekly results (weeks 1–17) more gently to avoid hammering MFL.
  const weeks = Array.from({ length: 17 }, (_, idx) => idx + 1);
  const weeklyResults = [];
  for (const weekNum of weeks) {
    const weekUrl = `${host}/${year}/export?TYPE=weeklyResults&L=${leagueId}&JSON=1&W=${weekNum}`;
    try {
      console.log(`Fetching weeklyResults week ${weekNum} from ${weekUrl}`);
      const text = await fetchTextWithRetry(weekUrl, 4, 2000);
      const parsed = JSON.parse(text);
      weeklyResults.push(parsed);
    } catch (err) {
      console.error(`Failed weeklyResults week ${weekNum}:`, err.message);
    }
    // Slow down between calls to be polite
    await delay(1200);
  }

  if (weeklyResults.length > 0) {
    writeOut('weekly-results-raw', weeklyResults);
    // Shared normalizer — handles both MFL payload shapes (matchup[] and the
    // older flat franchise[] used by archive-year regular seasons).
    writeOut('weekly-results', normalizeWeeklyResults(weeklyResults));
  }

  // Fetch playoff brackets (metadata + individual bracket details)
  // Cache for 1 hour to catch post-game updates
  try {
    if (isPlayoffDataFresh() && !force) {
      console.log('Playoff bracket data is fresh (< 1 hour old), skipping fetch');
    } else {
      const bracketsMetaUrl = `${host}/${year}/export?TYPE=playoffBrackets&L=${leagueId}&JSON=1`;
      console.log(`Fetching playoffBrackets metadata from ${bracketsMetaUrl}`);
      const metaText = await fetchTextWithRetry(bracketsMetaUrl, 3, 1500);
      const metaData = JSON.parse(metaText);

    const bracketList = metaData?.playoffBrackets?.playoffBracket;
    const brackets = Array.isArray(bracketList) ? bracketList : bracketList ? [bracketList] : [];

    if (brackets.length > 0) {
      console.log(`Found ${brackets.length} playoff brackets from MFL - using live data`);
      const bracketDetails = {};

      // Fetch each individual bracket by ID
      for (const bracket of brackets) {
        const bracketId = String(bracket.id);
        const bracketUrl = `${host}/${year}/export?TYPE=playoffBracket&L=${leagueId}&BRACKET_ID=${bracketId}&JSON=1`;

        try {
          console.log(`Fetching playoffBracket ${bracketId} from ${bracketUrl}`);
          const bracketText = await fetchTextWithRetry(bracketUrl, 3, 1500);
          const bracketData = JSON.parse(bracketText);

          // Check if we got valid bracket data (not an error)
          if (!bracketData.error) {
            bracketDetails[bracketId] = bracketData;
          } else {
            console.warn(`Bracket ${bracketId} returned error: ${bracketData.error?.$t || 'Unknown error'}`);
          }

          // Be polite to MFL servers
          await delay(1000);
        } catch (err) {
          console.error(`Failed to fetch bracket ${bracketId}:`, err.message);
        }
      }

      // Write consolidated playoff-brackets.json file with live MFL data + timestamp
      const consolidated = {
        playoffBrackets: metaData.playoffBrackets,
        brackets: bracketDetails,
        lastFetched: new Date().toISOString(),
      };
      writeOut('playoff-brackets', consolidated);
      console.log('Updated playoff bracket data with fresh MFL data');
    } else {
      console.log('No playoff brackets from MFL yet - generating predicted brackets from standings');

      // Generate predicted brackets based on current standings
      const standingsFile = path.join(outDir, 'standings.json');
      if (fs.existsSync(standingsFile)) {
        try {
          const standingsData = JSON.parse(fs.readFileSync(standingsFile, 'utf8'));
          const predicted = generatePredictedBrackets(standingsData);
          predicted.lastFetched = new Date().toISOString();
          writeOut('playoff-brackets', predicted);
          console.log('Generated predicted playoff brackets based on current standings');
        } catch (err) {
          console.error('Failed to generate predicted brackets:', err.message);
        }
      } else {
        console.log('No standings data available to generate predicted brackets');
      }
    }
    }
  } catch (err) {
    console.error('Failed to fetch playoff brackets metadata:', err.message);

    // Try to generate predicted brackets as fallback
    const standingsFile = path.join(outDir, 'standings.json');
    if (fs.existsSync(standingsFile)) {
      try {
        console.log('Generating predicted brackets as fallback');
        const standingsData = JSON.parse(fs.readFileSync(standingsFile, 'utf8'));
        const predicted = generatePredictedBrackets(standingsData);
        predicted.lastFetched = new Date().toISOString();
        writeOut('playoff-brackets', predicted);
        console.log('Generated predicted playoff brackets based on current standings');
      } catch (genErr) {
        console.error('Failed to generate predicted brackets:', genErr.message);
      }
    }
  }


  fs.writeFileSync(
    metaFile,
    JSON.stringify({ lastFetched: new Date().toISOString(), leagueId, year, week }, null, 2),
    'utf8'
  );
  console.log(`Updated metadata -> ${metaFile}`);
};

run();
