/**
 * Sunday Ticket contributions — one fantasy league's "my players this week"
 * for the slate (`sunday-ticket-slate.ts`).
 *
 * Two loaders, one shape. A league this site runs (in the registry) reads the
 * feeds already synced under `data/<league>/mfl-feeds/<year>/`; any other
 * league the owner belongs to is read live from MFL with the owner's cookie
 * and cached briefly. Both funnel through `buildContribution`, which is pure
 * so it can be tested against real payload shapes.
 *
 * Feed rules this honors (each one shipped as a bug somewhere on the site):
 *  - MFL collapses a one-element list to a bare object — normalize every list.
 *  - `res.ok` is not "the call worked": a throttled or malformed request is an
 *    HTTP 200 with an `{ error }` body, and a private league answers an
 *    unauthenticated read with an EMPTY 200. Check the payload's own shape,
 *    and never cache an empty answer over a full one.
 *  - A projections feed is for ONE week (`projectedScores.week`). Reading it
 *    for another week would rank this Sunday by last Sunday's numbers, so a
 *    mismatch means "no projections", never "close enough".
 *  - The emptied-feed sentinel is a single `{ id: "", score: "" }` row.
 *  - "No lineup on file" and "couldn't read it" both yield zero starters; the
 *    whole roster stands in for either, flagged `lineupResolved: false`.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { LeagueDefinition } from '../config/leagues';
import {
  extractLineupStarters,
  findWeekResultsEntry,
  loadRostersFeedFromDisk,
  loadWeeklyResultsFeedFromDisk,
} from './lineup-sources';
import type { PlayerIdentity } from './player-map';
import { buildMflExportUrl } from './mfl-url';
import { mflFetch } from './mfl-fetch';
import { getRedis } from './redis-client';
import type { ContributionPlayer, LeagueContribution } from './sunday-ticket-slate';

/** Who is contributing: the league and the owner's franchise in it. */
export interface ContributionSource {
  leagueId: string;
  leagueName: string;
  franchiseId: string;
  franchiseName: string;
  /** Best-ball leagues have no lineups — every rostered player counts. */
  bestBall?: boolean;
}

export interface BuildContributionInput {
  source: ContributionSource;
  /** A `rosters` export payload (whole league or `FRANCHISE=`-scoped). */
  rostersPayload: any;
  /** This week's weeklyResults entry (from `findWeekResultsEntry`), or null. */
  weekEntry: any;
  /** A `projectedScores` export payload, or null. */
  projectionsPayload: any;
  week: number;
  identity: Map<string, PlayerIdentity>;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** Does a rosters payload carry franchises? Same question `lineup-sources` asks. */
export function rostersHaveFranchises(payload: any): boolean {
  const franchises = payload?.rosters?.franchise;
  if (Array.isArray(franchises)) return franchises.length > 0;
  return Boolean(franchises?.id);
}

/**
 * Projection map for `week` from a projectedScores payload — EMPTY when the
 * payload is for a different week, has no week (the sentinel), or is not a
 * projections payload at all.
 */
export function projectionsForWeek(payload: any, week: number): Map<string, number> {
  const map = new Map<string, number>();
  const block = payload?.projectedScores ?? payload?.default?.projectedScores;
  if (!block) return map;
  const feedWeek = parseInt(block.week ?? '', 10);
  if (Number.isFinite(feedWeek) && feedWeek !== week) return map;
  for (const row of asArray<any>(block.playerScore)) {
    if (!row?.id) continue;
    const score = parseFloat(row.score);
    if (Number.isFinite(score)) map.set(row.id, score);
  }
  return map;
}

/** Player ids on the franchise's active roster, in MFL's order. IR and taxi are not on the field. */
function activeRosterIds(rostersPayload: any, franchiseId: string): string[] | null {
  const franchise = asArray<any>(rostersPayload?.rosters?.franchise).find((f) => f?.id === franchiseId);
  if (!franchise) return null;
  return asArray<any>(franchise.player)
    .filter((p) => p?.id && (p.status === undefined || p.status === 'ROSTER'))
    .map((p) => p.id as string);
}

export function buildContribution(input: BuildContributionInput): LeagueContribution | null {
  const { source, week, identity } = input;
  const rosterIds = activeRosterIds(input.rostersPayload, source.franchiseId);
  if (rosterIds === null) return null;

  const starters = source.bestBall ? [] : extractLineupStarters(input.weekEntry, source.franchiseId);
  const lineupResolved = starters.length > 0;
  const ids = lineupResolved ? starters.map((s) => s.id) : rosterIds;

  const projections = projectionsForWeek(input.projectionsPayload, week);
  const players: ContributionPlayer[] = ids.map((playerId) => {
    const who = identity.get(playerId);
    const player: ContributionPlayer = {
      playerId,
      name: who?.name ?? `Player ${playerId}`,
      position: who?.position ?? '',
      nflTeam: who?.nflTeam ?? '',
      proj: projections.get(playerId) ?? 0,
    };
    if (who?.headshot) player.headshot = who.headshot;
    return player;
  });

  return {
    leagueId: source.leagueId,
    leagueName: source.leagueName,
    franchiseId: source.franchiseId,
    franchiseName: source.franchiseName,
    lineupResolved,
    players,
  };
}

// ── Registered leagues: disk feeds ───────────────────────────────────────

function readFeedJson(league: LeagueDefinition, leagueYear: number, file: string): any | null {
  try {
    const filePath = path.join(process.cwd(), league.dataPath, 'mfl-feeds', String(leagueYear), file);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
  } catch {
    return null;
  }
}

export interface RegisteredContributionInput {
  league: LeagueDefinition;
  franchiseId: string;
  franchiseName: string;
  week: number;
  /** The league's OWN year (each league rolls on its own date — `getLeagueYearForSlug`). */
  leagueYear: number;
  identity: Map<string, PlayerIdentity>;
}

/** A league this site syncs: everything comes off the committed feeds. */
export function loadRegisteredContribution(input: RegisteredContributionInput): LeagueContribution | null {
  const { league, week, leagueYear } = input;
  const slug = league.slug as Parameters<typeof loadRostersFeedFromDisk>[0];
  const rostersPayload = loadRostersFeedFromDisk(slug, leagueYear);
  if (!rostersPayload) return null;
  const weekEntry = findWeekResultsEntry(loadWeeklyResultsFeedFromDisk(slug, leagueYear), week);
  const projectionsPayload = readFeedJson(league, leagueYear, 'projectedScores.json');

  return buildContribution({
    source: {
      leagueId: league.id,
      leagueName: league.name,
      franchiseId: input.franchiseId,
      franchiseName: input.franchiseName,
      bestBall: league.bestBall === true,
    },
    rostersPayload,
    weekEntry,
    projectionsPayload,
    week,
    identity: input.identity,
  });
}

// ── Outside leagues: live MFL reads with the owner's cookie ──────────────

const OUTSIDE_TTL_SECONDS = 15 * 60;

interface OutsideBundle {
  rosters: any;
  weekEntry: any;
  projections: any;
  fetchedAt: number;
}

export interface OutsideContributionInput {
  source: ContributionSource;
  /** The league's own MFL host from `myleagues` (`https://www49.…`); null → the api host. */
  host: string | null;
  year: number;
  week: number;
  mflUserCookie: string;
  identity: Map<string, PlayerIdentity>;
}

function outsideCacheKey(leagueId: string, year: number, week: number, franchiseId: string): string {
  return `st:outside:${leagueId}:${year}:w${week}:${franchiseId}`;
}

async function readExport(url: string, mflUserCookie: string): Promise<any | null> {
  try {
    const response = await mflFetch({ url, method: 'GET', mflUserCookie });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

/** The three exports behind one outside-league contribution, or null when rosters didn't answer. */
export async function fetchOutsideBundle(input: OutsideContributionInput): Promise<OutsideBundle | null> {
  const { source, year, week, mflUserCookie } = input;
  const host = input.host ?? undefined;
  const urlFor = (type: string, params: Record<string, string | number>) =>
    buildMflExportUrl({ type, leagueId: source.leagueId, year, params, host });

  const [rosters, weekly, projections] = await Promise.all([
    readExport(urlFor('rosters', { FRANCHISE: source.franchiseId }), mflUserCookie),
    readExport(urlFor('weeklyResults', { W: week }), mflUserCookie),
    readExport(urlFor('projectedScores', { W: week }), mflUserCookie),
  ]);

  // A private league answers a rejected read with an empty 200; that is not a
  // roster, and it must not be cached as one.
  if (!rostersHaveFranchises(rosters)) return null;

  return {
    rosters,
    weekEntry: findWeekResultsEntry(weekly, week, { allowUnlabeled: true }),
    projections,
    fetchedAt: Date.now(),
  };
}

/**
 * A league outside this site: live reads through the owner's cookie, cached
 * 15 minutes per (league, week, franchise). Redis down → still fetch, just
 * uncached. Rate-limit the CALLER (the page) per session franchise before a
 * burst of cache misses; a loader can't know who is asking.
 */
export async function loadOutsideContribution(input: OutsideContributionInput): Promise<LeagueContribution | null> {
  const { source, year, week } = input;
  const key = outsideCacheKey(source.leagueId, year, week, source.franchiseId);
  const redis = await getRedis().catch(() => null);

  let bundle: OutsideBundle | null = null;
  if (redis) {
    try {
      const cached = await redis.get<OutsideBundle>(key);
      if (cached?.rosters && Date.now() - (cached.fetchedAt ?? 0) <= OUTSIDE_TTL_SECONDS * 1000) {
        bundle = cached;
      }
    } catch (error) {
      console.warn('[sunday-ticket] cache read failed:', error);
    }
  }

  if (!bundle) {
    bundle = await fetchOutsideBundle(input);
    if (!bundle) return null;
    if (redis) {
      try {
        await redis.set(key, bundle, { ex: OUTSIDE_TTL_SECONDS });
      } catch (error) {
        console.warn('[sunday-ticket] cache write failed:', error);
      }
    }
  }

  return buildContribution({
    source,
    rostersPayload: bundle.rosters,
    weekEntry: bundle.weekEntry,
    projectionsPayload: bundle.projections,
    week,
    identity: input.identity,
  });
}
