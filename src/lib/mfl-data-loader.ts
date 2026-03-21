/**
 * Unified MFL Data Loader
 *
 * Routes data requests based on year:
 *   - Current year  → live MFL API with 2-minute in-memory cache
 *   - Historical years → static JSON files on disk (never change)
 *
 * This replaces both `import.meta.glob` and `loadFeedJson` patterns
 * for current-year data, while preserving static file reads for history.
 *
 * Usage:
 *   import { getFeedData, getAvailableYears } from '../../lib/mfl-data-loader';
 *
 *   // Single feed for a specific year (auto-routes static vs. live)
 *   const standings = await getFeedData('theleague', '13522', 2026, 'standings');
 *
 *   // Multiple feeds in parallel
 *   const { rosters, players, standings } = await getMultiFeedData(
 *     'theleague', '13522', 2026, ['rosters', 'players', 'standings']
 *   );
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getMflFeed,
  getMflFeeds,
  getMflPlayoffBrackets,
  getMflAllWeeklyResults,
  getMflAdp,
  type MflFeedType,
  type MflAdpType,
} from './mfl-feeds';
import { getCurrentLeagueYear, getCurrentSeasonYear } from '../utils/league-year';

/** League configurations */
const LEAGUE_CONFIG: Record<string, { leagueId: string; dataDir: string }> = {
  theleague: { leagueId: '13522', dataDir: 'data/theleague/mfl-feeds' },
  'afl-fantasy': { leagueId: '19621', dataDir: 'data/afl-fantasy/mfl-feeds' },
};

/**
 * Determine if a year should use live MFL API or static files.
 *
 * We consider a year "current" if it matches either the current league year
 * or current season year (during the dual-year window, both are live).
 */
function isLiveYear(year: number | string): boolean {
  const yearNum = typeof year === 'string' ? parseInt(year, 10) : year;
  const leagueYear = getCurrentLeagueYear();
  const seasonYear = getCurrentSeasonYear();
  return yearNum >= Math.min(leagueYear, seasonYear);
}

/**
 * Read a feed from static JSON files on disk (for historical data).
 */
function readStaticFeed(dataDir: string, year: number | string, feedType: string): any {
  const feedPath = path.resolve(process.cwd(), dataDir, String(year), `${feedType}.json`);
  try {
    if (fs.existsSync(feedPath)) {
      return JSON.parse(fs.readFileSync(feedPath, 'utf8'));
    }
  } catch (e) {
    console.warn(`[mfl-data-loader] Failed to read static feed ${feedPath}:`, e);
  }
  return null;
}

interface FeedDataOptions {
  /** MFL API key for authenticated endpoints (assets, futureDraftPicks) */
  apiKey?: string;
  /** Override cache TTL in ms */
  ttlMs?: number;
  /** Force live fetch even for historical years */
  forceLive?: boolean;
}

/**
 * Get a single MFL feed for a specific year.
 *
 * Automatically routes:
 *   - Current year → live MFL API with caching
 *   - Historical years → static JSON files on disk
 *
 * Falls back to static files if MFL API fails and static data exists.
 */
export async function getFeedData(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  feedType: MflFeedType,
  opts: FeedDataOptions = {},
): Promise<any> {
  const config = LEAGUE_CONFIG[leagueSlug];
  const dataDir = config?.dataDir ?? `data/${leagueSlug}/mfl-feeds`;

  if (opts.forceLive || isLiveYear(year)) {
    // Live fetch from MFL API
    const data = await getMflFeed(leagueSlug, leagueId, year, feedType, {
      apiKey: opts.apiKey,
      ttlMs: opts.ttlMs,
    });

    // If live fetch failed, try static file as fallback
    if (data === null) {
      console.warn(`[mfl-data-loader] Live fetch failed for ${feedType}/${year}, falling back to static file`);
      return readStaticFeed(dataDir, year, feedType);
    }

    return data;
  }

  // Historical year — read from static file
  return readStaticFeed(dataDir, year, feedType);
}

/**
 * Get multiple MFL feeds in parallel for a specific year.
 */
export async function getMultiFeedData(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  feedTypes: MflFeedType[],
  opts: FeedDataOptions = {},
): Promise<Record<string, any>> {
  const config = LEAGUE_CONFIG[leagueSlug];
  const dataDir = config?.dataDir ?? `data/${leagueSlug}/mfl-feeds`;

  if (opts.forceLive || isLiveYear(year)) {
    // Live fetch all in parallel
    const liveData = await getMflFeeds(leagueSlug, leagueId, year, feedTypes, {
      apiKey: opts.apiKey,
      ttlMs: opts.ttlMs,
    });

    // For any feeds that failed live, try static fallback
    for (const feedType of feedTypes) {
      if (liveData[feedType] === null) {
        console.warn(`[mfl-data-loader] Falling back to static for ${feedType}/${year}`);
        liveData[feedType] = readStaticFeed(dataDir, year, feedType);
      }
    }

    return liveData;
  }

  // Historical — all from static files
  const result: Record<string, any> = {};
  for (const feedType of feedTypes) {
    result[feedType] = readStaticFeed(dataDir, year, feedType);
  }
  return result;
}

/**
 * Get ADP data (not league-specific).
 * Always fetches live for current year, static for historical.
 */
export async function getAdpData(
  year: number | string,
  type: MflAdpType,
  opts: FeedDataOptions = {},
): Promise<any> {
  if (opts.forceLive || isLiveYear(year)) {
    return getMflAdp(year, type, { ttlMs: opts.ttlMs });
  }
  // For historical ADP, try to read from the theleague feeds directory
  return readStaticFeed('data/theleague/mfl-feeds', year, type);
}

/**
 * Get playoff brackets (metadata + individual bracket details).
 * Always fetches live for current year.
 */
export async function getPlayoffBracketsData(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  opts: FeedDataOptions = {},
): Promise<any> {
  const config = LEAGUE_CONFIG[leagueSlug];
  const dataDir = config?.dataDir ?? `data/${leagueSlug}/mfl-feeds`;

  if (opts.forceLive || isLiveYear(year)) {
    const data = await getMflPlayoffBrackets(leagueSlug, leagueId, year, {
      ttlMs: opts.ttlMs,
    });
    if (data === null) {
      return readStaticFeed(dataDir, year, 'playoff-brackets');
    }
    return data;
  }

  return readStaticFeed(dataDir, year, 'playoff-brackets');
}

/**
 * Get weekly results (all 17 weeks).
 * Live for current year, static for historical.
 */
export async function getWeeklyResultsRaw(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  opts: FeedDataOptions = {},
): Promise<any[]> {
  const config = LEAGUE_CONFIG[leagueSlug];
  const dataDir = config?.dataDir ?? `data/${leagueSlug}/mfl-feeds`;

  if (opts.forceLive || isLiveYear(year)) {
    const data = await getMflAllWeeklyResults(leagueSlug, leagueId, year, {
      ttlMs: opts.ttlMs,
    });
    if (data.length === 0) {
      // Fallback to static
      const staticData = readStaticFeed(dataDir, year, 'weekly-results-raw');
      return Array.isArray(staticData) ? staticData : [];
    }
    return data;
  }

  const staticData = readStaticFeed(dataDir, year, 'weekly-results-raw');
  return Array.isArray(staticData) ? staticData : [];
}

/**
 * Get normalized weekly results (same format as weekly-results.json on disk).
 * Returns: { weeks: [{ week: number, scores: Record<string, number> }] }
 */
export async function getWeeklyResultsNormalized(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  opts: FeedDataOptions = {},
): Promise<{ weeks: Array<{ week: number; scores: Record<string, number> }> }> {
  const config = LEAGUE_CONFIG[leagueSlug];
  const dataDir = config?.dataDir ?? `data/${leagueSlug}/mfl-feeds`;

  // For historical years, try to read the pre-normalized file first
  if (!opts.forceLive && !isLiveYear(year)) {
    const staticData = readStaticFeed(dataDir, year, 'weekly-results');
    if (staticData?.weeks) return staticData;
  }

  // Fetch raw weekly results and normalize
  const rawResults = await getWeeklyResultsRaw(leagueSlug, leagueId, year, opts);

  const weeks = rawResults.map((weekPayload: any) => {
    const weekVal = Number(weekPayload?.weeklyResults?.week) || undefined;
    const matchups = weekPayload?.weeklyResults?.matchup
      ? Array.isArray(weekPayload.weeklyResults.matchup)
        ? weekPayload.weeklyResults.matchup
        : [weekPayload.weeklyResults.matchup]
      : [];
    const scores: Record<string, number> = {};
    matchups.forEach((m: any) => {
      const franchises = m?.franchise
        ? Array.isArray(m.franchise)
          ? m.franchise
          : [m.franchise]
        : [];
      franchises.forEach((team: any) => {
        if (team?.id) {
          scores[String(team.id)] = Number(team.score) || 0;
        }
      });
    });
    return { week: weekVal, scores };
  });

  return { weeks };
}

/**
 * Discover which years have data on disk for a given league.
 * Used for year selectors and historical data browsing.
 */
export function getAvailableYears(leagueSlug: string): number[] {
  const config = LEAGUE_CONFIG[leagueSlug];
  const dataDir = config?.dataDir ?? `data/${leagueSlug}/mfl-feeds`;
  const fullPath = path.resolve(process.cwd(), dataDir);

  try {
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath)
      .map((name) => parseInt(name, 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => b - a); // Descending (newest first)
  } catch {
    return [];
  }
}

/**
 * Read a non-MFL static data file from a league's feed directory.
 * Used for files like nflSchedule.json, fantasyPointsAllowed.json
 * that come from other scripts (not MFL API).
 */
export function readStaticFile(
  leagueSlug: string,
  year: number | string,
  filename: string,
): any {
  const config = LEAGUE_CONFIG[leagueSlug];
  const dataDir = config?.dataDir ?? `data/${leagueSlug}/mfl-feeds`;
  return readStaticFeed(dataDir, year, filename.replace(/\.json$/, ''));
}
