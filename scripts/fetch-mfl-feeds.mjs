/**
 * Pull core MFL feeds (rosters, players, salary adjustments, draft results, option07, transactions)
 * and write them into src/data/mfl-feeds/<year>/.
 *
 * Usage:
 *   node scripts/fetch-mfl-feeds.js [--force]
 *
 * Env variables:
 *   MFL_LEAGUE_ID (required) - e.g., 13522
 *   MFL_YEAR (optional) - defaults to current year
 *   MFL_WEEK (optional) - defaults to 'YTD'
 *   MFL_HOST (optional) - defaults to https://api.myfantasyleague.com
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

const year = getNonEmpty(process.env.MFL_YEAR) || getNonEmpty(process.env.MFL_SEASON) || new Date().getFullYear().toString();
// Only include a week param when explicitly provided; otherwise let MFL serve latest/YTD.
const week = getNonEmpty(process.env.MFL_WEEK) || null;
const host = getNonEmpty(process.env.MFL_HOST) || 'https://api.myfantasyleague.com';

const outDir = path.join('src', 'data', 'mfl-feeds', year);
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

const withWeek = (baseUrl) => (week ? `${baseUrl}&W=${week}` : baseUrl);

const parseTradeBait = (data) => {
  // Handle both JSON and HTML responses
  const playerIds = new Set();

  // Try JSON format first
  if (typeof data === 'object' && data !== null) {
    if (data?.tradeBait && Array.isArray(data.tradeBait)) {
      data.tradeBait.forEach((item) => {
        if (item.willGiveUp && Array.isArray(item.willGiveUp)) {
          item.willGiveUp.forEach((player) => {
            if (player.id) {
              playerIds.add(player.id);
            }
          });
        }
      });
    }
  } else if (typeof data === 'string') {
    // Parse HTML response - extract player links
    // Format: <a href="...&PLAYER=12345&...">Player Name</a>
    const playerLinkRegex = /[&?]PLAYER=(\d+)[&"]/g;
    let match;
    while ((match = playerLinkRegex.exec(data)) !== null) {
      if (match[1]) {
        playerIds.add(match[1]);
      }
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
    url: `${host}/${year}/trade?L=${leagueId}`,
    parser: (t) => {
      try {
        // Try parsing as JSON first
        return parseTradeBait(JSON.parse(t));
      } catch {
        // If JSON fails, treat as HTML
        return parseTradeBait(t);
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
];

const fetchText = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return res.text();
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

  fs.writeFileSync(
    metaFile,
    JSON.stringify({ lastFetched: new Date().toISOString(), leagueId, year, week }, null, 2),
    'utf8'
  );
  console.log(`Updated metadata -> ${metaFile}`);
};

run();
