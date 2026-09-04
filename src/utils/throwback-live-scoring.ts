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
import {
  eraPickKey,
  getEligibleThrowbackEras,
  parseThrowbackPickKey,
  throwbackPickKey,
  type ThrowbackPick,
} from './throwback-identity';
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
  /**
   * The former slot an INHERITED era came from, carried so "Save this era"
   * stores the era actually being previewed. Without it the save sends a bare
   * year, and a franchise that has its own era starting that year saves that
   * one instead — silently the wrong identity for exactly the franchises
   * lineage exists for.
   */
  sourceFranchiseId?: string;
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

  const ownerOverrides: Record<string, ThrowbackPick> = await getAllThrowbackPreferences(
    configTeams.map((t) => t.franchiseId),
    scope
  );

  let preview: ThrowbackPreview | null = null;

  // Try-before-save: ?previewEra={key} lets a signed-in owner see an era on
  // THEIR OWN team without persisting it (the picker's per-card Preview links
  // use this), and only for an era the picker would actually offer. The key is
  // a bare year for the franchise's own era and `{slot}:{year}` for one
  // inherited from a slot it used to occupy — the same value the radio and
  // the stored preference use.
  // Commissioners may add ?previewFranchise={id} to dress ANY team for
  // validation — still view-only; non-admins get the param ignored.
  const previewEraParam = searchParams.get('previewEra');
  const previewPick = previewEraParam ? parseThrowbackPickKey(previewEraParam) : null;
  const userFranchiseId = authUser?.franchiseId;
  // League scoping: franchiseIds overlap across leagues, so only a session for
  // THIS league may dress a team here (or pass the admin gate).
  const isLeagueSession = !!authUser && authUser.leagueId === leagueId;

  if (previewPick && userFranchiseId && isLeagueSession) {
    const previewFranchiseParam = searchParams.get('previewFranchise');
    const isAdmin = isCommissionerOrAdmin(authUser);
    const targetFranchiseId =
      previewFranchiseParam && isAdmin ? previewFranchiseParam : userFranchiseId;

    const targetTeam = configTeams.find((t) => t.franchiseId === targetFranchiseId);
    const chosen = targetTeam
      ? getEligibleThrowbackEras(
          targetTeam as Parameters<typeof getEligibleThrowbackEras>[0],
          scope,
          configTeams as Parameters<typeof getEligibleThrowbackEras>[2]
        ).find((e) => eraPickKey(e) === throwbackPickKey(previewPick))
      : undefined;

    if (chosen && targetTeam) {
      ownerOverrides[targetFranchiseId] = previewPick;
      preview = {
        yearStart: previewPick.yearStart,
        sourceFranchiseId: previewPick.sourceFranchiseId ?? undefined,
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
