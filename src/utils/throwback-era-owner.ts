/**
 * Who a Throwback Week era BELONGS to — the reservation half of the
 * league-wide era pool.
 *
 * The rule (owner-directed, Sept 2026): any franchise may wear any era in its
 * league, EXCEPT an era worn by an owner who is still in the league — that one
 * is theirs alone. "Nobody else can take the Pigskins' old looks but me; an
 * owner who has left can have his banner taken."
 *
 * So an era resolves to the CURRENT franchise whose owner wore it, or null for
 * an owner who is gone (the era is then open to anyone, first come first
 * served — see `resolveThrowbackAssignments`).
 *
 * This deliberately adds no ownership logic of its own. The boundary has one
 * implementation, `buildAttributor` in owner-tenures.mjs, and the owners
 * registry overrides it exactly as it does on the owner pages ("claims there
 * always win"). The registry is not decoration here: it is the only source
 * that knows AFL Computer Jocks 2014 was Jomar Marinio's, who runs franchise
 * 0005 today — the attributor alone would have put his era up for grabs.
 * `tests/owner-boundary-parity.test.ts` fails on a local walk-back.
 */

import registry from '../data/owners-registry.json';
import { buildAttributor, indexRegistryClaims, OPEN_ENDED_YEAR } from './owner-tenures.mjs';
import { throwbackRegistryLeagueSlug, type ThrowbackScope } from './throwback-scope';
import type { TeamConfig } from './team-names';

type OwnerLookup = (slot: string, yearStart: number) => string | null;

/** One lookup per (team list, scope). The team list is module-level config. */
const lookups = new WeakMap<object, Map<ThrowbackScope, OwnerLookup>>();

function buildLookup(teams: TeamConfig[], scope: ThrowbackScope): OwnerLookup {
  const liveIds = new Set(teams.map((t) => t.franchiseId));
  const { attributeSeason } = buildAttributor(teams);
  const leagueSlug = throwbackRegistryLeagueSlug(scope);
  const claims: Map<string, { person: any }[]> = leagueSlug
    ? indexRegistryClaims(registry, leagueSlug)
    : new Map();

  // person id -> the franchise they run TODAY in this league (an open-ended
  // claim), or absent for someone who has left.
  const currentSlotOf = new Map<string, string>();
  for (const person of (registry as any).people ?? []) {
    for (const claim of person.claims ?? []) {
      if (claim.league !== leagueSlug || claim.yearEnd < OPEN_ENDED_YEAR) continue;
      if (liveIds.has(claim.franchiseId)) currentSlotOf.set(person.id, claim.franchiseId);
    }
  }

  return (slot, yearStart) => {
    const holders = claims.get(`${slot}|${yearStart}`);
    if (holders?.length) {
      const current = holders
        .map((h) => currentSlotOf.get(h.person.id))
        .filter((id): id is string => !!id);
      // A co-owned season: prefer the holder still in this very slot.
      return current.find((id) => id === slot) ?? current[0] ?? null;
    }
    return attributeSeason(slot, yearStart);
  };
}

/**
 * The current franchise that owns the era starting `yearStart` in `slot`'s
 * `history[]`, or null when its owner has left the league.
 */
export function throwbackEraOwner(
  slot: string,
  yearStart: number,
  scope: ThrowbackScope,
  teams: TeamConfig[]
): string | null {
  let byScope = lookups.get(teams);
  if (!byScope) {
    byScope = new Map();
    lookups.set(teams, byScope);
  }
  let lookup = byScope.get(scope);
  if (!lookup) {
    lookup = buildLookup(teams, scope);
    byScope.set(scope, lookup);
  }
  return lookup(slot, yearStart);
}
