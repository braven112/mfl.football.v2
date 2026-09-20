/**
 * Shared team/source tables for the NFL logo scripts.
 *
 * Imported by scripts/download-nfl-logos.mjs (which commits the primary SVGs)
 * and scripts/fetch-nfl-brand-kit.mjs (which catalogs every reachable mark).
 * They previously carried their own copies of these lists; KEEP_COMMITTED in
 * particular is a rule, and a rule with two copies is a rule that drifts.
 */

/**
 * Canonical ESPN codes — mirrors getAllNFLTeamCodes() in src/utils/nfl-logo.ts
 * (TS, not importable from a node script). tests/nfl-logo-assets.test.ts is
 * what fails if the two ever diverge.
 */
export const CANONICAL_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
];

/**
 * Canonical code → the code NFL.com's club endpoint uses. Washington is the
 * only disagreement: we canonicalize on ESPN's WSH, NFL.com serves WAS
 * (WSH 404s there).
 */
export const NFL_DOT_COM_CODE = { WSH: 'WAS' };

/** Canonical code → the code nflverse's CSV uses. */
export const NFLVERSE_CODE = { WSH: 'WAS' };

/**
 * Alias filename → canonical code it renders as. Mirrors TEAM_CODE_MAP in
 * src/utils/nfl-logo.ts, minus the FA/UFA/FA* shield entries the logo script
 * does not own.
 *
 * Relocated-team codes are aliases of the CURRENT club, not historical marks:
 * STL.svg is today's Rams logo, which is the long-standing behavior here.
 */
export const ALIASES = {
  WAS: 'WSH', JAC: 'JAX', GBP: 'GB', KCC: 'KC', NEP: 'NE',
  NOS: 'NO', SFO: 'SF', TBB: 'TB', LVR: 'LV', HST: 'HOU',
  BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI', OAK: 'LV', SDC: 'LAC',
  SD: 'LAC', RAM: 'LAR', STL: 'LAR',
};

/**
 * Clubs whose ONLY NFL.com mark is the DARK-background variant, so
 * download-nfl-logos.mjs leaves their committed (light) art alone.
 *
 * NFL.com publishes exactly one cut per club — every `-light`/`-primary`/
 * `-alt` suffix 404s, and the Cloudinary-transformed URLs its own site uses
 * return the identical SVG. For these three that one cut is the reversed,
 * for-dark mark: NYG's `ny` is white-bodied with a red keyline, NYJ's oval is
 * white-filled, and CHI's is the bear head because the orange C dies on a
 * dark card. ESPN agrees independently — its `500-dark` cut for all three is
 * the same artwork — which is the confirmation that these are dark variants
 * rather than the clubs' primaries.
 *
 * On a white player cell they read as hollow outlines or vanish outright, so
 * the committed light art stays. Their dark cuts are NOT wasted: the dark
 * pipeline already mirrors ESPN's raster equivalents, and the brand kit
 * records `nflDotComVariant: "dark"` here so a dark surface that wants a
 * VECTOR cut knows one exists.
 *
 * Revisit a code here only against a rendered before/after on BOTH
 * backgrounds, never on the strength of the upstream having changed.
 */
export const KEEP_COMMITTED = {
  CHI: 'NFL.com serves the bear head — the for-dark mark (the orange C dies on a dark card)',
  NYG: "NFL.com serves the white-bodied 'ny' with a red keyline — the for-dark mark",
  NYJ: 'NFL.com serves the white-filled oval — the for-dark mark, edgeless on a white cell',
};

/** The club logo endpoint, for a canonical code. */
export const nflDotComLogoUrl = (code) =>
  `https://static.www.nfl.com/league/api/clubs/logos/${NFL_DOT_COM_CODE[code] ?? code}.svg`;
