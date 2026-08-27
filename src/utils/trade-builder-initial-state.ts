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
  teams: InitialStateTeam[];
}

export function resolveInitialTradeState({
  search,
  defaultTeamId,
  teams,
}: InitialTradeStateInput): TradeState {
  // A shared trade link wins over every default — it is the whole point of
  // the link. `URLSearchParams` accepts the string with or without its '?'.
  const restored = deserializeTradeFromParams(new URLSearchParams(search || ''));
  if (restored.teamAId || restored.teamBId) {
    return {
      teamA: {
        franchiseId: restored.teamAId,
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
