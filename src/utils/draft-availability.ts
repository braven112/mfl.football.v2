/**
 * Which players an owner can actually draft — the pool filter for the
 * My Draft List board.
 *
 * Two independent constraints, and both are per-league:
 *
 * 1. **The draft player pool.** `league.draftPlayerPool` in MFL's league
 *    export. TheLeague is `"Rookie"`, so only current-league-year rookies are
 *    draftable; the AFL is `"Both"`, so everyone is. A rookie is a player the
 *    players feed marks `status: "R"` — that flag is present ONLY for the
 *    current league year (verified 2026: 293 of 2609, all `draft_year` 2026),
 *    which is exactly the definition MFL drafts on.
 *
 * 2. **Roster membership, scoped to the OWNER'S conference.** This is where a
 *    naive implementation goes wrong. The AFL is a duplicate-player league
 *    (registry `duplicatePlayers: true`): the same player is held once per
 *    conference, and 60 of its 108 rostered players are currently on two
 *    rosters at once. A player held in the other conference is still fully
 *    available to you.
 *
 *    Note this is a DIFFERENT question than the Free Agents page asks. There,
 *    `rostered` means "held in EVERY conference" — unavailable to anybody. A
 *    draft board is asked from one owner's seat, so the answer is "held in
 *    MY conference". Same shared math (afl-conference-rosters.mjs), different
 *    predicate; don't collapse them.
 *
 * Fails CLOSED. `buildRosteredByConf` returns null for a payload it cannot
 * trust (partial franchise list, unmappable franchise, all-empty rosters),
 * and so do we — a wrong "available" list on a draft board is worse than no
 * filter at all, because it silently hides players the owner can still take.
 */

import {
  buildConferenceStructure,
  buildRosteredByConf,
  confsForPlayer,
} from './afl-conference-rosters.mjs';

/** MFL's `league.draftPlayerPool` values we act on. Anything else = no limit. */
export type DraftPlayerPool = 'Rookie' | 'Veteran' | 'Both' | (string & {});

export interface AvailabilityPlayer {
  id: string;
  /** MFL players-feed `status`; 'R' marks a current-league-year rookie. */
  status?: string | null;
}

export interface AvailabilityResult {
  /** Player ids this franchise can draft. */
  availableIds: string[];
  /** The pool that produced it, for the UI to label the filter honestly. */
  pool: DraftPlayerPool;
  /** True when roster scoping was per-conference (AFL), not a single pool. */
  perConference: boolean;
}

/** Is this player in the league's draft pool, ignoring rosters? */
export function isInDraftPool(pool: DraftPlayerPool, player: AvailabilityPlayer): boolean {
  const isRookie = player.status === 'R';
  if (pool === 'Rookie') return isRookie;
  if (pool === 'Veteran') return !isRookie;
  // 'Both', or a value MFL added that we don't model: don't invent a limit.
  return true;
}

/**
 * Resolve the draftable set for one franchise, or null when the inputs can't
 * be trusted well enough to hide anything.
 *
 * @param franchiseId The VIEWING owner — conference scoping is from their seat.
 */
export function resolveDraftAvailability({
  players,
  leagueJson,
  rostersJson,
  franchiseId,
}: {
  players: AvailabilityPlayer[];
  leagueJson: unknown;
  rostersJson: unknown;
  franchiseId: string;
}): AvailabilityResult | null {
  const pool: DraftPlayerPool =
    ((leagueJson as any)?.league?.draftPlayerPool as string) || 'Both';

  // buildConferenceStructure is typed from JSDoc in a .mjs, so its
  // franchiseConferences widens to `{}` here; name the shape we rely on
  // rather than indexing an untyped object.
  const structure = buildConferenceStructure(leagueJson) as
    | { ids: string[]; franchiseConferences: Record<string, string> }
    | null;
  const rostered = buildRosteredByConf(rostersJson, structure);
  if (!rostered) return null;

  const perConference = rostered.confIds.length > 1;

  // Which conference's rosters block THIS owner. In a single-pool league the
  // pseudo-conference '' is the only one, so the lookup is the same shape.
  const myConference = perConference
    ? structure?.franchiseConferences?.[franchiseId]
    : rostered.confIds[0];

  // An owner we cannot place in a conference is one we cannot answer for.
  if (myConference == null || !rostered.rosteredByConf.has(myConference)) return null;

  const blocked = rostered.rosteredByConf.get(myConference)!;

  const availableIds: string[] = [];
  for (const player of players) {
    if (!isInDraftPool(pool, player)) continue;
    if (blocked.has(String(player.id))) continue;
    availableIds.push(String(player.id));
  }

  return { availableIds, pool, perConference };
}

/** Re-exported so callers needing the raw holders don't reach past this module. */
export { confsForPlayer };

/**
 * What a push actually sends to MFL: the board in its own order, narrowed to
 * `pool` when the availability filter is on, and unchanged when it is off.
 *
 * Lives here, apart from the board's render state, because of what must NOT
 * reach it. The position filter is also a filter over the same list, and
 * applying it here would let an owner looking at quarterbacks replace their
 * entire MFL draft list with quarterbacks. Availability is a fact about the
 * league; position is a way of reading the board. Only the first belongs in a
 * destructive write, and keeping this a pure function of (order, pool) is
 * what makes that impossible to get wrong by accident.
 */
export function selectPushablePlayers(
  rankings: string[],
  pool: ReadonlySet<string> | null,
): string[] {
  if (!pool) return rankings;
  return rankings.filter((id) => pool.has(id));
}
