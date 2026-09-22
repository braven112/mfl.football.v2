/**
 * Team Preference Cookie Utilities
 * Handles persistent team preferences across TheLeague and AFL Fantasy
 */

import type { AstroCookies } from 'astro';
import leagueAssets from '../data/theleague.assets.json';
import aflAssets from '../../data/afl-fantasy/afl.assets.json';
import bb1Assets from '../../data/best-ball-1/bb1.assets.json';
import { getActiveTeams } from './league-assets';

/**
 * TheLeague team preference structure
 */
export interface TheLeaguePreference {
  franchiseId: string;
  lastUpdated: string;
}

/**
 * AFL team preference structure
 */
export interface AFLPreference {
  franchiseId: string;
  conferenceId: string; // "00" (American League) or "01" (National League)
  competitionId: string; // "Premier League" or "D-League"
  lastUpdated: string;
}

/**
 * Best Ball League #1 team preference structure (same simple shape as
 * TheLeague — best-ball leagues have no conference/tier structure)
 */
export interface BestBall1Preference {
  franchiseId: string;
  lastUpdated: string;
}

/**
 * Cookie configuration
 */
const COOKIE_CONFIG = {
  theLeague: {
    name: 'theleague_team_pref',
    maxAge: 365 * 24 * 60 * 60, // 1 year in seconds
    path: '/',
    sameSite: 'lax' as const,
    secure: import.meta.env.PROD, // HTTPS only in production
    httpOnly: false, // Accessible to client JS if needed
  },
  afl: {
    name: 'afl_team_pref',
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax' as const,
    secure: import.meta.env.PROD,
    httpOnly: false,
  },
  bb1: {
    name: 'bb1_team_pref',
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax' as const,
    secure: import.meta.env.PROD,
    httpOnly: false,
  },
};

/**
 * Normalize franchise ID to 4-digit format
 * Converts "0000" (commissioner) to "0001"
 */
function normalizeFranchiseId(franchiseId: string | number | null | undefined): string {
  if (franchiseId === null || franchiseId === undefined || franchiseId === '') return '0001';
  const trimmed = String(franchiseId).trim();
  if (!trimmed) return '0001';

  // Pad to 4 digits if it's a number
  const padded = /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;

  // Convert commissioner (0000) to first team (0001)
  return padded === '0000' ? '0001' : padded;
}

/**
 * Validate franchise ID exists in league
 */
export function validateFranchiseId(franchiseId: string | number | null | undefined, league: 'theleague' | 'afl' | 'bb1' = 'theleague'): boolean {
  if (franchiseId === null || franchiseId === undefined || franchiseId === '') return false;

  const normalized = normalizeFranchiseId(franchiseId);

  // Only current franchises are selectable — the assets files also carry
  // category: 'former' historical identities (including compound ids like
  // "0002, 0013") that have no rosters or per-team UI.
  if (league === 'theleague') {
    return getActiveTeams(leagueAssets).some(team => team.id === normalized);
  } else if (league === 'bb1') {
    return getActiveTeams(bb1Assets).some(team => team.id === normalized);
  } else {
    return getActiveTeams(aflAssets).some(team => team.id === normalized);
  }
}

/**
 * Get TheLeague preference from cookie
 */
export function getTheLeaguePreference(cookies: AstroCookies): TheLeaguePreference | null {
  try {
    const cookieValue = cookies.get(COOKIE_CONFIG.theLeague.name);
    if (!cookieValue?.value) return null;

    const preference = JSON.parse(cookieValue.value) as TheLeaguePreference;

    // Validate the preference structure
    if (!preference.franchiseId || !preference.lastUpdated) {
      // Corrupted cookie, clear it
      clearTheLeaguePreference(cookies);
      return null;
    }

    // Validate franchise ID exists
    if (!validateFranchiseId(preference.franchiseId, 'theleague')) {
      // Invalid franchise, clear cookie
      clearTheLeaguePreference(cookies);
      return null;
    }

    return {
      franchiseId: normalizeFranchiseId(preference.franchiseId),
      lastUpdated: preference.lastUpdated,
    };
  } catch (error) {
    // JSON parse error or other issue, clear cookie
    clearTheLeaguePreference(cookies);
    return null;
  }
}

/**
 * Set TheLeague preference cookie
 */
export function setTheLeaguePreference(cookies: AstroCookies, franchiseId: string): void {
  const normalized = normalizeFranchiseId(franchiseId);

  // Validate before setting
  if (!validateFranchiseId(normalized, 'theleague')) {
    console.warn(`[team-preferences] Invalid franchise ID: ${franchiseId}`);
    return;
  }

  const preference: TheLeaguePreference = {
    franchiseId: normalized,
    lastUpdated: new Date().toISOString(),
  };

  cookies.set(COOKIE_CONFIG.theLeague.name, JSON.stringify(preference), {
    maxAge: COOKIE_CONFIG.theLeague.maxAge,
    path: COOKIE_CONFIG.theLeague.path,
    sameSite: COOKIE_CONFIG.theLeague.sameSite,
    secure: COOKIE_CONFIG.theLeague.secure,
    httpOnly: COOKIE_CONFIG.theLeague.httpOnly,
  });
}

/**
 * Clear TheLeague preference cookie
 */
export function clearTheLeaguePreference(cookies: AstroCookies): void {
  cookies.delete(COOKIE_CONFIG.theLeague.name, {
    path: COOKIE_CONFIG.theLeague.path,
  });
}

/**
 * Get AFL team data by franchise ID
 */
export function getAFLTeamData(franchiseId: string): { conference: string; tier: string } | null {
  const normalized = normalizeFranchiseId(franchiseId);
  const team = getActiveTeams(aflAssets).find(t => t.id === normalized);

  if (!team) return null;

  return {
    conference: team.conference,
    tier: team.tier,
  };
}

/**
 * Get AFL preference from cookie
 */
export function getAFLPreference(cookies: AstroCookies): AFLPreference | null {
  try {
    const cookieValue = cookies.get(COOKIE_CONFIG.afl.name);
    if (!cookieValue?.value) return null;

    const preference = JSON.parse(cookieValue.value) as AFLPreference;

    // Validate the preference structure
    if (!preference.franchiseId || !preference.conferenceId || !preference.competitionId || !preference.lastUpdated) {
      clearAFLPreference(cookies);
      return null;
    }

    // Validate franchise ID exists in AFL
    if (!validateFranchiseId(preference.franchiseId, 'afl')) {
      clearAFLPreference(cookies);
      return null;
    }

    return {
      franchiseId: normalizeFranchiseId(preference.franchiseId),
      conferenceId: preference.conferenceId,
      competitionId: preference.competitionId,
      lastUpdated: preference.lastUpdated,
    };
  } catch (error) {
    clearAFLPreference(cookies);
    return null;
  }
}

/**
 * Set AFL preference cookie
 */
export function setAFLPreference(
  cookies: AstroCookies,
  franchiseId: string,
  conferenceId: string,
  competitionId: string
): void {
  const normalized = normalizeFranchiseId(franchiseId);

  // Validate before setting
  if (!validateFranchiseId(normalized, 'afl')) {
    console.warn(`[team-preferences] Invalid AFL franchise ID: ${franchiseId}`);
    return;
  }

  const preference: AFLPreference = {
    franchiseId: normalized,
    conferenceId,
    competitionId,
    lastUpdated: new Date().toISOString(),
  };

  cookies.set(COOKIE_CONFIG.afl.name, JSON.stringify(preference), {
    maxAge: COOKIE_CONFIG.afl.maxAge,
    path: COOKIE_CONFIG.afl.path,
    sameSite: COOKIE_CONFIG.afl.sameSite,
    secure: COOKIE_CONFIG.afl.secure,
    httpOnly: COOKIE_CONFIG.afl.httpOnly,
  });
}

/**
 * Clear AFL preference cookie
 */
export function clearAFLPreference(cookies: AstroCookies): void {
  cookies.delete(COOKIE_CONFIG.afl.name, {
    path: COOKIE_CONFIG.afl.path,
  });
}

/**
 * Get Best Ball League #1 preference from cookie
 */
export function getBestBall1Preference(cookies: AstroCookies): BestBall1Preference | null {
  try {
    const cookieValue = cookies.get(COOKIE_CONFIG.bb1.name);
    if (!cookieValue?.value) return null;

    const preference = JSON.parse(cookieValue.value) as BestBall1Preference;

    if (!preference.franchiseId || !preference.lastUpdated) {
      clearBestBall1Preference(cookies);
      return null;
    }

    if (!validateFranchiseId(preference.franchiseId, 'bb1')) {
      clearBestBall1Preference(cookies);
      return null;
    }

    return {
      franchiseId: normalizeFranchiseId(preference.franchiseId),
      lastUpdated: preference.lastUpdated,
    };
  } catch (error) {
    clearBestBall1Preference(cookies);
    return null;
  }
}

/**
 * Set Best Ball League #1 preference cookie
 */
export function setBestBall1Preference(cookies: AstroCookies, franchiseId: string): void {
  const normalized = normalizeFranchiseId(franchiseId);

  if (!validateFranchiseId(normalized, 'bb1')) {
    console.warn(`[team-preferences] Invalid Best Ball franchise ID: ${franchiseId}`);
    return;
  }

  const preference: BestBall1Preference = {
    franchiseId: normalized,
    lastUpdated: new Date().toISOString(),
  };

  cookies.set(COOKIE_CONFIG.bb1.name, JSON.stringify(preference), {
    maxAge: COOKIE_CONFIG.bb1.maxAge,
    path: COOKIE_CONFIG.bb1.path,
    sameSite: COOKIE_CONFIG.bb1.sameSite,
    secure: COOKIE_CONFIG.bb1.secure,
    httpOnly: COOKIE_CONFIG.bb1.httpOnly,
  });
}

/**
 * Clear Best Ball League #1 preference cookie
 */
export function clearBestBall1Preference(cookies: AstroCookies): void {
  cookies.delete(COOKIE_CONFIG.bb1.name, {
    path: COOKIE_CONFIG.bb1.path,
  });
}

/** Which league's franchise list a selection is validated against. */
export type TeamSelectionLeague = 'theleague' | 'afl' | 'bb1';

/**
 * Inputs to "which franchise is this viewer's team", in priority order.
 */
export interface TeamSelectionParams {
  /** `?myteam=` — an explicit, sticky choice. Highest priority. */
  myTeamParam?: string | null;
  /** `?franchise=` (or `?team=`/`?franchiseId=`) — a one-off browse-as link. */
  franchiseParam?: string | null;
  /**
   * The franchise id out of this league's preference cookie — the string, not
   * the whole preference object. `getAFLPreference(...)?.franchiseId`.
   */
  cookiePreference?: string | null;
  /**
   * The viewer's franchise IN THIS LEAGUE, or null.
   *
   * ALWAYS derive it with `franchiseIdForLeague(user, league.id)` — never a
   * bare `user.franchiseId`. Both leagues have a franchise 0001, so an
   * ungated session id makes a TheLeague owner browsing the AFL look like
   * Smokane FC's owner. This is the slot the session belongs in: behind an
   * explicit choice, ahead of any arbitrary default. Do not smuggle it
   * through `cookiePreference` or `defaultTeam`.
   */
  authUserFranchise?: string | null;
  /**
   * Explicit fallback for a viewer with no choice and no session.
   *
   * There is NO implicit default. Omit it (or pass undefined) and the
   * resolver answers `undefined`, meaning "highlight nobody" — which is what
   * a signed-out visitor to a standings or playoffs page should see. Pass one
   * only on a surface that cannot render without a team at all.
   */
  defaultTeam?: string | null;
}

/**
 * Resolve which franchise is the viewer's team.
 *
 * Priority: myteam param → franchise param → cookie → session → explicit
 * default. The first candidate that names a CURRENT franchise in `league`
 * wins; everything else is skipped, so a junk `?myteam=9999` falls through
 * rather than blanking the page.
 *
 * Returns `undefined` when nothing validates. It deliberately does NOT fall
 * back to '0001': that literal used to be hardcoded as a final return, which
 * meant the three call sites asking for "don't highlight anyone" got the
 * league's first franchise instead — Pacific Pigskins in TheLeague, Smokane
 * FC in the AFL — presented to a signed-out stranger as their own team. They
 * even wrote `|| undefined` to opt out and it could not work, because '0001'
 * is truthy.
 *
 * One body, two leagues. The per-league wrappers below differ ONLY in the
 * `league` argument; they were separate copies, and the AFL's had silently
 * drifted to having no session slot at all.
 */
export function resolveFranchiseSelection(
  league: TeamSelectionLeague,
  params: TeamSelectionParams
): string | undefined {
  const candidates = [
    params.myTeamParam,
    params.franchiseParam,
    params.cookiePreference,
    params.authUserFranchise,
    params.defaultTeam,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeFranchiseId(candidate);
    if (validateFranchiseId(normalized, league)) return normalized;
  }

  return undefined;
}

/** `resolveFranchiseSelection` for TheLeague. */
export function resolveTeamSelection(params: TeamSelectionParams): string | undefined {
  return resolveFranchiseSelection('theleague', params);
}

/** `resolveFranchiseSelection` for the AFL. */
export function resolveAFLTeamSelection(params: TeamSelectionParams): string | undefined {
  return resolveFranchiseSelection('afl', params);
}

/**
 * Resolve and write the AFL team-preference cookie in one call.
 *
 * The AFL's cookie carries the conference and tier alongside the franchise
 * id, so setting it means looking both up first. That assembly is the same
 * three lines at every call site, and leaving it inline tempts a route into
 * handing `setAFLPreference` a bare id and silently writing nothing (it
 * validates and warns).
 *
 * The WRITE still happens where the caller calls it — this must be invoked
 * from a route's frontmatter, never from an imported component, because
 * `Astro.cookies.set()` after the response headers are committed throws and
 * blanks the page. Same shape as `rememberSundayTicketChoices`.
 *
 * No-ops for an unknown franchise, so a junk `?myteam=` leaves the existing
 * preference alone rather than clearing it.
 */
export function rememberAflTeamChoice(cookies: AstroCookies, franchiseId: string | null | undefined): void {
  if (!franchiseId) return;
  const meta = getAFLTeamData(franchiseId);
  if (!meta) return;
  setAFLPreference(cookies, franchiseId, meta.conference, meta.tier);
}
