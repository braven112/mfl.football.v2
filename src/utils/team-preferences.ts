/**
 * Team Preference Cookie Utilities
 * Handles persistent team preferences across TheLeague and AFL Fantasy
 */

import type { AstroCookies } from 'astro';
import leagueAssets from '../data/theleague.assets.json';
import aflAssets from '../../data/afl-fantasy/afl.assets.json';

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
  conferenceId: string; // "A" or "B"
  competitionId: string; // "Premier League" or "D-League"
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
};

/**
 * Normalize franchise ID to 4-digit format
 * Converts "0000" (commissioner) to "0001"
 */
function normalizeFranchiseId(franchiseId: string): string {
  if (!franchiseId) return '0001';
  const trimmed = franchiseId.trim();
  if (!trimmed) return '0001';

  // Pad to 4 digits if it's a number
  const padded = /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;

  // Convert commissioner (0000) to first team (0001)
  return padded === '0000' ? '0001' : padded;
}

/**
 * Validate franchise ID exists in league
 */
export function validateFranchiseId(franchiseId: string, league: 'theleague' | 'afl' = 'theleague'): boolean {
  if (!franchiseId) return false;

  const normalized = normalizeFranchiseId(franchiseId);

  if (league === 'theleague') {
    // Check if franchise ID exists in theleague assets
    return leagueAssets.teams.some(team => team.id === normalized);
  } else {
    // Check if franchise ID exists in AFL assets
    return aflAssets.teams.some(team => team.id === normalized);
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
  const team = aflAssets.teams.find(t => t.id === normalized);

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
 * Get team selection based on priority order
 * Priority: myteam param → franchise param → cookie → auth user → default
 */
export function resolveTeamSelection(params: {
  myTeamParam?: string | null;
  franchiseParam?: string | null;
  cookiePreference?: string | null;
  authUserFranchise?: string | null;
  defaultTeam?: string;
}): string {
  const {
    myTeamParam,
    franchiseParam,
    cookiePreference,
    authUserFranchise,
    defaultTeam = '0001',
  } = params;

  // Priority order
  const candidates = [
    myTeamParam,
    franchiseParam,
    cookiePreference,
    authUserFranchise,
    defaultTeam,
  ];

  // Find first valid candidate
  for (const candidate of candidates) {
    if (candidate) {
      const normalized = normalizeFranchiseId(candidate);
      if (validateFranchiseId(normalized, 'theleague')) {
        return normalized;
      }
    }
  }

  // Final fallback
  return '0001';
}

/**
 * Get AFL team selection based on priority order
 * Priority: myteam param → franchise param → cookie → default
 */
export function resolveAFLTeamSelection(params: {
  myTeamParam?: string | null;
  franchiseParam?: string | null;
  cookiePreference?: string | null;
  defaultTeam?: string;
}): string {
  const {
    myTeamParam,
    franchiseParam,
    cookiePreference,
    defaultTeam = '0001',
  } = params;

  // Priority order
  const candidates = [
    myTeamParam,
    franchiseParam,
    cookiePreference,
    defaultTeam,
  ];

  // Find first valid candidate
  for (const candidate of candidates) {
    if (candidate) {
      const normalized = normalizeFranchiseId(candidate);
      if (validateFranchiseId(normalized, 'afl')) {
        return normalized;
      }
    }
  }

  // Final fallback
  return '0001';
}
