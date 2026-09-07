/**
 * Storybook's own copy of ESPN's dark NFL logo cuts.
 *
 * The shipped site self-hosts these from `public/assets/nfl-logos/dark/`,
 * written by `scripts/fetch-nfl-dark-logos.mjs` during prebuild and gitignored.
 * `storybook build` never runs prebuild, so in CI that directory does not
 * exist and `src/data/nfl-dark-logos-manifest.json` is its committed
 * `{"codes": []}` default — which made `buildNflLogoDarkCss()` emit
 * `content: url("https://a.espncdn.com/...")` for all 32 teams. Chromatic
 * fetched those live at capture time on every DARK snapshot, and a `content:`
 * image has no error fallback, so a CDN hiccup rendered a blank mark and
 * failed the build. That is the Bengals-logo flake in Roster/PlayerCell.
 *
 * So Storybook carries its own mirror, COMMITTED — a visual baseline has to be
 * reproducible from a checkout alone, and re-fetching per CI run would move
 * the same flake earlier rather than remove it. Refresh with
 * `node scripts/mirror-storybook-dark-logos.mjs`;
 * `tests/storybook-dark-logo-mirror.test.ts` fails if the set drifts from the
 * 32 canonical codes.
 *
 * Served at its own `/storybook-nfl-dark` prefix rather than shadowing
 * `/assets/nfl-logos/dark` — the same reasoning as `/storybook-fonts` in
 * `main.ts`: it stays obvious that the file is Storybook's, and it cannot
 * collide with a `public/` mirror a developer's local prebuild left behind.
 */
import manifest from './nfl-dark-manifest.json';

/** Path prefix `main.ts` maps `./static/nfl-dark` to. */
export const STORYBOOK_NFL_DARK_BASE_PATH = '/storybook-nfl-dark';

/** Canonical codes whose dark cut is committed under `./static/nfl-dark`. */
export const STORYBOOK_NFL_DARK_CODES: readonly string[] = manifest.codes;
