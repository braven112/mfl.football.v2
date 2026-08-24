/**
 * Team-identity primitives shared across the .ts/.mjs boundary.
 *
 * `normalizeIdentity` and the historical-asset fallbacks are needed by both
 * TypeScript app code (`franchise-eras.ts`, `team-names.ts`) and plain-node
 * pipeline code (`owner-tenures.mjs`, and the scripts that import it). In this
 * repo `.ts` imports `.mjs` and never the reverse — node cannot load a `.ts`
 * module — so the primitive has to live down here for both sides to share one
 * copy. `franchise-eras.ts` and `team-names.ts` re-export from this file, so
 * every existing import path keeps working.
 *
 * This matters more than it looks: identity normalization decides whether two
 * adjacent history entries are "the same team", which decides where a season's
 * record is displayed. A second, drifting copy of this function is a wrong
 * franchise page.
 */

/** Collapse casing, whitespace, and a leading "The " for identity matching. */
export const normalizeIdentity = (s) =>
  (s || '')
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ');

export const HISTORICAL_TEAM_ICON_FALLBACK =
  '/assets/theleague/history/historical-team-placeholder.svg';
export const HISTORICAL_TEAM_BANNER_FALLBACK =
  '/assets/theleague/history/historical-team-banner-placeholder.svg';
