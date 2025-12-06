/**
 * Pull core MFL feeds (rosters, players, salary adjustments, draft results, option07, transactions)
 * and write them into src/data/mfl-feeds/<year>/.
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

const getNonEmpty = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

const leagueId = getNonEmpty(process.env.MFL_LEAGUE_ID);
if (!leagueId) {
  console.error('Missing MFL_LEAGUE_ID env var');
  process.exit(1);
}

// Determine league name for output directory
// MFL_LEAGUE_NAME env var or default based on league ID
const leagueName = getNonEmpty(process.env.MFL_LEAGUE_NAME) || (leagueId === '19621' ? 'afl-fantasy' : 'theleague');

const year = getNonEmpty(process.env.MFL_YEAR) || getNonEmpty(process.env.MFL_SEASON) || new Date().getFullYear().toString();
// Only include a week param when explicitly provided; otherwise let MFL serve latest/YTD.
const week = getNonEmpty(process.env.MFL_WEEK) || null;
const host = getNonEmpty(process.env.MFL_HOST) || 'https://api.myfantasyleague.com';
const mflUserId = getNonEmpty(process.env.MFL_USER_ID);
const mflApiKey = getNonEmpty(process.env.MFL_APIKEY);

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
  const playerIds = new Set();

  if (typeof data === 'object' && data !== null) {
    const tradeBaitArray = data?.tradeBaits?.tradeBait;
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
    key: 'transactions',
    url: withWeek(`${host}/${year}/export?TYPE=transactions&L=${leagueId}&JSON=1`),
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'option07',
    url: `${host}/${year}/options?L=${leagueId}&O=07`,
    parser: (t) => t, // HTML payload; keep raw
  },
  {
    key: 'tradeBait',
    url: `${host}/${year}/export?TYPE=tradeBait&L=${leagueId}&JSON=1`,
    parser: (t) => {
      try {
        return parseTradeBait(JSON.parse(t));
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
    key: 'weekly-results',
    url: null, // handled separately per-week
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'playoffBracket',
    url: `${host}/${year}/export?TYPE=playoffBracket&L=${leagueId}&JSON=1`,
    parser: (t) => JSON.parse(t),
  },
  {
    key: 'assets',
    url: withAuth(`${host}/${year}/export?TYPE=assets&L=${leagueId}&JSON=1`),
    parser: (t) => JSON.parse(t),
  },
];

const fetchText = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return res.text();
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const fetchTextWithRetry = async (url, retries = 3, baseDelayMs = 1500) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetchText(url);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const wait = baseDelayMs * (attempt + 1);
      console.warn(`Retrying ${url} in ${wait}ms (${err.message})`);
      await delay(wait);
    }
  }
};

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

const run = async () => {
  // Always fetch tradeBait to get latest trade bait info (updates every build)
  const alwaysFetchKeys = new Set(['tradeBait']);

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
        console.log(`Fetching ${key} from ${url}`);
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
      console.log(`Fetching ${key} from ${url}`);
      const text = await fetchText(url);
      const parsed = parser(text);
      writeOut(key, parsed);
    } catch (err) {
      console.error(`Failed ${key}:`, err.message);
    }
  }

  // Fetch weekly results (weeks 1–14) more gently to avoid hammering MFL.
  const weeks = Array.from({ length: 14 }, (_, idx) => idx + 1);
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
    const normalized = {
      weeks: weeklyResults.map((weekPayload) => {
        const weekVal = Number(weekPayload?.weeklyResults?.week) || undefined;
        const matchups = weekPayload?.weeklyResults?.matchup
          ? Array.isArray(weekPayload.weeklyResults.matchup)
            ? weekPayload.weeklyResults.matchup
            : [weekPayload.weeklyResults.matchup]
          : [];
        const scores = {};
        matchups.forEach((m) => {
          const franchises = m?.franchise
            ? Array.isArray(m.franchise)
              ? m.franchise
              : [m.franchise]
            : [];
          franchises.forEach((team) => {
            if (team?.id) {
              scores[String(team.id)] = Number(team.score) || 0;
            }
          });
        });
        return { week: weekVal, scores };
      }),
    };
    writeOut('weekly-results', normalized);
  }

  fs.writeFileSync(
    metaFile,
    JSON.stringify({ lastFetched: new Date().toISOString(), leagueId, year, week }, null, 2),
    'utf8'
  );
  console.log(`Updated metadata -> ${metaFile}`);
};

run();
