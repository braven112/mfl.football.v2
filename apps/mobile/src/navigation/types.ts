/**
 * Every route in the app, in one place, so a feature adds its SCREEN file and
 * never edits the navigator (docs/plans/mfl-live-store-app.md, Phone app
 * feature plan). Routes for features still being built point at placeholders.
 */

export type TabParamList = {
  Matchups: undefined;
  Standings: undefined;
  Leagues: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  /** One league's full board: every matchup plus the week's top scorers. */
  LeagueBoard: { leagueId: string; leagueName?: string };
  /** Approve a TV's sign-in by scanning its QR code (`code` when opened from a link). */
  PairTv: { code?: string } | undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
