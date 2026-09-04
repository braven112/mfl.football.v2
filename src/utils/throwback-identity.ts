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
 * An owner's chosen era. `yearStart` identifies it within a franchise's own
 * `history[]`; `sourceFranchiseId` is set only for an era INHERITED from a
 * slot the franchise used to occupy, where `yearStart` alone is ambiguous —
 * Da Dangsters have a 2003 era of their own AND inherit one that also starts
 * in 2003 from the slot they left.
 */
export interface ThrowbackPick {
  yearStart: number;
  sourceFranchiseId?: string | null;
}

/**
 * The stable identity of an era within one franchise's picker: the storage
 * value, the radio value and what the API validates against.
 *
 * An own era keeps its bare year, byte-identical to what every stored
 * preference already holds, so no owner loses a pick they already made.
 */
export function throwbackPickKey(pick: ThrowbackPick): string {
  return pick.sourceFranchiseId ? `${pick.sourceFranchiseId}:${pick.yearStart}` : String(pick.yearStart);
}

/**
 * Inverse of `throwbackPickKey`; null for anything that is not a valid key.
 *
 * Both halves are matched as literal digit strings rather than coerced.
 * `Number('')` is 0, so a lenient parse turned an empty `?previewEra=` into
 * the perfectly valid-looking pick `{ yearStart: 0 }`, which then quietly
 * matched nothing and fell through to the default.
 */
const YEAR = /^\d{4}$/;
const SLOT = /^\d{4}$/;
export function parseThrowbackPickKey(raw: string): ThrowbackPick | null {
  const parts = String(raw).split(':');
  if (parts.length === 1) {
    return YEAR.test(parts[0]) ? { yearStart: Number(parts[0]) } : null;
  }
  if (parts.length !== 2) return null;
  const [slot, year] = parts;
  return SLOT.test(slot) && YEAR.test(year)
    ? { yearStart: Number(year), sourceFranchiseId: slot }
    : null;
}

export const eraPickKey = (era: FranchiseHistoryEntry): string =>
  throwbackPickKey({ yearStart: era.yearStart, sourceFranchiseId: era.sourceFranchiseId });

const samePick = (a: ThrowbackPick, b: ThrowbackPick) =>
  a.yearStart === b.yearStart && (a.sourceFranchiseId ?? null) === (b.sourceFranchiseId ?? null);

/**
 * Eras this franchise wore under a DIFFERENT MFL slot.
 *
 * Four AFL franchises changed slots — the owner left and came back, or the
 * commissioner reshuffled — and `ownerHistory` is where the config records
 * which slot they held in which years. Their old-school looks are filed under
 * that slot's `history[]`: the Chatmaster of 2004-2009 lives in franchise
 * 0007, Muck Juggling Micks 2005-2007 in 0004, Dicks out for Harambe
 * 2017-2018 in 0016, Da Dangsters 2003-2008 in 0021.
 *
 * Without this they were unreachable — worse, `AFL_THROWBACK_ASSET_CONFLICTS`
 * excludes each of them from the slot's CURRENT occupant (rightly: two teams
 * cannot wear one identity on one scoreboard), so the era was offered to
 * nobody at all.
 *
 * The era is returned unclipped, carrying its own `yearStart`, so its key
 * still points at the entry it came from. An era straddling the edge of an
 * ownership window would claim seasons this franchise did not own, which is
 * why `tests/afl-throwback-identity.test.ts` pins that none does.
 */
export function getInheritedThrowbackEras(
  team: TeamConfig,
  allTeams: TeamConfig[] | undefined
): FranchiseHistoryEntry[] {
  if (!allTeams?.length || !team.ownerHistory?.length) return [];
  const out: FranchiseHistoryEntry[] = [];
  for (const window of team.ownerHistory) {
    if (!window.franchiseId || window.franchiseId === team.franchiseId) continue;
    const source = allTeams.find((t) => t.franchiseId === window.franchiseId);
    for (const era of source?.history ?? []) {
      const end = era.yearEnd ?? era.yearStart;
      if (era.yearStart > window.yearEnd || end < window.yearStart) continue;
      out.push({ ...era, sourceFranchiseId: source!.franchiseId });
    }
  }
  return out;
}

/**
 * Eras a franchise may throw back to: its own `history[]` IN THIS LEAGUE,
 * minus entries whose art asset is claimed by another franchise (the scope's
 * asset conflicts) and minus entries identical to the team's current identity.
 *
 * A franchise only ever wears its own league's past. Several owners run a
 * franchise in both leagues, and their other league's history is deliberately
 * NOT offered here — see `tests/afl-throwback-identity.test.ts` for the guard
 * that keeps the two archives apart.
 *
 * `scope` selects WHICH league's conflict list applies. It defaults to
 * TheLeague so every pre-existing call site keeps its exact behavior; an AFL
 * caller must pass 'afl' or it gets TheLeague's rules keyed by ids the two
 * leagues share (0001–0016 exist in both).
 */
export function getEligibleThrowbackEras(
  team: TeamConfig,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE,
  allTeams?: TeamConfig[]
): FranchiseHistoryEntry[] {
  const inherited = getInheritedThrowbackEras(team, allTeams);
  if (!team.history?.length && inherited.length === 0) return [];
  const { rebrand } = throwbackRules(scope);
  // An era on loan to the Throwback Rebrand leaves its OWNER's picker while
  // it is being worn elsewhere. Two teams in one identity on a single
  // scoreboard is the same problem the asset conflicts exist to stop; the
  // source franchise keeps every other era it has.
  const onLoan = (entry: FranchiseHistoryEntry) =>
    !!rebrand &&
    rebrand.sourceFranchiseId === team.franchiseId &&
    rebrand.era.yearStart === entry.yearStart;

  // Conflicts are keyed on the OWNING franchise, so an inherited era is not
  // filtered by the conflict that (correctly) keeps the slot's current
  // occupant from wearing it.
  const own = (team.history ?? []).filter(
    (entry) =>
      !isConflicted(team.franchiseId, entry.yearStart, scope) &&
      !isSameAsCurrent(team, entry) &&
      !onLoan(entry)
  );
  const borrowed = inherited.filter((entry) => !isSameAsCurrent(team, entry) && !onLoan(entry));
  return [...own, ...borrowed].sort((a, b) => a.yearStart - b.yearStart);
}

/**
 * The shame identity imposed on a franchise by the Throwback Rebrand, or null
 * when this franchise is not the one serving it.
 *
 * Exported because the settings page has to KNOW, not infer: an owner handed
 * a picker whose result never reaches the scoreboard is the silent-failure
 * shape this codebase keeps re-learning.
 */
export function getImposedThrowbackEra(
  franchiseId: string,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE
): FranchiseHistoryEntry | null {
  const { rebrand } = throwbackRules(scope);
  return rebrand && rebrand.franchiseId === franchiseId ? rebrand.era : null;
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
  seededYearStart?: number | string
): FranchiseHistoryEntry | null {
  if (eligible.length === 0) return null;

  const defaultable = (e: FranchiseHistoryEntry) => !e.rebrand;

  // A bare year is ambiguous once eras can be inherited: franchise 0006 has
  // its OWN 2003 era (Chieftans) AND inherits 0021's 2003 Da Dangsters, and
  // `find` takes whichever the eligible list happens to order first. A seed
  // may therefore also be a pick key ("0021:2003") naming the slot it came
  // from, which is exact.
  const seeded =
    typeof seededYearStart === 'string'
      ? eligible.find((e) => eraPickKey(e) === seededYearStart)
      : eligible.find((e) => e.yearStart === seededYearStart);
  if (seeded && defaultable(seeded)) return seeded;

  const byTenure = (pool: FranchiseHistoryEntry[]) =>
    [...pool].sort((a, b) => eraSpan(b) - eraSpan(a) || a.yearStart - b.yearStart)[0];

  const clean = eligible.filter(defaultable);
  return byTenure(clean.length > 0 ? clean : eligible) ?? null;
}

/**
 * Resolve a franchise's throwback identity: the imposed Throwback Rebrand ->
 * owner override -> the default era (`pickDefaultThrowbackEra`) -> current
 * identity, when there is no eligible era at all.
 *
 * An owner override is honored even when it is a punitive rebrand — the
 * no-shame-name rule governs what we CHOOSE for someone, not what they may
 * choose for themselves.
 *
 * @param ownerOverride - the era the owner picked via the league's
 *   throwback-settings page, if any. A bare number is accepted and means
 *   "my own era starting that year" — that is the shape of every preference
 *   stored before eras could be inherited from a former franchise slot.
 * @param allTeams - the league's full team list, needed only to resolve eras
 *   inherited from a former slot. Omit it and a franchise sees just its own
 *   `history[]`, which is the correct answer for a league where nobody moved.
 * @param scope - which league's era rules apply. Defaults to TheLeague; see
 *   `getEligibleThrowbackEras` for why an AFL caller must pass its own.
 */
export function resolveThrowbackIdentity(
  team: TeamConfig,
  ownerOverride?: ThrowbackPick | number,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE,
  allTeams?: TeamConfig[]
): TeamIdentity {
  // The Throwback Rebrand comes FIRST and ignores the owner override. A
  // last-place rename is imposed, not chosen — this franchise did not pick
  // its current name either.
  const imposed = getImposedThrowbackEra(team.franchiseId, scope);
  if (imposed) return toIdentity(imposed);

  const eligible = getEligibleThrowbackEras(team, scope, allTeams);

  if (ownerOverride !== undefined && ownerOverride !== null) {
    // A bare number stays valid: that is every stored preference written
    // before eras could be inherited, and it means "my own era of that year".
    const pick: ThrowbackPick =
      typeof ownerOverride === 'number' ? { yearStart: ownerOverride } : ownerOverride;
    const chosen = eligible.find((e) =>
      samePick({ yearStart: e.yearStart, sourceFranchiseId: e.sourceFranchiseId }, pick),
    );
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
