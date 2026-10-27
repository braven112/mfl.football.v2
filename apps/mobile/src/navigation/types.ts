/**
 * Every route in the app, in one place, so a feature adds its SCREEN file and
 * never edits the navigator (docs/plans/mfl-live-store-app.md, Phone app
 * feature plan). Routes for features still being built point at placeholders.
 *
 * Screens that act in one league take its MFL id as `leagueId`; the tab
 * screens take none and read the league from `useActiveTeam()`.
 */

export type TabParamList = {
  Matchups: undefined;
  MyTeam: undefined;
  Players: undefined;
  Chat: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  /** Every watched league's table (package C). */
  Standings: undefined;
  /** Which leagues to watch (package D). */
  Leagues: undefined;
  /** One league's full board: every matchup plus the week's top scorers. */
  LeagueBoard: { leagueId: string; leagueName?: string };
  /** Approve a TV's sign-in by scanning its QR code (`code` when opened from a link). */
  PairTv: { code?: string } | undefined;
  /** Set this week's lineup (package J). */
  SetLineup: { leagueId: string };
  /** Add/drop, waiver claims and FAAB bids (package L). */
  Waivers: {
    leagueId: string;
    /** Opens the add/drop sheet for this free agent (Add on the Players tab or a player card). */
    add?: { id: string; name: string; position?: string; team?: string };
  };
  /** One player's card (package K). */
  PlayerCard: { leagueId: string; playerId: string };
  /** The league's adds, drops, trades and waivers (package O). */
  Transactions: { leagueId: string };
  /** Pending trade offers (package M). */
  Trades: { leagueId: string };
  /** Build or counter a trade (package M). */
  TradeBuilder: { leagueId: string; withFranchiseId?: string; counterOfTradeId?: string };
  /** Commissioner actions, for the league's commissioner (package Q). */
  Commissioner: { leagueId: string };
  /** The draft room (package R). */
  Draft: { leagueId: string };
  /** Write a prompt for a team logo, to paste into ChatGPT, Gemini or Claude. */
  TeamLogo: { leagueId: string };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
