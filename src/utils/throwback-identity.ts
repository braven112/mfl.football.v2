/**
 * Resolves which legacy identity (name/icon/banner) a franchise should wear
 * during a Throwback Week, as opposed to `getTeamIdentityForYear` in
 * team-names.ts which resolves identity for a *calendar year* (used by
 * Franchise History / standings). Throwback identity is chosen — by the
 * owner, or a commissioner-picked default — not derived from the date.
 */

import {
  chooseTeamName,
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
import { throwbackEraOwner } from './throwback-era-owner';

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
  /**
   * When the pick was saved (epoch ms). Decides a tie when two franchises hold
   * a pick on the same open era — earliest wins. Absent on every pick saved
   * before eras could be claimed across the league, which reads as 0: those
   * owners picked first.
   */
  claimedAt?: number | null;
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
 * Eras the commissioner LENT this franchise from another franchise's
 * `history[]` (`ThrowbackRules.grants`). Tagged with `sourceFranchiseId` so
 * the pick key names the slot it came from, like an inherited era.
 */
export function getGrantedThrowbackEras(
  team: TeamConfig,
  scope: ThrowbackScope,
  allTeams: TeamConfig[] | undefined
): FranchiseHistoryEntry[] {
  if (!allTeams?.length) return [];
  const out: FranchiseHistoryEntry[] = [];
  for (const g of throwbackRules(scope).grants) {
    if (g.franchiseId !== team.franchiseId) continue;
    const source = allTeams.find((t) => t.franchiseId === g.sourceFranchiseId);
    const era = source?.history?.find((e) => e.yearStart === g.yearStart);
    if (!era) continue;
    const grantedBy = chooseTeamName({
      fullName: source!.name,
      nameMedium: source!.nameMedium,
      nameShort: source!.nameShort,
      abbrev: source!.abbrev,
      aliases: source!.aliases,
    });
    out.push({ ...era, sourceFranchiseId: g.sourceFranchiseId, grantedBy });
  }
  return out;
}

/**
 * The picker's note on where a borrowed era came from, or null for an era of
 * the team's own slot. A granted era and an inherited one share a pick-key
 * shape, but they are different claims: "your team wore this under an earlier
 * slot" is true of an inherited era and false of a lent one.
 */
export function throwbackEraProvenance(
  era: FranchiseHistoryEntry
): { label: string; title: string } | null {
  if (era.grantedBy) {
    return {
      label: `on loan from ${era.grantedBy}`,
      title: `A commissioner exception: ${era.grantedBy} lent your team this era`,
    };
  }
  if (era.sourceFranchiseId) {
    return {
      label: `as franchise ${era.sourceFranchiseId}`,
      title: 'Your team wore this under an earlier franchise slot',
    };
  }
  return null;
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
  const inherited = [
    ...getInheritedThrowbackEras(team, allTeams),
    ...getGrantedThrowbackEras(team, scope, allTeams),
  ];
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
  //
  // An era whose owner now runs a DIFFERENT franchise is reserved to them
  // (`throwbackEraOwner`), so it leaves this slot's list even when no asset
  // conflict was ever written for it. Needs the league's team list to know;
  // without one the slot keeps its whole history, as it always has.
  const reservedElsewhere = (entry: FranchiseHistoryEntry) => {
    if (!allTeams?.length) return false;
    const owner = throwbackEraOwner(team.franchiseId, entry.yearStart, scope, allTeams);
    return owner !== null && owner !== team.franchiseId;
  };
  const own = (team.history ?? []).filter(
    (entry) =>
      !isConflicted(team.franchiseId, entry.yearStart, scope) &&
      !isSameAsCurrent(team, entry) &&
      !onLoan(entry) &&
      !reservedElsewhere(entry)
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

// ───────────────────────────────────────────────────────────────────────────
// The league-wide era pool
// ───────────────────────────────────────────────────────────────────────────
//
// Owner-directed (Sept 2026): an owner may wear ANY era in the league, not
// just their own franchise's — except an era worn by an owner who is still in
// the league, which stays theirs alone (`throwbackEraOwner`). An era from an
// owner who has LEFT is open to everyone, and only one franchise may wear it:
// the first to claim it. An owner with no pick wears their default, which is
// reserved to them until they pick something else — only then is it
// claimable (`resolveThrowbackAssignments` step 2).
// Picks lock at the throwback week's first kickoff (`isThrowbackPickLocked`).

/**
 * The league-wide identity of an era: the slot whose `history[]` holds it,
 * plus its year. A franchise's own era keys by a bare year in its picker and
 * another franchise's by `{slot}:{year}`, so the PICK key cannot be compared
 * across franchises — this can.
 */
export function eraClaimId(team: Pick<TeamConfig, 'franchiseId'>, era: FranchiseHistoryEntry): string {
  return `${era.sourceFranchiseId ?? team.franchiseId}:${era.yearStart}`;
}

/**
 * Eras in OTHER franchises' `history[]` that belong to this team's owner by
 * the registry but are not reached through `ownerHistory` — an owner who ran
 * a different slot for a stretch the config never recorded as a move. They
 * are theirs to pick, never offered to anyone else.
 */
function getRegistryReservedEras(
  team: TeamConfig,
  scope: ThrowbackScope,
  allTeams: TeamConfig[]
): FranchiseHistoryEntry[] {
  const out: FranchiseHistoryEntry[] = [];
  for (const source of allTeams) {
    if (source.franchiseId === team.franchiseId) continue;
    for (const era of source.history ?? []) {
      if (throwbackEraOwner(source.franchiseId, era.yearStart, scope, allTeams) !== team.franchiseId) continue;
      if (isSameAsCurrent(team, era)) continue;
      out.push({ ...era, sourceFranchiseId: source.franchiseId });
    }
  }
  return out;
}

/**
 * Eras in OTHER franchises' `history[]` whose owner has left the league — the
 * open pool this team may claim. Filtered by the same rules the slot's own
 * list uses: an asset conflict excludes an era for everybody, an era that IS
 * its slot's current look is no throwback at all, and the Throwback Rebrand's
 * borrowed era is already being worn.
 */
export function getOpenThrowbackEras(
  team: TeamConfig,
  scope: ThrowbackScope,
  allTeams: TeamConfig[] | undefined
): FranchiseHistoryEntry[] {
  if (!allTeams?.length) return [];
  const { rebrand } = throwbackRules(scope);
  const out: FranchiseHistoryEntry[] = [];
  for (const source of allTeams) {
    if (source.franchiseId === team.franchiseId) continue;
    for (const era of source.history ?? []) {
      if (throwbackEraOwner(source.franchiseId, era.yearStart, scope, allTeams) !== null) continue;
      if (isConflicted(source.franchiseId, era.yearStart, scope)) continue;
      if (isSameAsCurrent(source, era)) continue;
      if (
        rebrand &&
        rebrand.sourceFranchiseId === source.franchiseId &&
        rebrand.era.yearStart === era.yearStart
      ) continue;
      out.push({ ...era, sourceFranchiseId: source.franchiseId });
    }
  }
  return out.sort((a, b) => a.yearStart - b.yearStart);
}

/**
 * Every era this team may PICK: its own eligible eras (what its default is
 * chosen from), the eras its owner wore under another slot, and the open pool.
 * `getEligibleThrowbackEras` stays the narrower list on purpose — a franchise
 * is never DEFAULTED into another club's past.
 */
export function getPickableThrowbackEras(
  team: TeamConfig,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE,
  allTeams?: TeamConfig[]
): FranchiseHistoryEntry[] {
  const eligible = getEligibleThrowbackEras(team, scope, allTeams);
  if (!allTeams?.length) return eligible;
  const seen = new Set(eligible.map((e) => eraClaimId(team, e)));
  const extra: FranchiseHistoryEntry[] = [];
  for (const era of [
    ...getRegistryReservedEras(team, scope, allTeams),
    ...getOpenThrowbackEras(team, scope, allTeams),
  ]) {
    const id = eraClaimId(team, era);
    if (seen.has(id)) continue;
    seen.add(id);
    extra.push(era);
  }
  return [...eligible, ...extra];
}

export interface ThrowbackAssignments {
  /** franchiseId -> the era it wears, or null for its current identity. */
  eras: Map<string, FranchiseHistoryEntry | null>;
  /** eraClaimId -> the franchise whose saved pick holds it. */
  claims: Map<string, string>;
  /** Franchises whose saved pick lost the era to an earlier claim. */
  outbid: Set<string>;
  /**
   * The subset of `claims` held as a franchise's reserved DEFAULT rather than
   * by a saved pick — the picker words those "X's default", not "claimed".
   */
  reservedDefaults: Set<string>;
}

const defaultEraCache = new WeakMap<object, Map<ThrowbackScope, Map<string, FranchiseHistoryEntry>>>();

/**
 * franchiseId -> the era it wears when its owner has picked nothing: its
 * seeded default, chosen from its OWN eligible list with no claims applied.
 * Memoized per team list; it depends on nothing a request can change.
 */
function defaultErasByFranchise(
  allTeams: TeamConfig[],
  scope: ThrowbackScope,
): Map<string, FranchiseHistoryEntry> {
  const cached = defaultEraCache.get(allTeams)?.get(scope);
  if (cached) return cached;
  const out = new Map<string, FranchiseHistoryEntry>();
  const seeds = throwbackRules(scope).defaults;
  for (const team of allTeams) {
    const era = pickDefaultThrowbackEra(getEligibleThrowbackEras(team, scope, allTeams), seeds[team.franchiseId]);
    if (era) out.set(team.franchiseId, era);
  }
  let byScope = defaultEraCache.get(allTeams);
  if (!byScope) {
    byScope = new Map();
    defaultEraCache.set(allTeams, byScope);
  }
  byScope.set(scope, out);
  return out;
}

const assignmentCache = new WeakMap<object, WeakMap<object, Map<ThrowbackScope, ThrowbackAssignments>>>();

/**
 * What every franchise in the league wears, resolved TOGETHER — the only way
 * to honor "one era, one franchise". Order:
 *
 * 1. The imposed Throwback Rebrand.
 * 2. Reserved defaults (owner-directed, Sept 2026). A franchise's seeded
 *    default is ITS until its owner saves a pick for a different era — only
 *    then does it join the open pool. A team that has picked nothing is never
 *    bumped off its own look by somebody else's click. Once released it stays
 *    released: the API refuses the switch back if another team has claimed
 *    it meanwhile, because the owner's current pick is what released it.
 * 3. Saved picks, validated against each team's pickable list. A pick on
 *    another franchise's reserved default loses outright. Two picks on one
 *    era: the earlier `claimedAt` wins (a pick older than claiming reads as
 *    0), ties to the lower franchise id. The loser falls to step 4.
 * 4. Defaults, from each team's own eligible eras minus anything already
 *    worn, so a default never doubles up on a claimed era.
 *
 * Memoized on the picks object: every surface resolves each franchise through
 * this, and a scoreboard asks once per team.
 */
export function resolveThrowbackAssignments(
  allTeams: TeamConfig[],
  picks: Record<string, ThrowbackPick | number | undefined>,
  scope: ThrowbackScope = DEFAULT_THROWBACK_SCOPE
): ThrowbackAssignments {
  const cached = assignmentCache.get(picks)?.get(allTeams)?.get(scope);
  if (cached) return cached;

  const eras = new Map<string, FranchiseHistoryEntry | null>();
  const claims = new Map<string, string>();
  const outbid = new Set<string>();
  const taken = new Set<string>();
  const reservedDefaults = new Set<string>();

  // Each non-imposed team's saved pick, validated against what it may pick.
  const validPicks = new Map<string, FranchiseHistoryEntry>();
  for (const team of allTeams) {
    if (getImposedThrowbackEra(team.franchiseId, scope)) continue;
    const raw = picks[team.franchiseId];
    if (raw === undefined || raw === null) continue;
    const pick: ThrowbackPick = typeof raw === 'number' ? { yearStart: raw } : raw;
    const era = getPickableThrowbackEras(team, scope, allTeams).find((e) =>
      samePick({ yearStart: e.yearStart, sourceFranchiseId: e.sourceFranchiseId }, pick),
    );
    if (era) validPicks.set(team.franchiseId, era);
  }

  // 2. Reserved defaults: held until the owner picks something else.
  const reservedBy = new Map<string, string>();
  for (const [franchiseId, era] of defaultErasByFranchise(allTeams, scope)) {
    if (getImposedThrowbackEra(franchiseId, scope)) continue;
    const id = eraClaimId({ franchiseId }, era);
    const own = validPicks.get(franchiseId);
    if (own && eraClaimId({ franchiseId }, own) !== id) continue;
    reservedBy.set(id, franchiseId);
  }

  // 3. Candidate picks, grouped by the era they claim.
  const contenders = new Map<string, { franchiseId: string; era: FranchiseHistoryEntry; at: number }[]>();
  for (const team of allTeams) {
    const era = validPicks.get(team.franchiseId);
    if (!era) continue;
    const pick = picks[team.franchiseId] as ThrowbackPick | number;
    const id = eraClaimId(team, era);
    const reserver = reservedBy.get(id);
    if (reserver && reserver !== team.franchiseId) {
      outbid.add(team.franchiseId);
      continue;
    }
    if (!contenders.has(id)) contenders.set(id, []);
    const at = typeof pick === 'number' ? 0 : (pick.claimedAt ?? 0);
    contenders.get(id)!.push({ franchiseId: team.franchiseId, era, at });
  }
  for (const [id, list] of contenders) {
    list.sort((a, b) => a.at - b.at || a.franchiseId.localeCompare(b.franchiseId));
    const [winner, ...losers] = list;
    eras.set(winner.franchiseId, winner.era);
    claims.set(id, winner.franchiseId);
    taken.add(id);
    for (const l of losers) outbid.add(l.franchiseId);
  }
  for (const [id, franchiseId] of reservedBy) {
    if (claims.has(id)) continue; // its owner picked it outright
    claims.set(id, franchiseId);
    taken.add(id);
    reservedDefaults.add(id);
  }

  for (const team of allTeams) {
    // 1. Imposed.
    const imposed = getImposedThrowbackEra(team.franchiseId, scope);
    if (imposed) {
      eras.set(team.franchiseId, imposed);
      continue;
    }
    if (eras.has(team.franchiseId)) continue;
    // 4. Default, stepping around every era already worn. A team with no
    //    pick finds its own default reserved to it, so this only steps when
    //    its owner released the default by picking — and then lost that pick.
    const eligible = getEligibleThrowbackEras(team, scope, allTeams).filter((e) => {
      const id = eraClaimId(team, e);
      return !taken.has(id) || claims.get(id) === team.franchiseId;
    });
    const chosen = pickDefaultThrowbackEra(eligible, throwbackRules(scope).defaults[team.franchiseId]);
    if (chosen) taken.add(eraClaimId(team, chosen));
    eras.set(team.franchiseId, chosen);
  }

  const result: ThrowbackAssignments = { eras, claims, outbid, reservedDefaults };
  let byTeams = assignmentCache.get(picks);
  if (!byTeams) {
    byTeams = new WeakMap();
    assignmentCache.set(picks, byTeams);
  }
  let byScope = byTeams.get(allTeams);
  if (!byScope) {
    byScope = new Map();
    byTeams.set(allTeams, byScope);
  }
  byScope.set(scope, result);
  return result;
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
  allTeams?: TeamConfig[],
  leaguePicks?: Record<string, ThrowbackPick | number | undefined>
): TeamIdentity {
  // With every franchise's pick in hand, resolve the league together — the
  // only way a claimed era can stay with one franchise and a default can step
  // around it. `ownerOverride` is ignored on this path; the team's own entry
  // in `leaguePicks` is its pick.
  if (leaguePicks && allTeams?.length) {
    const era = resolveThrowbackAssignments(allTeams, leaguePicks, scope).eras.get(team.franchiseId);
    if (era) return toIdentity(era);
    if (era === null) return currentIdentity(team);
  }

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
    // Any era the picker offers, the open pool included. Without the whole
    // league's picks this path cannot tell whether someone else claimed it
    // first — callers that render more than one team pass `leaguePicks`.
    const chosen = getPickableThrowbackEras(team, scope, allTeams).find((e) =>
      samePick({ yearStart: e.yearStart, sourceFranchiseId: e.sourceFranchiseId }, pick),
    );
    if (chosen) return toIdentity(chosen);
  }

  const chosen = pickDefaultThrowbackEra(
    eligible,
    throwbackRules(scope).defaults[team.franchiseId]
  );
  if (chosen) return toIdentity(chosen);

  return currentIdentity(team);
}

function currentIdentity(team: TeamConfig): TeamIdentity {
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
