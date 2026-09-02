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
 * How long a franchise wore an era, in seasons.
 *
 * `yearEnd` is inclusive, so a single-season era spans 1 rather than 0 — the
 * difference between "shortest" and "tied for shortest" when this orders the
 * default pick below.
 */
function eraSpan(entry: FranchiseHistoryEntry): number {
  return (entry.yearEnd ?? entry.yearStart) - entry.yearStart + 1;
}

/**
 * The era a franchise wears when its owner has not picked one.
 *
 * Two rules, and the first one is a league policy rather than a heuristic:
 *
 * 1. **A punitive last-place rebrand is never a DEFAULT.** Wearing the name
 *    the league stuck you with for finishing last is a choice an owner can
 *    make, not one the site makes for them — so `rebrand` eras stay
 *    selectable in the picker and are skipped here. This is not a nicety:
 *    the seeding heuristic that preceded it ("most recent look that differs
 *    from today's") walked straight into four of them, because a shame
 *    rename is by construction recent and visually distinct.
 * 2. **Otherwise the LONGEST-RUNNING era wins**, ties going to the earlier
 *    one. The identity a franchise wore for seventeen seasons is the one the
 *    league actually remembers; the seeded map is the commissioner's chance
 *    to overrule that, not a separate policy.
 *
 * A commissioner default that is itself a rebrand is skipped too, so rule 1
 * cannot be defeated by a stale seed. The all-rebrand case still returns
 * something — a franchise whose every era is a shame name has no better
 * option, and rendering its CURRENT identity would silently drop it out of
 * Throwback Week entirely.
 */
export function pickDefaultThrowbackEra(
  eligible: FranchiseHistoryEntry[],
  seededYearStart?: number
): FranchiseHistoryEntry | null {
  if (eligible.length === 0) return null;

  const seeded = eligible.find((e) => e.yearStart === seededYearStart);
  if (seeded && !seeded.rebrand) return seeded;

  const byTenure = (pool: FranchiseHistoryEntry[]) =>
    [...pool].sort((a, b) => eraSpan(b) - eraSpan(a) || a.yearStart - b.yearStart)[0];

  const clean = eligible.filter((e) => !e.rebrand);
  return byTenure(clean.length > 0 ? clean : eligible) ?? null;
}

/**
 * Resolve a franchise's throwback identity: owner override -> the default era
 * (`pickDefaultThrowbackEra`) -> current identity, when there is no eligible
 * era at all.
 *
 * An owner override is honored even when it is a punitive rebrand — the
 * no-shame-name rule governs what we CHOOSE for someone, not what they may
 * choose for themselves.
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

  const chosen = pickDefaultThrowbackEra(
    eligible,
    throwbackRules(scope).defaults[team.franchiseId]
  );
  if (chosen) return toIdentity(chosen);

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
