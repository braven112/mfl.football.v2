/**
 * Resolves which legacy identity (name/icon/banner) a franchise should wear
 * during a Throwback Week, as opposed to `getTeamIdentityForYear` in
 * team-names.ts which resolves identity for a *calendar year* (used by
 * Franchise History / standings). Throwback identity is chosen — by the
 * owner, or a commissioner-picked default — not derived from the date.
 */

import {
  HISTORICAL_TEAM_BANNER_FALLBACK,
  HISTORICAL_TEAM_ICON_FALLBACK,
  type FranchiseHistoryEntry,
  type TeamConfig,
  type TeamIdentity,
} from './team-names';
import {
  DEFAULT_THROWBACK_SCOPE,
  throwbackRules,
  type ThrowbackScope,
} from './throwback-scope';

function isConflicted(
  franchiseId: string,
  yearStart: number,
  scope: ThrowbackScope
): boolean {
  return throwbackRules(scope).conflicts.some(
    (c) => c.franchiseId === franchiseId && c.yearStart === yearStart
  );
}

/** True when a history entry's identity is indistinguishable from the team's current one. */
function isSameAsCurrent(team: TeamConfig, entry: FranchiseHistoryEntry): boolean {
  return entry.name === team.name && entry.icon === team.icon && entry.banner === team.banner;
}

/**
 * Eras a franchise may throw back to: its full `history[]`, minus entries
 * whose art asset is claimed by another franchise (the scope's asset
 * conflicts) and minus entries identical to the team's current identity.
 *
 * `scope` selects WHICH league's conflict list applies. It defaults to
 * TheLeague so every pre-existing call site keeps its exact behavior; an AFL
 * caller must pass 'afl' or it gets TheLeague's rules keyed by ids the two
 * leagues share (0001–0016 exist in both).
 */
export function getEligibleThrowbackEras(
  team: TeamConfig,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE
): FranchiseHistoryEntry[] {
  if (!team.history?.length) return [];
  return team.history.filter(
    (entry) =>
      !isConflicted(team.franchiseId, entry.yearStart, scope) && !isSameAsCurrent(team, entry)
  );
}

function toIdentity(entry: FranchiseHistoryEntry): TeamIdentity {
  return {
    name: entry.name,
    nameMedium: entry.nameMedium,
    nameShort: entry.nameShort,
    abbrev: entry.abbrev,
    aliases: entry.aliases,
    icon: entry.icon ?? HISTORICAL_TEAM_ICON_FALLBACK,
    banner: entry.banner ?? HISTORICAL_TEAM_BANNER_FALLBACK,
    groupMe: entry.groupMe,
    conference: entry.conference ?? undefined,
    colorPrimary: entry.colorPrimary,
    colorSecondary: entry.colorSecondary,
    isHistorical: true,
    rebrand: entry.rebrand,
  };
}

/**
 * Resolve a franchise's throwback identity: owner override -> commissioner
 * default -> earliest eligible era -> current identity (if no eligible eras
 * exist at all).
 *
 * Note on the fallback: the "each team throws back to its most recent old
 * identity" policy is implemented by the SEEDED `DEFAULT_THROWBACK_ERA` map
 * (hand-tuned per franchise, with commissioner exceptions), not here. The
 * earliest-eligible-era branch below is a last resort that only fires when a
 * franchise has eligible eras but no (or an invalid) seeded default.
 *
 * @param ownerOverrideYearStart - `yearStart` of the era the owner picked
 *   via the league's throwback-settings page, if any.
 * @param scope - which league's era rules apply. Defaults to TheLeague; see
 *   `getEligibleThrowbackEras` for why an AFL caller must pass its own.
 */
export function resolveThrowbackIdentity(
  team: TeamConfig,
  ownerOverrideYearStart?: number,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE
): TeamIdentity {
  const eligible = getEligibleThrowbackEras(team, scope);

  if (ownerOverrideYearStart !== undefined) {
    const chosen = eligible.find((e) => e.yearStart === ownerOverrideYearStart);
    if (chosen) return toIdentity(chosen);
  }

  const defaultYearStart = throwbackRules(scope).defaults[team.franchiseId];
  if (defaultYearStart !== undefined) {
    const chosen = eligible.find((e) => e.yearStart === defaultYearStart);
    if (chosen) return toIdentity(chosen);
  }

  if (eligible.length > 0) {
    const earliest = [...eligible].sort((a, b) => a.yearStart - b.yearStart)[0];
    return toIdentity(earliest);
  }

  return {
    name: team.name,
    nameMedium: team.nameMedium,
    nameShort: team.nameShort,
    abbrev: team.abbrev,
    aliases: team.aliases,
    icon: team.icon,
    banner: team.banner,
    groupMe: team.groupMe,
    conference: team.conference,
    isHistorical: false,
    rebrand: team.currentRebrand,
  };
}
