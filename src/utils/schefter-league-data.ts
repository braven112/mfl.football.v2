/**
 * Schefter league DATA accessors — feed + team-config selection.
 *
 * Split from schefter-league.ts on purpose: these eager JSON globs pull
 * ~1.3MB of feed data into the importing module's graph. Routes that only
 * need league RESOLUTION (tips-remaining, cooker-status, hot-topics, …)
 * import schefter-league.ts and never touch this file; only the routes that
 * actually read a feed/config (tip submit, thread, rumor-impression,
 * most-named, admin stats) pay for the JSON.
 *
 * The feed itself is LIVE: getSchefterFeed reads Redis per request (memoized
 * briefly), because the committed file is only a daily snapshot since the
 * feed moved off git (scripts/lib/schefter-feed-store.mjs).
 *
 * Selection goes through the registry (`schefterFeedPath`, `configPath`) and
 * THROWS for a league without the `schefterFeed` feature — matching the
 * repo's fail-loudly convention, so a league is never silently served
 * TheLeague's data. A new league is wired by its registry entry alone.
 */

import { getLeagueBySlug, type LeagueDefinition } from '../config/leagues';
import { getLeagueConfig } from './league-config';
import type { SchefterFeed } from '../types/schefter';
import { getRedis } from './redis-client';
import { schefterFeedKey } from '../../scripts/lib/schefter-keys.mjs';
import { mergeFeed } from '../../scripts/lib/merge-schefter-feed.mjs';

export interface LeagueTeamConfig {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  division?: string;
  conference?: string;
  tier?: string;
}

export interface SchefterLeagueConfig {
  teams: LeagueTeamConfig[];
}

/** Every league's feed, keyed by the registry's `schefterFeedPath`. */
const FEED_FILES = import.meta.glob<SchefterFeed>(
  ['../../data/*/schefter-feed.json', '../data/*/schefter-feed.json'],
  { eager: true, import: 'default' },
);
const FEEDS_BY_PATH = new Map(
  Object.entries(FEED_FILES).map(([k, v]) => [
    k.startsWith('../../') ? k.slice('../../'.length) : `src/${k.slice('../'.length)}`,
    v,
  ]),
);

/** A league is wired here exactly when it runs the Schefter feed. */
function assertSchefterLeague(league: LeagueDefinition, fn: string): void {
  if (!league.features?.schefterFeed) {
    throw new Error(`${fn}: league "${league.slug}" does not run the Schefter feed`);
  }
}

/**
 * The league's feed as committed — the daily snapshot (scripts/lib/schefter-feed-store.mjs).
 * Throws for a league without the schefterFeed feature.
 */
export function getBundledSchefterFeed(league: LeagueDefinition): SchefterFeed {
  assertSchefterLeague(league, 'getBundledSchefterFeed');
  const feed = bundledFeedFile(league);
  if (!feed) throw new Error(`getBundledSchefterFeed: no feed file for league "${league.slug}"`);
  return feed;
}

function bundledFeedFile(league: LeagueDefinition): SchefterFeed | undefined {
  const feedPath =
    (league as { schefterFeedPath?: string }).schefterFeedPath ?? `data/${league.slug}/schefter-feed.json`;
  return FEEDS_BY_PATH.get(feedPath);
}

const EMPTY_FEED: SchefterFeed = { lastScanTimestamp: '', lastProcessedMflTimestamp: '0', posts: [] };

/** How long one server instance reuses a feed it read from Redis. */
export const LIVE_FEED_TTL_MS = 30_000;

const liveFeedMemo = new Map<string, { at: number; feed: Promise<SchefterFeed> }>();

async function readLiveFeed(league: LeagueDefinition, bundled: SchefterFeed): Promise<SchefterFeed> {
  try {
    const redis = await getRedis();
    if (!redis) return bundled;
    const raw = await redis.get<SchefterFeed | string>(schefterFeedKey(league.navSlug));
    const live = typeof raw === 'string' ? (JSON.parse(raw) as SchefterFeed) : raw;
    if (!live || !Array.isArray(live.posts)) return bundled;
    // Fold the snapshot in too, so a post that reached only git (a writer that
    // ran without Redis credentials) shows the moment its build deploys.
    return mergeFeed(bundled, live) as SchefterFeed;
  } catch (err) {
    console.warn(`[schefter-feed] live read failed for ${league.slug}; serving the snapshot:`, err);
    return bundled;
  }
}

/**
 * The league's live Schefter feed: Redis, where every writer publishes, with
 * the committed snapshot as the fallback when Redis is empty or unreachable.
 * Memoized per server instance for LIVE_FEED_TTL_MS. Throws for a league
 * without the schefterFeed feature.
 */
export function getSchefterFeed(league: LeagueDefinition, now: number = Date.now()): Promise<SchefterFeed> {
  const bundled = getBundledSchefterFeed(league);
  const hit = liveFeedMemo.get(league.slug);
  if (hit && now - hit.at < LIVE_FEED_TTL_MS) return hit.feed;
  const feed = readLiveFeed(league, bundled);
  liveFeedMemo.set(league.slug, { at: now, feed });
  return feed;
}

/**
 * The feed for a page that renders whatever a league has: the live feed for a
 * league that runs Schefter (an empty one until its first post exists), the
 * committed file for one that does not, or null when there is neither. Never
 * throws — a news page must not 500 over a league with no feed yet.
 */
export async function getSchefterFeedIfAny(league: LeagueDefinition): Promise<SchefterFeed | null> {
  if (!league.features?.schefterFeed) return bundledFeedFile(league) ?? null;
  return bundledFeedFile(league) ? getSchefterFeed(league) : readLiveFeed(league, EMPTY_FEED);
}

/** Test seam: forget memoized live feeds. */
export function resetLiveFeedMemo(): void {
  liveFeedMemo.clear();
}

/** The league's team config. Throws for a league without the schefterFeed feature. */
export function getSchefterLeagueConfig(league: LeagueDefinition): SchefterLeagueConfig {
  assertSchefterLeague(league, 'getSchefterLeagueConfig');
  return getLeagueConfig(league.slug) as unknown as SchefterLeagueConfig;
}

/** Find a team by 4-digit franchise id in the league's config. */
export function findLeagueTeam(
  league: LeagueDefinition,
  franchiseId: string,
): LeagueTeamConfig | undefined {
  return getSchefterLeagueConfig(league).teams.find(
    (t) => t.franchiseId === franchiseId,
  );
}

/** getSchefterFeed by registry slug, for routes that name their own league. */
export async function getSchefterFeedBySlug(slug: string): Promise<SchefterFeed> {
  const league = getLeagueBySlug(slug);
  if (!league) throw new Error(`getSchefterFeedBySlug: unknown league "${slug}"`);
  return getSchefterFeed(league);
}
