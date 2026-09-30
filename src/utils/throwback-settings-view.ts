/**
 * Throwback Week settings — the shared decision behind both leagues' routes.
 *
 * Holds everything the page needs that is not markup: who may see it, which
 * eras this franchise may pick, what it wears today, and (for a commissioner)
 * every franchise's adoption state. The route wrappers own the redirect and
 * the config import; the shared component owns the markup. Same split as
 * `resolveCustomRankingsAccess` / `resolveDivisionStrengthView`.
 *
 * Why the redirect is only DESCRIBED here and returned by the route:
 * `Astro.redirect()` redirects from a PAGE. Returned from a component's
 * frontmatter it just stops rendering that component and the response is still
 * a 200 with a blank body — the bug that shipped when TheLeague's `/cr` gate
 * moved into a shared component.
 */

import type { AuthUser } from './auth';
import { isCommissionerOrAdmin } from './auth';
import {
  eraClaimId,
  eraPickKey,
  getEligibleThrowbackEras,
  getImposedThrowbackEra,
  getPickableThrowbackEras,
  resolveThrowbackAssignments,
  throwbackPickKey,
} from './throwback-identity';
import { getAllThrowbackPreferences, getRedis } from './throwback-store';
import { throwbackEraOwner } from './throwback-era-owner';
import { isThrowbackPickLocked, throwbackRules, type ThrowbackScope } from './throwback-scope';
import type { FranchiseHistoryEntry, TeamConfig } from './team-names';

export interface ThrowbackEraView {
  yearStart: number;
  yearEnd: number | undefined;
  name: string;
  eraLabel: string | undefined;
  icon: string | undefined;
  banner: string | undefined;
  /**
   * The era's palette, carried through so the settings page can back a
   * letterboxed banner with the era's own colors instead of a flat grey.
   * Twenty-one legacy "banners" are the 2003/04 MFL franchise logo — square
   * or portrait, a few dozen pixels wide — and `object-fit: contain` renders
   * those as a stamp on a grey field. The gradient is what makes that read as
   * a designed lockup rather than a broken image.
   */
  colorPrimary: string | undefined;
  colorSecondary: string | undefined;
  /**
   * The era's stable id within this franchise's picker — a bare year for its
   * own era, `{slot}:{year}` for one inherited from a slot it used to occupy.
   * This, not `yearStart`, is the radio value and what gets stored: Da
   * Dangsters have an era of their own starting in 2003 AND inherit one that
   * also starts in 2003.
   */
  key: string;
  /** Set when the era was worn under a different franchise slot. */
  sourceFranchiseId: string | undefined;
}

export interface ThrowbackCommishEra extends ThrowbackEraView {
  isDefault: boolean;
  isPicked: boolean;
}

export interface ThrowbackCommishRow {
  franchiseId: string;
  teamName: string;
  icon: string | undefined;
  hasPick: boolean;
  /** What this team wears on Throwback Week right now (pick, else default chain). */
  wearsName: string | null;
  wearsYear: number | null;
  eras: ThrowbackCommishEra[];
}

/**
 * The OWNER-facing half: everything the era picker renders. It reads every
 * franchise's stored pick (one MGET) because eras are claimed league-wide —
 * the picker has to say which eras another team already holds, and whether
 * this owner's own default was taken. The commissioner panel's rows remain a
 * separate build on top of this one.
 */
export interface ThrowbackPickerView {
  /** The signed-in owner's own team. */
  team: TeamConfig;
  /**
   * Set when this franchise is serving the Throwback Rebrand: the shame
   * identity imposed on it, which no pick can override. The page shows this
   * INSTEAD of the picker — offering a choice that the scoreboard ignores is
   * the silent failure this field exists to prevent.
   */
  imposedEra: ThrowbackEraView | null;
  /**
   * This franchise's own eras: its slot's history, inherited and granted eras
   * (what its default is chosen from), plus any era its owner wore under
   * another slot.
   */
  eligibleEras: FranchiseHistoryEntry[];
  /**
   * Eras from OTHER franchises this one may claim: the open pool (owners who
   * have left the league) plus any era the registry says this owner wore
   * under another slot.
   */
  poolEras: FranchiseHistoryEntry[];
  /** era pick key -> name of the franchise that already claimed it. */
  claimedBy: Record<string, string>;
  /** True when the saved pick lost its era to an earlier claim. */
  outbid: boolean;
  /** Picks are frozen while the throwback week is being played. */
  locked: boolean;
  /** franchiseId -> its current name, to label where a pool era came from. */
  slotNames: Record<string, string>;
  /** The owner's saved pick as an era KEY, or null when riding the default. */
  selectedKey: string | null;
  /** The era they wear with no pick saved — mirrors resolveThrowbackIdentity. */
  ownDefaultKey: string | null;
  /** The league's throwback week, for preview links. Never a baked-in 4. */
  previewWeek: number;
}

export interface ThrowbackSettingsView extends ThrowbackPickerView {
  isAdmin: boolean;
  storageAvailable: boolean;
  commishRows: ThrowbackCommishRow[];
}

function toEraView(era: FranchiseHistoryEntry): ThrowbackEraView {
  return {
    yearStart: era.yearStart,
    yearEnd: era.yearEnd,
    name: era.name,
    eraLabel: era.eraLabel,
    icon: era.icon,
    banner: era.banner,
    colorPrimary: era.colorPrimary,
    colorSecondary: era.colorSecondary,
    key: eraPickKey(era),
    sourceFranchiseId: era.sourceFranchiseId,
  };
}

/**
 * Defaults and claims come from `resolveThrowbackAssignments` rather than
 * being reimplemented here: this page and the scoreboard must never disagree
 * about what a team wears — the picker's "your default" chip is a promise
 * about what the throwback week will actually render, and with eras claimed
 * league-wide that answer depends on every other franchise's pick.
 */

/**
 * The picker alone — what an owner may wear and what they wear today.
 *
 * Callers must have already established that `user` belongs to this scope's
 * league. On `/throwback-settings` the route wrapper redirects when they do
 * not (only a page can redirect); on `/preferences`, which has no auth gate at
 * all, the route simply passes no picker.
 */
export async function buildThrowbackPickerView(
  user: AuthUser & { franchiseId: string },
  teams: TeamConfig[],
  scope: ThrowbackScope
): Promise<ThrowbackPickerView | null> {
  const team = teams.find((t) => t.franchiseId === user.franchiseId);
  if (!team) return null;

  const imposed = getImposedThrowbackEra(user.franchiseId, scope);
  const pickable = imposed ? [] : getPickableThrowbackEras(team, scope, teams);
  const ownKeys = new Set(
    (imposed ? [] : getEligibleThrowbackEras(team, scope, teams)).map(eraPickKey),
  );
  // An era this owner wore under ANOTHER slot is still theirs — reserved, not
  // up for grabs — so it lists with their own eras rather than under the
  // "first come, first served" pool heading.
  const isOwn = (e: FranchiseHistoryEntry) =>
    ownKeys.has(eraPickKey(e)) ||
    (!!e.sourceFranchiseId &&
      throwbackEraOwner(e.sourceFranchiseId, e.yearStart, scope, teams) === team.franchiseId);
  const eligibleEras = pickable.filter(isOwn);
  const poolEras = pickable.filter((e) => !isOwn(e));

  const picks = await getAllThrowbackPreferences(teams.map((t) => t.franchiseId), scope);
  const preference = picks[user.franchiseId] ?? null;
  const selectedKey = preference ? throwbackPickKey(preference) : null;

  const { eras, claims, outbid } = resolveThrowbackAssignments(teams, picks, scope);
  const nameOf = (id: string) => teams.find((t) => t.franchiseId === id)?.name ?? `franchise ${id}`;
  const claimedBy: Record<string, string> = {};
  for (const era of pickable) {
    const holder = claims.get(eraClaimId(team, era));
    if (holder && holder !== user.franchiseId) claimedBy[eraPickKey(era)] = nameOf(holder);
  }
  const worn = eras.get(user.franchiseId);
  const isOutbid = outbid.has(user.franchiseId);
  // What they wear with no pick in force — which is also what an outbid
  // owner is wearing right now.
  const ownDefaultKey = (selectedKey === null || isOutbid) && worn ? eraPickKey(worn) : null;

  return {
    team,
    imposedEra: imposed ? toEraView(imposed) : null,
    eligibleEras,
    poolEras,
    claimedBy,
    outbid: isOutbid,
    locked: isThrowbackPickLocked(scope),
    slotNames: Object.fromEntries(teams.map((t) => [t.franchiseId, t.name])),
    selectedKey,
    ownDefaultKey,
    previewWeek: throwbackRules(scope).weeks[0] ?? 4,
  };
}

/**
 * Assemble the settings page: the picker above, plus the commissioner panel.
 * Callers must have already established that `user` belongs to this scope's
 * league — the route wrapper does that, because only a page can redirect.
 */
export async function buildThrowbackSettingsView(
  user: AuthUser & { franchiseId: string },
  teams: TeamConfig[],
  scope: ThrowbackScope
): Promise<ThrowbackSettingsView | null> {
  const picker = await buildThrowbackPickerView(user, teams, scope);
  if (!picker) return null;

  const isAdmin = isCommissionerOrAdmin(user);
  let storageAvailable = true;
  let commishRows: ThrowbackCommishRow[] = [];

  if (isAdmin) {
    // getAllThrowbackPreferences already degrades to {} without KV, but we
    // check availability explicitly so the panel can say so instead of
    // silently reporting "everyone is on the default".
    storageAvailable = (await getRedis()) !== null;
    const picks = storageAvailable
      ? await getAllThrowbackPreferences(teams.map((t) => t.franchiseId), scope)
      : {};
    const assignments = resolveThrowbackAssignments(teams, picks, scope);

    commishRows = teams.map((t) => {
      const rowImposed = getImposedThrowbackEra(t.franchiseId, scope);
      if (rowImposed) {
        // Imposed: no eras to list, and no pick can change it.
        return {
          franchiseId: t.franchiseId,
          teamName: t.name,
          icon: t.icon,
          hasPick: false,
          wearsName: rowImposed.name,
          wearsYear: rowImposed.yearStart,
          eras: [],
        };
      }
      const eligible = getEligibleThrowbackEras(t, scope, teams);
      const wears = assignments.eras.get(t.franchiseId) ?? null;
      const holdsClaim = !!wears && assignments.claims.get(eraClaimId(t, wears)) === t.franchiseId;
      const pickedEra = holdsClaim ? wears : undefined;
      const defaultEra = holdsClaim ? null : wears;

      return {
        franchiseId: t.franchiseId,
        teamName: t.name,
        icon: t.icon,
        hasPick: Boolean(pickedEra),
        wearsName: wears?.name ?? null,
        wearsYear: wears?.yearStart ?? null,
        eras: eligible.map((e) => ({
          ...toEraView(e),
          isDefault: !!defaultEra && eraPickKey(defaultEra) === eraPickKey(e),
          isPicked: !!pickedEra && eraPickKey(pickedEra) === eraPickKey(e),
        })),
      };
    });
  }

  return {
    ...picker,
    isAdmin,
    storageAvailable,
    commishRows,
  };
}
