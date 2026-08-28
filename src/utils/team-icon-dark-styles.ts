/**
 * The complete dark-mode crest treatment, as ONE composition.
 *
 * Four builder calls with two leagues' configs and two icon directories, and
 * they are order- and pairing-sensitive: the swap rules must be emitted for
 * both leagues, and the stroke fallback must use the SAME `franchiseIconDir`
 * as the swap for its league or the selectors miss.
 *
 * This lives here rather than inline in `TeamIconDarkStyles.astro` because it
 * has two callers that must never disagree:
 *
 *   1. `src/components/TeamIconDarkStyles.astro` — the shared layout <head>.
 *   2. `.storybook/preview.ts` — stories render without that layout.
 *
 * Storybook previously reproduced the other three head-injected sheets by
 * calling their builders, but skipped this one because it was the only
 * composition rather than a zero-argument call — so franchise crests rendered
 * their LIGHT artwork in dark-mode stories, and Chromatic would have baselined
 * that as correct. Extracting the composition is what closes that, and is why
 * this must stay a single exported function rather than something each caller
 * assembles for itself.
 *
 * Both leagues' rules are always emitted, with no league branching: the
 * selectors are exact `src` matches, which can never collide across leagues.
 */
import theleagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';
import { buildTeamIconDarkCss } from './team-icon-dark-css';
import { buildCrestDarkStrokeCss, withStrokeColors } from './crest-dark-stroke-css';

const THELEAGUE_ICON_DIR = '/assets/theleague/icons';
const AFL_ICON_DIR = '/assets/afl/icons';

/**
 * Every dark-mode crest rule for both leagues: the `iconDark` swaps, plus the
 * white-stroke fallback for crests measured as illegible on a dark card that
 * have no dark variant.
 *
 * `withStrokeColors` and the manifest both exclude any team carrying an
 * `iconDark`, so a crest can never get both the swap and the stroke.
 */
export function buildAllTeamIconDarkCss(): string {
  return [
    buildTeamIconDarkCss(theleagueConfig.teams, { franchiseIconDir: THELEAGUE_ICON_DIR }),
    buildTeamIconDarkCss(aflConfig.teams, { franchiseIconDir: AFL_ICON_DIR }),
    buildCrestDarkStrokeCss(withStrokeColors('theleague', theleagueConfig.teams), {
      franchiseIconDir: THELEAGUE_ICON_DIR,
    }),
    buildCrestDarkStrokeCss(withStrokeColors('afl', aflConfig.teams), {
      franchiseIconDir: AFL_ICON_DIR,
    }),
  ]
    .filter(Boolean)
    .join('\n');
}
