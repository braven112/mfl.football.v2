/**
 * Shared data loading for roster pages (roster, analytics, planner).
 * Extracts common team context, auth, and preference resolution
 * to avoid duplicating ~100 lines of setup across 3 pages.
 */

import leagueAssets from '../data/theleague.assets.json';
import { getAuthUser } from './auth';
import {
  getTheLeaguePreference,
  setTheLeaguePreference,
  resolveTeamSelection,
} from './team-preferences';
import { getCurrentLeagueYear, getCurrentSeasonYear } from './league-year';
import { resolveLeaguePath } from './nav-utils';

export interface TeamInfo {
  id: string;
  name: string;
  division: string;
  icon: string;
}

export interface BaseRosterContext {
  teamsList: TeamInfo[];
  teamLookup: Record<string, TeamInfo>;
  divisionOrder: string[];
  defaultTeamId: string;
  defaultSeason: string;
  currentLeagueYear: number;
  currentSeasonYear: number;
  authUser: ReturnType<typeof getAuthUser>;
  isLoggedIn: boolean;
  lastFetched: Date | null;
  hideLeaguePrefix: boolean;
  r: (path: string) => string;
}

const DIVISION_ORDER = ['Northwest', 'Southwest', 'Central', 'East'];

/**
 * Normalize franchise IDs so "8" and "0008" resolve to the same team
 */
function normalizeFranchiseId(id: string | undefined | null): string | null {
  if (!id) return null;
  const trimmed = `${id}`.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
}

/**
 * Build the sorted teams list and lookup from league assets.
 */
export function buildTeamsData(): { teamsList: TeamInfo[]; teamLookup: Record<string, TeamInfo> } {
  const teamsList = (leagueAssets.teams ?? [])
    .map((team: any) => ({
      id: team.id,
      name: team.name,
      division: team.division ?? '',
      icon: team.assets?.icons?.[0]?.relativePath ?? '',
    }))
    .sort((a: TeamInfo, b: TeamInfo) => {
      const divIndexA = DIVISION_ORDER.indexOf(a.division);
      const divIndexB = DIVISION_ORDER.indexOf(b.division);
      if (divIndexA !== divIndexB) return divIndexA - divIndexB;
      return a.name.localeCompare(b.name);
    });

  const teamLookup = Object.fromEntries(teamsList.map((team) => [team.id, team]));
  return { teamsList, teamLookup };
}

/**
 * Load base roster context shared by all roster pages.
 * Handles team resolution, auth, preferences, and common metadata.
 */
export function loadBaseRosterContext(astro: {
  url: URL;
  request: Request;
  cookies: any;
  locals: Record<string, any>;
}): BaseRosterContext {
  const { teamsList, teamLookup } = buildTeamsData();

  // Auth
  const authUser = getAuthUser(astro.request);
  const isLoggedIn = !!authUser;
  const userFranchiseId = normalizeFranchiseId(authUser?.franchiseId);

  // URL params for team preference
  const myTeamParam = astro.url?.searchParams?.get('myteam');
  const franchiseParam =
    astro.url?.searchParams?.get('franchise') ??
    astro.url?.searchParams?.get('team') ??
    astro.url?.searchParams?.get('franchiseId');

  // Set cookie if myteam param exists
  if (myTeamParam) {
    setTheLeaguePreference(astro.cookies, myTeamParam);
  }

  // Get cookie preference
  const cookiePreference = getTheLeaguePreference(astro.cookies);

  // Resolve team
  const defaultTeamId = resolveTeamSelection({
    myTeamParam,
    franchiseParam,
    cookiePreference: cookiePreference?.franchiseId,
    authUserFranchise: userFranchiseId,
    defaultTeam: teamsList[Math.floor(Math.random() * teamsList.length)]?.id || '0001',
  });

  // Years
  const currentLeagueYear = getCurrentLeagueYear();
  const currentSeasonYear = getCurrentSeasonYear();

  // Season resolution — load roster modules to find available seasons
  const defaultSeason = String(currentLeagueYear);

  // Last fetched timestamp
  const fetchMetaFeeds = import.meta.glob(
    '../../data/theleague/mfl-feeds/*/fetch.meta.json',
    { eager: true }
  );
  const getModuleData = (mod: any) =>
    mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
  const fetchMetaKey = Object.keys(fetchMetaFeeds).find(
    (path) => path.includes(`/${currentLeagueYear}/`)
  );
  const fetchMeta = fetchMetaKey ? getModuleData(fetchMetaFeeds[fetchMetaKey]) : null;
  const lastFetched = fetchMeta?.lastFetched ? new Date(fetchMeta.lastFetched) : null;

  // League path resolver
  const hideLeaguePrefix = astro.locals.hideLeaguePrefix ?? false;
  const r = (path: string) => resolveLeaguePath(path, hideLeaguePrefix);

  return {
    teamsList,
    teamLookup,
    divisionOrder: DIVISION_ORDER,
    defaultTeamId,
    defaultSeason,
    currentLeagueYear,
    currentSeasonYear,
    authUser,
    isLoggedIn,
    lastFetched,
    hideLeaguePrefix,
    r,
  };
}
