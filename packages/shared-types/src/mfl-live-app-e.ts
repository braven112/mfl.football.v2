/**
 * League and team identity on the MFL Live app's boards, on top of the
 * Matchups contract in `mfl-live-app-a.ts`.
 *
 * Two things the web board already shows and the phone did not:
 *
 *  - Team colours. The server resolves each matchup's pair with
 *    `resolveMatchupColorVars` (src/utils/live/model.ts) against the MFL Live
 *    card, and the web paints its win-probability bar from them. The app reads
 *    the DARK values, which are resolved against the same `#1e2126` card the
 *    app draws on. A league we do not run has no colours, so its pair is two
 *    neutral greys, never an invented hue; and store mode never carries an
 *    NFL club's colours.
 *  - League logos, for the leagues this site runs only (`appLeagueLogo`).
 *
 * Every field is OPTIONAL: the app ships ahead of the server, and a board
 * without them must render exactly as before.
 *
 * Types only — the app imports this with `import type`.
 * `src/types/mfl-live-app-e-contract.ts` asserts the server's view stays
 * assignable to it.
 */

/**
 * One matchup's colours, as the CSS custom properties the web board sets.
 * `t0` is MY side, `t1` the opponent's. The `-ink-` pair is the one to colour
 * TEXT with: it is lifted to readable contrast on the card.
 */
export interface MflLiveAppMatchupColorVars {
  '--t0-dark'?: string;
  '--t1-dark'?: string;
  '--t0-ink-dark'?: string;
  '--t1-ink-dark'?: string;
}

export interface MflLiveAppIdentityMatchup {
  colorVars?: MflLiveAppMatchupColorVars;
}

export interface MflLiveAppIdentityPanel {
  /** A site-relative PNG path; '' when the league has no logo. */
  leagueLogo?: string;
}

export interface MflLiveAppIdentityBoard {
  leagues: Array<MflLiveAppIdentityPanel & { matchups: MflLiveAppIdentityMatchup[] }>;
}
