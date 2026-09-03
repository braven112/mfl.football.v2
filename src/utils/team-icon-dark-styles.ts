/**
 * The complete crest treatment, as ONE composition.
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
import { buildEraCrestStrokeCss, buildEraCrestShapeCss } from './era-crest-stroke-css';

const THELEAGUE_ICON_DIR = '/assets/theleague/icons';
const AFL_ICON_DIR = '/assets/afl/icons';

/**
 * Every crest rule for both leagues: the `iconDark` swaps, the white-stroke
 * fallback for crests measured as illegible on a dark card with no dark
 * variant, and the both-themes rim for Throwback Week era crests cut out of a
 * banner.
 *
 * `withStrokeColors` and the manifest both exclude any team carrying an
 * `iconDark`, so a crest can never get both the swap and the stroke.
 *
 * The era rims ride along here rather than in their own component precisely
 * because of the Storybook lesson above: a second head-injected sheet is a
 * second thing `.storybook/preview.ts` can forget, and Chromatic would then
 * baseline un-rimmed era crests as correct. One composition, two callers.
 * They are NOT dark-only — see `era-crest-stroke-css.ts` for why white and
 * `html.dark` are both wrong for a banner cut.
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
    buildEraCrestStrokeCss(theleagueConfig.teams),
    buildEraCrestStrokeCss(aflConfig.teams),
    buildEraCrestShapeCss(theleagueConfig.teams),
    buildEraCrestShapeCss(aflConfig.teams),
  ]
    .filter(Boolean)
    .join('\n');
}
