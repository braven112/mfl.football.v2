/**
 * League themes for the MFL Football app — the wire contract for
 * `GET /api/mfl-live/league-themes` (store-app plan decision 22).
 *
 * An owner in one of the leagues this site runs can wear that league's look
 * in the app: its colors and its logo at the top. This lists those leagues
 * for the signed-in account. Any other MFL league has no theme and the app
 * keeps its own black and red.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-themes-contract.ts` asserts the server's view stays
 * assignable to it.
 */

/**
 * The app's color roles, each a 6-digit hex. Every role is optional: one the
 * league's website theme cannot supply readably is left out, and the app
 * paints that role in its own black and red.
 */
export interface MflLiveAppThemeColors {
  ground?: string;
  card?: string;
  border?: string;
  field?: string;
  text?: string;
  muted?: string;
  /** A fill (buttons, the selected tab), with `onAccent` text on top. */
  accent?: string;
  onAccent?: string;
  /** The league's color as text on `ground` and `card`. */
  accentText?: string;
}

/** One league on our platform that the account has a team in. */
export interface MflLiveAppLeagueTheme {
  /** MFL league id, the same one `/api/mfl-live/my-teams` lists. */
  leagueId: string;
  /** Registry slug, stable across seasons; the app stores the pick by this. */
  slug: string;
  name: string;
  /** Site-relative PNG, or '' when the league has no logo. */
  logo: string;
  colors: MflLiveAppThemeColors;
}

export type MflLiveAppLeagueThemesResponse =
  /** `themes` is [] for an account with no league on our platform. */
  | { ok: true; themes: MflLiveAppLeagueTheme[] }
  /** `themes-unavailable`: MFL did not answer; the app keeps what it had. */
  | { ok: false; error: 'themes-unavailable' };
