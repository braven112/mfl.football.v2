/**
 * Throwback Week on the live-scoring board — the part both leagues' routes
 * share.
 *
 * Extracted rather than copied into the AFL page: the two `live-scoring.astro`
 * files are already siblings, and this is ~40 lines of security-shaped logic
 * (who may dress which team) that must never drift between them. The pages
 * keep only the call.
 *
 * The single overlay point is still `applyThrowbackOverrides`, which mutates
 * `configTeams` BEFORE `buildTeamsMap()` so the scoreboard, matchup pairings,
 * hero and demo replay all pick the era up for free.
 */

import type { AuthUser } from './auth';
import { isCommissionerOrAdmin } from './auth';
import { getEligibleThrowbackEras } from './throwback-identity';
import { getAllThrowbackPreferences } from './throwback-store';
import { applyThrowbackOverrides, type ConfigTeam } from './live-scoring-data';
import { isThrowbackWeekForScope, type ThrowbackScope } from './throwback-scope';

/**
 * Try-before-save preview state, driving the "Save this era" bar above the
 * scoreboard. `ownSave` is false when a commissioner is previewing another
 * franchise — view-only, because the preference API is deliberately
 * owner-scoped with no commissioner override.
 */
export interface ThrowbackPreview {
  yearStart: number;
  eraName: string;
  teamName: string;
  ownSave: boolean;
}

export interface ThrowbackBoardOptions {
  configTeams: ConfigTeam[];
  week: number;
  scope: ThrowbackScope;
  /** The MFL id of the league this ROUTE serves, for the session check. */
  leagueId: string;
  authUser: AuthUser | null;
  searchParams: URLSearchParams;
}

export interface ThrowbackBoardResult {
  configTeams: ConfigTeam[];
  /** True when this week actually runs a throwback in this league. */
  active: boolean;
  preview: ThrowbackPreview | null;
}

/**
 * Resolve every franchise's era for a live-scoring render, applying the
 * owner's stored picks plus any `?previewEra` in play.
 *
 * Returns `configTeams` untouched when it isn't this league's throwback week,
 * so the caller can assign unconditionally.
 */
export async function applyThrowbackToBoard(
  options: ThrowbackBoardOptions
): Promise<ThrowbackBoardResult> {
  const { configTeams, week, scope, leagueId, authUser, searchParams } = options;

  if (!isThrowbackWeekForScope(week, scope)) {
    return { configTeams, active: false, preview: null };
  }

  const ownerOverrides = await getAllThrowbackPreferences(
    configTeams.map((t) => t.franchiseId),
    scope
  );

  let preview: ThrowbackPreview | null = null;

  // Try-before-save: ?previewEra={yearStart} lets a signed-in owner see an era
  // on THEIR OWN team without persisting it (the picker's per-card Preview
  // links use this), and only for an era the picker would actually offer.
  // Commissioners may add ?previewFranchise={id} to dress ANY team for
  // validation — still view-only; non-admins get the param ignored.
  const previewEraParam = searchParams.get('previewEra');
  const previewEra = previewEraParam ? parseInt(previewEraParam, 10) : NaN;
  const userFranchiseId = authUser?.franchiseId;
  // League scoping: franchiseIds overlap across leagues, so only a session for
  // THIS league may dress a team here (or pass the admin gate).
  const isLeagueSession = !!authUser && authUser.leagueId === leagueId;

  if (Number.isFinite(previewEra) && userFranchiseId && isLeagueSession) {
    const previewFranchiseParam = searchParams.get('previewFranchise');
    const isAdmin = isCommissionerOrAdmin(authUser);
    const targetFranchiseId =
      previewFranchiseParam && isAdmin ? previewFranchiseParam : userFranchiseId;

    const targetTeam = configTeams.find((t) => t.franchiseId === targetFranchiseId);
    const chosen = targetTeam
      ? getEligibleThrowbackEras(
          targetTeam as Parameters<typeof getEligibleThrowbackEras>[0],
          scope
        ).find((e) => e.yearStart === previewEra)
      : undefined;

    if (chosen && targetTeam) {
      ownerOverrides[targetFranchiseId] = previewEra;
      preview = {
        yearStart: previewEra,
        eraName: chosen.name,
        teamName: targetTeam.name,
        ownSave: targetFranchiseId === userFranchiseId,
      };
    }
  }

  return {
    configTeams: applyThrowbackOverrides(configTeams, true, ownerOverrides, scope),
    active: true,
    preview,
  };
}
