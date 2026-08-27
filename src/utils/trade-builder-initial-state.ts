/**
 * The Trade Builder's opening two teams, derived from the query string.
 *
 * Lives here, outside the React island, for one reason: this runs during
 * RENDER — on the server and again on the client — and both passes must
 * produce byte-identical output. Reading `window.location.search` inside the
 * component made the server pick one pair of teams and the client another,
 * which React 19 reports as recoverable hydration error #418 and `reportError`
 * escalates into an uncaught window error. The roster page's 🏷️ trade-block
 * link (`/trade-builder?b=<franchiseId>`) hit that on every click.
 *
 * Keeping it a pure `(search, defaults) -> TradeState` function is what lets
 * `tests/trade-builder-initial-state.test.ts` assert the server and browser
 * answers agree, instead of grepping for the mistake after the fact.
 */
import type { TradeSide, TradeState } from '../types/trade-builder';
import { deserializeTradeFromParams } from './trade-calculations';

const EMPTY_SIDE: TradeSide = {
  franchiseId: null,
  playerIds: [],
  draftPicks: [],
  rookieExtensions: {},
};

/** Only the fields the opening-state choice actually depends on. */
export interface InitialStateTeam {
  franchiseId: string;
  currentCapSpace: number;
}

export interface InitialTradeStateInput {
  /** `Astro.url.search` / `location.search` — leading `?` optional. */
  search: string;
  /** Owner's team from cookie/`?myteam`, or '' when they have no preference. */
  defaultTeamId: string;
  /**
   * The signed-in owner's own franchise, from the SERVER-rendered auth prop.
   *
   * Distinct from `defaultTeamId`, which comes from an optional "my team"
   * preference cookie an owner may never have set. Used only to seat the
   * viewer on the empty side of a one-sided link — never to change which teams
   * a visitor with no URL params opens on.
   */
  viewerFranchiseId?: string | null;
  teams: InitialStateTeam[];
}

export function resolveInitialTradeState({
  search,
  defaultTeamId,
  viewerFranchiseId,
  teams,
}: InitialTradeStateInput): TradeState {
  // A shared trade link wins over every default — it is the whole point of
  // the link. `URLSearchParams` accepts the string with or without its '?'.
  const restored = deserializeTradeFromParams(new URLSearchParams(search || ''));
  if (restored.teamAId || restored.teamBId) {
    // The roster page's 🏷️ trade-block badge links with only `?b=`, which used
    // to land the owner on a half-empty form: the player they clicked on one
    // side, "Select a team…" on the other. Seat them on the empty side. Guarded
    // on the two ids differing, because the badge is on every team's roster
    // including the owner's own — `?b=0001` for franchise 0001 must not put the
    // same club on both sides of the trade.
    const viewerTeam = defaultTeamId || viewerFranchiseId || '';
    const teamAFallback =
      !restored.teamAId && viewerTeam && viewerTeam !== restored.teamBId
        ? viewerTeam
        : restored.teamAId;

    return {
      teamA: {
        franchiseId: teamAFallback,
        playerIds: restored.teamAPlayerIds,
        draftPicks: restored.teamADraftPicks,
        rookieExtensions: {},
      },
      teamB: {
        franchiseId: restored.teamBId,
        playerIds: restored.teamBPlayerIds,
        draftPicks: restored.teamBDraftPicks,
        rookieExtensions: {},
      },
      rookieModalTarget: null,
    };
  }

  // No user preference — pick the 2 teams with the most cap room.
  if (!defaultTeamId && teams.length >= 2) {
    const byCapSpace = [...teams].sort(
      (a, b) => b.currentCapSpace - a.currentCapSpace
    );
    return {
      teamA: { ...EMPTY_SIDE, franchiseId: byCapSpace[0].franchiseId },
      teamB: { ...EMPTY_SIDE, franchiseId: byCapSpace[1].franchiseId },
      rookieModalTarget: null,
    };
  }

  return {
    teamA: { ...EMPTY_SIDE, franchiseId: defaultTeamId || null },
    teamB: { ...EMPTY_SIDE },
    rookieModalTarget: null,
  };
}
