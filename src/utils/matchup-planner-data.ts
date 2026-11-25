/**
 * Server-side loader for the Matchup Planner page (Brandon only).
 *
 * Reads one league-year's committed feeds through league-data.ts (the store,
 * in production), MFL's live `pointsAllowed` export for the official season
 * totals, and the live rosters (60 s Redis cache, falling back to the
 * committed rosters feed). Pure maths lives in matchup-planner.ts.
 */

import { getLeagueBySlug, type LeagueDefinition } from '../config/leagues';
import { getCurrentLeagueYear } from './league-year';
import { leagueFeedPath, preloadLeagueData, readLeagueDataSync } from './league-data';
import { buildMflExportUrl } from './mfl-url';
import { fetchWithTimeout } from './fetch-with-timeout';
import { getCachedRosterFranchises } from './mfl-roster-cache';
import { sameConference } from './afl-conference';
import { siteOwnerFranchise } from './site-owner';
import {
  buildWeeklyAllowed,
  indexPlayers,
  indexSchedule,
  parseOfficialTotals,
  scheduleTeams,
  type PlannerPlayer,
  type ScheduleIndex,
  type TeamPositionPoints,
  type WeeklyAllowed,
} from './matchup-planner';

const FEEDS = ['nflSchedule-full.json', 'players.json', 'playerScores-by-week.json', 'rosters.json'];

/** MFL's season totals change once a game ends; half an hour is plenty fresh. */
const OFFICIAL_TTL_MS = 30 * 60 * 1000;
const officialCache = new Map<string, { at: number; totals: TeamPositionPoints }>();

async function loadOfficialTotals(league: LeagueDefinition, year: number): Promise<TeamPositionPoints | null> {
  const key = `${league.id}:${year}`;
  const hit = officialCache.get(key);
  if (hit && Date.now() - hit.at < OFFICIAL_TTL_MS) return hit.totals;
  try {
    const url = buildMflExportUrl({ type: 'pointsAllowed', leagueId: league.id, year });
    const res = await fetchWithTimeout(url, { timeoutMs: 8000 });
    if (!res.ok) return hit?.totals ?? null;
    const totals = parseOfficialTotals(await res.json());
    // A partial answer (MFL hiccup) would rank 12 teams as the whole league.
    if (Object.keys(totals).length < 30) return hit?.totals ?? null;
    officialCache.set(key, { at: Date.now(), totals });
    return totals;
  } catch {
    return hit?.totals ?? null;
  }
}

export interface PlannerData {
  league: LeagueDefinition;
  year: number;
  schedule: ScheduleIndex;
  teams: string[];
  players: Map<string, PlannerPlayer>;
  scoresByWeek: Record<string, Record<string, number>>;
  weekly: WeeklyAllowed;
  official: TeamPositionPoints | null;
  /** Player ids on the owner's roster, with MFL's roster status. */
  mine: Map<string, string>;
  /** Player ids someone in the owner's player pool rosters (his conference in the AFL). */
  rostered: Set<string>;
  rostersLive: boolean;
}

export async function loadPlannerData(slug: string): Promise<PlannerData | null> {
  const league = getLeagueBySlug(slug);
  if (!league) return null;
  // MFL feed directories are keyed by the LEAGUE year (CLAUDE.md).
  const year = getCurrentLeagueYear();
  const paths = FEEDS.map((f) => leagueFeedPath(league.dataPath, year, f));
  const [, official, live] = await Promise.all([
    preloadLeagueData(paths),
    loadOfficialTotals(league, year),
    getCachedRosterFranchises(String(year), league.id).catch(() => null),
  ]);
  const read = (file: string) => readLeagueDataSync<any>(leagueFeedPath(league.dataPath, year, file));

  const schedulePayload = read('nflSchedule-full.json');
  if (!schedulePayload) return null;
  const schedule = indexSchedule(schedulePayload);
  const players = indexPlayers(read('players.json'));
  const scoresByWeek = (read('playerScores-by-week.json')?.weeks ?? {}) as Record<string, Record<string, number>>;
  const weekly = buildWeeklyAllowed(scoresByWeek, players, schedule);

  const franchises: Array<{ id: string; player?: Array<{ id: string; status?: string }> }> =
    live ?? (Array.isArray(read('rosters.json')?.rosters?.franchise) ? read('rosters.json').rosters.franchise : []);
  const owner = siteOwnerFranchise(slug);
  const conferenceScoped = slug === 'afl-fantasy' && !!owner;
  const mine = new Map<string, string>();
  const rostered = new Set<string>();
  for (const f of franchises) {
    // An AFL player is routinely rostered in both conferences; only the
    // owner's own conference decides whether he can pick him up.
    if (conferenceScoped && !sameConference(f.id, owner!, 'afl-fantasy')) continue;
    for (const p of f.player ?? []) {
      rostered.add(p.id);
      if (f.id === owner) mine.set(p.id, p.status ?? 'ROSTER');
    }
  }

  return {
    league,
    year,
    schedule,
    teams: scheduleTeams(schedule),
    players,
    scoresByWeek,
    weekly,
    official,
    mine,
    rostered,
    rostersLive: !!live,
  };
}
