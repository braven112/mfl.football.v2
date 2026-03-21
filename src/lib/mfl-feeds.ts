/**
 * Live MFL Feed Fetcher
 *
 * Replaces static JSON file reads with on-demand MFL API fetches,
 * backed by a 2-minute in-memory cache. With ≤16 users, MFL sees
 * at most ~1 request per 2 minutes per feed — well under rate limits.
 *
 * Usage in Astro pages:
 *   const rosters = await getMflFeed('theleague', '13522', 2026, 'rosters');
 *   const standings = await getMflFeed('theleague', '13522', 2025, 'standings');
 */

import { cachedFetch } from './mfl-cache';

const MFL_HOST = 'https://api.myfantasyleague.com';

/** All supported MFL export feed types */
export type MflFeedType =
  | 'rosters'
  | 'players'
  | 'salaryAdjustments'
  | 'draftResults'
  | 'auctionResults'
  | 'transactions'
  | 'tradeBait'
  | 'league'
  | 'standings'
  | 'assets'
  | 'futureDraftPicks'
  | 'projectedScores'
  | 'playerScores';

/** ADP feeds (no league ID required) */
export type MflAdpType = 'adp-redraft' | 'adp-dynasty';

/** Weekly feeds that need a week parameter */
export type MflWeeklyFeedType = 'weeklyResults' | 'liveScoring';

interface FetchMflOptions {
  /** MFL API key for authenticated endpoints (assets, futureDraftPicks) */
  apiKey?: string;
  /** Specific week for week-scoped feeds */
  week?: number | string;
  /** Cache TTL override in ms (default: 2 minutes) */
  ttlMs?: number;
}

/**
 * Fetch a raw MFL export endpoint with retry logic
 */
async function fetchMflRaw(url: string): Promise<any> {
  const maxRetries = 3;
  const baseDelay = 1500;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`MFL API ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const delay = baseDelay * (attempt + 1);
      console.warn(`[mfl-feeds] Retry ${attempt + 1} for ${url} in ${delay}ms: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Build the MFL export URL for a feed type
 */
function buildFeedUrl(
  year: number | string,
  leagueId: string,
  feedType: string,
  opts: FetchMflOptions = {},
): string {
  let url = `${MFL_HOST}/${year}/export?TYPE=${feedType}&L=${leagueId}&JSON=1`;
  // players feed needs DETAILS=1 for full player info (position, team, etc.)
  if (feedType === 'players') url += '&DETAILS=1';
  if (opts.week) url += `&W=${opts.week}`;
  if (opts.apiKey) url += `&APIKEY=${encodeURIComponent(opts.apiKey)}`;
  return url;
}

/**
 * Parse MFL trade bait response into a flat array of player IDs
 */
function parseTradeBait(data: any): string[] {
  const playerIds = new Set<string>();
  let tradeBaitArray = data?.tradeBaits?.tradeBait;
  if (tradeBaitArray && !Array.isArray(tradeBaitArray)) {
    tradeBaitArray = [tradeBaitArray];
  }
  if (Array.isArray(tradeBaitArray)) {
    for (const item of tradeBaitArray) {
      if (item.willGiveUp) {
        const ids = typeof item.willGiveUp === 'string'
          ? item.willGiveUp.split(',').map((id: string) => id.trim())
          : [item.willGiveUp];
        for (const id of ids) {
          if (id && /^\d{4,}$/.test(id)) {
            playerIds.add(id);
          }
        }
      }
    }
  }
  return Array.from(playerIds);
}

/**
 * Fetch a single MFL feed with caching.
 *
 * @param leagueSlug  'theleague' or 'afl-fantasy'
 * @param leagueId    MFL league ID (e.g., '13522')
 * @param year        MFL year (e.g., 2026)
 * @param feedType    Feed type (e.g., 'rosters', 'standings')
 * @param opts        Optional: apiKey, week, ttlMs
 * @returns Parsed JSON response from MFL
 */
export async function getMflFeed<T = any>(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  feedType: MflFeedType,
  opts: FetchMflOptions = {},
): Promise<T | null> {
  const weekSuffix = opts.week ? `/w${opts.week}` : '';
  const cacheKey = `mfl/${leagueSlug}/${year}/${feedType}${weekSuffix}`;

  try {
    return await cachedFetch<T>(
      cacheKey,
      async () => {
        const url = buildFeedUrl(year, leagueId, feedType, opts);
        console.log(`[mfl-feeds] Fetching ${feedType} for ${leagueSlug}/${year}`);
        const data = await fetchMflRaw(url);

        // Special handling for tradeBait — flatten to player ID array
        if (feedType === 'tradeBait') {
          return parseTradeBait(data) as T;
        }

        return data as T;
      },
      opts.ttlMs,
    );
  } catch (err) {
    console.error(`[mfl-feeds] Failed to fetch ${feedType} for ${leagueSlug}/${year}:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch ADP data (no league ID required)
 */
export async function getMflAdp<T = any>(
  year: number | string,
  type: MflAdpType,
  opts: FetchMflOptions = {},
): Promise<T | null> {
  const cacheKey = `mfl/adp/${year}/${type}`;

  try {
    return await cachedFetch<T>(
      cacheKey,
      async () => {
        const isPpr = '1';
        const isKeeper = type === 'adp-redraft' ? '0' : undefined;
        let url = `${MFL_HOST}/${year}/export?TYPE=adp&IS_PPR=${isPpr}&IS_MOCK=0&JSON=1`;
        if (isKeeper !== undefined) url += `&IS_KEEPER=${isKeeper}`;
        console.log(`[mfl-feeds] Fetching ${type} for ${year}`);
        return await fetchMflRaw(url);
      },
      opts.ttlMs,
    );
  } catch (err) {
    console.error(`[mfl-feeds] Failed to fetch ${type}:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch weekly results for a specific week
 */
export async function getMflWeeklyResults(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  week: number,
  opts: FetchMflOptions = {},
): Promise<any | null> {
  const cacheKey = `mfl/${leagueSlug}/${year}/weeklyResults/w${week}`;
  try {
    return await cachedFetch(
      cacheKey,
      async () => {
        const url = `${MFL_HOST}/${year}/export?TYPE=weeklyResults&L=${leagueId}&W=${week}&JSON=1`;
        console.log(`[mfl-feeds] Fetching weeklyResults week ${week} for ${leagueSlug}/${year}`);
        return await fetchMflRaw(url);
      },
      opts.ttlMs ?? 5 * 60 * 1000,
    );
  } catch (err) {
    console.error(`[mfl-feeds] Failed weeklyResults week ${week}:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch all weekly results for weeks 1-17 (cached individually, fetched in parallel)
 */
export async function getMflAllWeeklyResults(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  opts: FetchMflOptions = {},
): Promise<any[]> {
  const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
  const ttl = opts.ttlMs ?? 10 * 60 * 1000; // 10 min TTL — weekly results only change once per week

  // Fetch all weeks in parallel (cache dedup prevents duplicate MFL hits)
  const settled = await Promise.allSettled(
    weeks.map((week) => getMflWeeklyResults(leagueSlug, leagueId, year, week, { ...opts, ttlMs: ttl })),
  );

  return settled
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);
}

/**
 * Fetch playoff bracket metadata + individual brackets
 */
export async function getMflPlayoffBrackets(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  opts: FetchMflOptions = {},
): Promise<{ playoffBrackets: any; brackets: Record<string, any> } | null> {
  const cacheKey = `mfl/${leagueSlug}/${year}/playoffBrackets`;

  try {
    return await cachedFetch(
      cacheKey,
      async () => {
        // Fetch metadata
        const metaUrl = `${MFL_HOST}/${year}/export?TYPE=playoffBrackets&L=${leagueId}&JSON=1`;
        console.log(`[mfl-feeds] Fetching playoffBrackets for ${leagueSlug}/${year}`);
        const metaData = await fetchMflRaw(metaUrl);

        const bracketList = metaData?.playoffBrackets?.playoffBracket;
        const brackets = Array.isArray(bracketList) ? bracketList : bracketList ? [bracketList] : [];

        const bracketDetails: Record<string, any> = {};

        // Fetch each individual bracket
        for (const bracket of brackets) {
          const bracketId = String(bracket.id);
          const bracketUrl = `${MFL_HOST}/${year}/export?TYPE=playoffBracket&L=${leagueId}&BRACKET_ID=${bracketId}&JSON=1`;
          try {
            const bracketData = await fetchMflRaw(bracketUrl);
            if (!bracketData.error) {
              bracketDetails[bracketId] = bracketData;
            }
          } catch (err) {
            console.error(`[mfl-feeds] Failed bracket ${bracketId}:`, (err as Error).message);
          }
        }

        return {
          playoffBrackets: metaData.playoffBrackets,
          brackets: bracketDetails,
        };
      },
      opts.ttlMs ?? 5 * 60 * 1000, // 5 min TTL for brackets
    );
  } catch (err) {
    console.error(`[mfl-feeds] Failed playoffBrackets:`, (err as Error).message);
    return null;
  }
}

/**
 * Convenience: fetch multiple feeds in parallel for a league/year
 */
export async function getMflFeeds(
  leagueSlug: string,
  leagueId: string,
  year: number | string,
  feedTypes: MflFeedType[],
  opts: FetchMflOptions = {},
): Promise<Record<string, any>> {
  const results = await Promise.all(
    feedTypes.map(async (feedType) => {
      const data = await getMflFeed(leagueSlug, leagueId, year, feedType, opts);
      return [feedType, data] as const;
    }),
  );
  return Object.fromEntries(results);
}

/**
 * Convenience: load a feed from static JSON file (fallback for historical data)
 * Keeps backward compat for years that won't change (pre-current-year)
 */
export async function loadStaticFeed(
  leagueSlug: string,
  year: number | string,
  filename: string,
): Promise<any> {
  // This runs server-side in Node.js
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const feedPath = path.resolve(process.cwd(), `data/${leagueSlug}/mfl-feeds/${year}/${filename}`);
    if (fs.existsSync(feedPath)) {
      return JSON.parse(fs.readFileSync(feedPath, 'utf8'));
    }
  } catch {
    // Fall through
  }
  return null;
}
