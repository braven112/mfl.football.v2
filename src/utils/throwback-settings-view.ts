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
import { getEligibleThrowbackEras, pickDefaultThrowbackEra } from './throwback-identity';
import { getAllThrowbackPreferences, getThrowbackPreference, getRedis } from './throwback-store';
import { throwbackRules, type ThrowbackScope } from './throwback-scope';
import type { FranchiseHistoryEntry, TeamConfig } from './team-names';

export interface ThrowbackEraView {
  yearStart: number;
  yearEnd: number | undefined;
  name: string;
  eraLabel: string | undefined;
  icon: string | undefined;
  banner: string | undefined;
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

export interface ThrowbackSettingsView {
  /** The signed-in owner's own team. */
  team: TeamConfig;
  /** Eras this franchise may pick. */
  eligibleEras: FranchiseHistoryEntry[];
  /** The owner's saved pick, or null when they are riding the default. */
  selectedYearStart: number | null;
  /** The era they wear with no pick saved — mirrors resolveThrowbackIdentity. */
  ownDefaultYearStart: number | null;
  /** The league's throwback week, for preview links. Never a baked-in 4. */
  previewWeek: number;
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
  };
}

/**
 * The default era, delegated to `pickDefaultThrowbackEra` rather than
 * reimplemented.
 *
 * This page and the scoreboard must never disagree about what a team wears
 * with no pick saved — the picker's "your default" chip is a promise about
 * what Week 8 will actually render. A second copy of the rule here is exactly
 * how that promise would quietly stop being true, and the rule now carries
 * policy (no punitive rebrand as a default), not just an ordering.
 */
function defaultEraFor(
  eligible: FranchiseHistoryEntry[],
  franchiseId: string,
  scope: ThrowbackScope
): FranchiseHistoryEntry | null {
  return pickDefaultThrowbackEra(eligible, throwbackRules(scope).defaults[franchiseId]);
}

/**
 * Assemble the page. Callers must have already established that `user` belongs
 * to this scope's league — the route wrapper does that, because only a page
 * can redirect.
 */
export async function buildThrowbackSettingsView(
  user: AuthUser & { franchiseId: string },
  teams: TeamConfig[],
  scope: ThrowbackScope
): Promise<ThrowbackSettingsView | null> {
  const team = teams.find((t) => t.franchiseId === user.franchiseId);
  if (!team) return null;

  const eligibleEras = getEligibleThrowbackEras(team, scope);
  const preference = await getThrowbackPreference(user.franchiseId, scope);
  const selectedYearStart = preference?.yearStart ?? null;
  const ownDefaultYearStart =
    defaultEraFor(eligibleEras, user.franchiseId, scope)?.yearStart ?? null;

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

    commishRows = teams.map((t) => {
      const eligible = getEligibleThrowbackEras(t, scope);
      const storedYear = picks[t.franchiseId];
      const pickedEra =
        storedYear !== undefined ? eligible.find((e) => e.yearStart === storedYear) : undefined;
      const defaultEra = defaultEraFor(eligible, t.franchiseId, scope);
      const wears = pickedEra ?? defaultEra;

      return {
        franchiseId: t.franchiseId,
        teamName: t.name,
        icon: t.icon,
        hasPick: Boolean(pickedEra),
        wearsName: wears?.name ?? null,
        wearsYear: wears?.yearStart ?? null,
        eras: eligible.map((e) => ({
          ...toEraView(e),
          isDefault: defaultEra?.yearStart === e.yearStart,
          isPicked: pickedEra?.yearStart === e.yearStart,
        })),
      };
    });
  }

  return {
    team,
    eligibleEras,
    selectedYearStart,
    ownDefaultYearStart,
    previewWeek: throwbackRules(scope).weeks[0] ?? 4,
    isAdmin,
    storageAvailable,
    commishRows,
  };
}
