/**
 * Trades in the MFL Football app (package M): what `/api/mfl-live/trades*`
 * answers and accepts.
 *
 * Every trade is seen from the signed-in owner's side: `youGive` is what
 * their team sends, `youGet` what it receives, whichever team proposed it.
 * The server resolves every asset to a label (player name, pick) so the app
 * never needs the player universe or MFL's asset codes beyond echoing them
 * back in a proposal.
 *
 * Store rules: no headshots, no ESPN ids, no NFL marks. An asset carries
 * MFL's own id and text only.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-trades-contract.ts` asserts the server's views stay
 * assignable to it.
 */

/** One thing that moves in a trade. `id` is MFL's own asset code. */
export interface MflLiveAppTradeAsset {
  kind: 'player' | 'pick' | 'blind-bid';
  /** MFL code: a player id, `FP_<fid>_<year>_<round>`, `DP_<r>_<p>` or `BB_<amount>`. */
  id: string;
  /** "Josh Allen", "2027 Rd 1 (via Team 0004)", "$5K blind bid". */
  label: string;
  /** Player only: "QB". */
  position?: string;
  /** Player only: the NFL team's abbreviation as MFL writes it, as text. */
  nflTeam?: string;
}

export interface MflLiveAppTradeTeam {
  franchiseId: string;
  name: string;
}

export interface MflLiveAppTradeOffer {
  tradeId: string;
  /** Incoming: another team proposed it to you. Outgoing: you proposed it. */
  direction: 'incoming' | 'outgoing';
  /** The other team. */
  partner: MflLiveAppTradeTeam;
  youGive: MflLiveAppTradeAsset[];
  youGet: MflLiveAppTradeAsset[];
  comments: string;
  /** Unix seconds, 0 when MFL gave none. */
  proposedAt: number;
  /** Unix seconds, 0 when the offer never expires. */
  expiresAt: number;
}

/** GET /api/mfl-live/trades?league= */
export interface MflLiveAppTrades {
  leagueId: string;
  franchiseId: string;
  offers: MflLiveAppTradeOffer[];
}

/** One team's tradeable assets, for the trade builder. */
export interface MflLiveAppTradeSide extends MflLiveAppTradeTeam {
  players: MflLiveAppTradeAsset[];
  picks: MflLiveAppTradeAsset[];
}

/** GET /api/mfl-live/trade-builder?league=&with= */
export interface MflLiveAppTradeBuilder {
  leagueId: string;
  /** Every other team in the league, to pick a partner from. */
  teams: MflLiveAppTradeTeam[];
  mine: MflLiveAppTradeSide;
  /** Present when `with=` named a team in the league. */
  theirs?: MflLiveAppTradeSide;
}

/**
 * POST /api/mfl-live/trades?league=
 * `counterOfTradeId` makes it a counter: the new offer is sent first, and only
 * once MFL takes it is the original rejected.
 */
export interface MflLiveAppTradeProposal {
  offeredTo: string;
  /** Asset codes from your side (`MflLiveAppTradeAsset.id`). */
  give: string[];
  /** Asset codes from their side. */
  get: string[];
  comments?: string;
  counterOfTradeId?: string;
}

/** POST /api/mfl-live/trade-respond?league= */
export interface MflLiveAppTradeResponse {
  tradeId: string;
  /** Accept or reject an incoming offer; revoke withdraws your own. */
  response: 'accept' | 'reject' | 'revoke';
  comments?: string;
}

/** What every trade POST answers. */
export interface MflLiveAppTradeResult {
  success: boolean;
  message: string;
  /**
   * A counter whose new offer went through but whose original MFL would not
   * reject: both offers are now open, and the app says so.
   */
  originalStillOpen?: boolean;
}
