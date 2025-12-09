/**
 * MFL Data Fetcher
 * Refactored from scripts/fetch-mfl-feeds.mjs to accept parameters
 *
 * Usage:
 *   import { fetchLeagueData } from '@mfl/mfl-data-fetcher';
 *   await fetchLeagueData('13522', '2025', 'data/theleague/mfl-feeds/2025');
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface FetchOptions {
  leagueId: string;
  year: string;
  outputDir: string;
  week?: string | null;
  host?: string;
  mflUserId?: string;
  mflApiKey?: string;
  force?: boolean;
}

const getNonEmpty = (value: string | undefined): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

/**
 * Fetch MFL league data and save to output directory
 */
export async function fetchLeagueData(options: FetchOptions): Promise<void> {
  const {
    leagueId,
    year,
    outputDir,
    week = null,
    host = 'https://api.myfantasyleague.com',
    mflUserId,
    mflApiKey,
    force = false,
  } = options;

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  const metaFile = path.join(outputDir, 'fetch.meta.json');
  const rosterHistoryDir = path.join(outputDir, 'roster-history');

  // Check if data is fresh
  const isFreshToday = (): boolean => {
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

  // Check if historical data is cached
  const isHistoricalDataCached = (): boolean => {
    const currentYear = new Date().getFullYear();
    const fetchYear = parseInt(year, 10);

    if (fetchYear >= currentYear) {
      return false; // Current or future year - always fetch
    }

    const standingsFile = path.join(outputDir, 'standings.json');
    if (!fs.existsSync(standingsFile)) {
      return false;
    }

    try {
      const data = JSON.parse(fs.readFileSync(standingsFile, 'utf8'));
      return data && data.leagueStandings && Array.isArray(data.leagueStandings.franchise);
    } catch (_err) {
      return false;
    }
  };

  // Helper to add week parameter
  const withWeek = (baseUrl: string): string => (week ? `${baseUrl}&W=${week}` : baseUrl);

  // Helper to add authentication
  const withAuth = (baseUrl: string): string => {
    if (mflApiKey) {
      return `${baseUrl}&APIKEY=${encodeURIComponent(mflApiKey)}`;
    }
    return baseUrl;
  };

  // Parse trade bait response
  const parseTradeBait = (data: any): string[] => {
    const playerIds = new Set<string>();

    if (typeof data === 'object' && data !== null) {
      const tradeBaitArray = data?.tradeBaits?.tradeBait;
      if (Array.isArray(tradeBaitArray)) {
        tradeBaitArray.forEach((item: any) => {
          if (item.willGiveUp) {
            const ids = typeof item.willGiveUp === 'string'
              ? item.willGiveUp.split(',').map((id: string) => id.trim())
              : [item.willGiveUp];

            ids.forEach((id: string) => {
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

  // Define endpoints
  const endpoints = [
    {
      key: 'rosters',
      url: withWeek(`${host}/${year}/export?TYPE=rosters&L=${leagueId}&JSON=1`),
      parser: (t: string) => JSON.parse(t),
    },
    {
      key: 'players',
      url: `${host}/${year}/export?TYPE=players&DETAILS=1&JSON=1`,
      parser: (t: string) => JSON.parse(t),
    },
    {
      key: 'salaryAdjustments',
      url: `${host}/${year}/export?TYPE=salaryAdjustments&L=${leagueId}&JSON=1`,
      parser: (t: string) => JSON.parse(t),
    },
    {
      key: 'draftResults',
      url: `${host}/${year}/export?TYPE=draftResults&L=${leagueId}&JSON=1`,
      parser: (t: string) => JSON.parse(t),
    },
    {
      key: 'transactions',
      url: withWeek(`${host}/${year}/export?TYPE=transactions&L=${leagueId}&JSON=1`),
      parser: (t: string) => JSON.parse(t),
    },
    {
      key: 'tradeBait',
      url: `${host}/${year}/export?TYPE=tradeBait&L=${leagueId}&JSON=1`,
      parser: (t: string) => {
        try {
          return parseTradeBait(JSON.parse(t));
        } catch (err: any) {
          console.error('Failed to parse tradeBait JSON:', err.message);
          return [];
        }
      },
    },
    {
      key: 'league',
      url: `${host}/${year}/export?TYPE=league&L=${leagueId}&JSON=1`,
      parser: (t: string) => JSON.parse(t),
    },
    {
      key: 'standings',
      url: withWeek(`${host}/${year}/export?TYPE=standings&L=${leagueId}&JSON=1`),
      parser: (t: string) => JSON.parse(t),
    },
    {
      key: 'playoffBracket',
      url: `${host}/${year}/export?TYPE=playoffBracket&L=${leagueId}&JSON=1`,
      parser: (t: string) => JSON.parse(t),
    },
    {
      key: 'assets',
      url: withAuth(`${host}/${year}/export?TYPE=assets&L=${leagueId}&JSON=1`),
      parser: (t: string) => JSON.parse(t),
    },
  ];

  // Fetch helper
  const fetchText = async (url: string): Promise<string> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
    return res.text();
  };

  // Write output
  const writeOut = (key: string, data: any): void => {
    const file = path.join(outputDir, `${key}.json`);
    fs.writeFileSync(
      file,
      typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      'utf8'
    );
    console.log(`Saved ${key} -> ${file}`);

    // Archive rosters
    if (key === 'rosters') {
      const dateSlug = new Date().toISOString().slice(0, 10);
      const historyFile = path.join(rosterHistoryDir, `rosters-${dateSlug}.json`);
      if (!fs.existsSync(historyFile)) {
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

  // Main fetch logic
  const alwaysFetchKeys = new Set(['tradeBait']);

  if (!force && isHistoricalDataCached()) {
    console.log(`📦 Historical data for ${year} (league ${leagueId}) already cached; skipping fetch.`);
    return;
  }

  if (!force && isFreshToday()) {
    console.log(`Feeds already fetched today for ${year} (league ${leagueId}); using cached data.`);
    // Still fetch tradeBait
    for (const { key, url, parser } of endpoints.filter(e => alwaysFetchKeys.has(e.key))) {
      try {
        console.log(`Fetching ${key} from ${url}`);
        const text = await fetchText(url);
        const parsed = parser(text);
        writeOut(key, parsed);
      } catch (err: any) {
        console.error(`Failed ${key}:`, err.message);
      }
    }
    return;
  }

  // Fetch all endpoints
  for (const { key, url, parser } of endpoints) {
    try {
      console.log(`Fetching ${key} from ${url}`);
      const text = await fetchText(url);
      const parsed = parser(text);
      writeOut(key, parsed);
    } catch (err: any) {
      console.error(`Failed ${key}:`, err.message);
    }
  }

  // Update metadata
  fs.writeFileSync(
    metaFile,
    JSON.stringify({ lastFetched: new Date().toISOString(), leagueId, year, week }, null, 2),
    'utf8'
  );
  console.log(`Updated metadata -> ${metaFile}`);
}

/**
 * Convenience function to fetch data using environment variables
 * (for backwards compatibility with existing scripts)
 */
export async function fetchFromEnv(): Promise<void> {
  const leagueId = getNonEmpty(process.env.MFL_LEAGUE_ID);
  if (!leagueId) {
    throw new Error('Missing MFL_LEAGUE_ID environment variable');
  }

  const year = getNonEmpty(process.env.MFL_YEAR) ||
                getNonEmpty(process.env.MFL_SEASON) ||
                new Date().getFullYear().toString();

  const outputDir = path.join('data', 'mfl-feeds', year);

  await fetchLeagueData({
    leagueId,
    year,
    outputDir,
    week: getNonEmpty(process.env.MFL_WEEK),
    host: getNonEmpty(process.env.MFL_HOST),
    mflUserId: getNonEmpty(process.env.MFL_USER_ID),
    mflApiKey: getNonEmpty(process.env.MFL_APIKEY),
    force: process.argv.includes('--force'),
  });
}
