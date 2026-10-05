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
 *   1. `src/components/shared/TeamIconDarkStyles.astro` — the shared layout <head>.
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
 * Every registry league's rules are always emitted, with no league branching:
 * the selectors are exact `src` matches, which can never collide across leagues.
 */
import { ALL_LEAGUES } from '../config/leagues-data.mjs';
import { getLeagueTeams } from './league-config';
import { buildTeamIconDarkCss } from './team-icon-dark-css';
import { buildCrestDarkStrokeCss, withStrokeColors } from './crest-dark-stroke-css';
import {
  buildEraCrestStrokeCss,
  buildEraCrestShapeCss,
  buildEraCrestDarkStrokeCss,
} from './era-crest-stroke-css';
import { buildTvLogoThemeCss } from './tv-logo-theme-css';

/** Each league's franchise icons live at /assets/<navSlug>/icons/<id>.png. */
const iconDirFor = (navSlug: string) => `/assets/${navSlug}/icons`;

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
  // Every registry league with teams, in registry order; a league without
  // dark art, measured strokes or eras contributes nothing.
  const leagues = ALL_LEAGUES.map((l) => ({ slug: l.navSlug, teams: getLeagueTeams(l.navSlug) })).filter(
    (l) => l.teams.length > 0,
  );
  return [
    ...leagues.map((l) => buildTeamIconDarkCss(l.teams, { franchiseIconDir: iconDirFor(l.slug) })),
    ...leagues.map((l) =>
      buildCrestDarkStrokeCss(withStrokeColors(l.slug, l.teams), { franchiseIconDir: iconDirFor(l.slug) }),
    ),
    ...leagues.map((l) => buildEraCrestStrokeCss(l.teams)),
    ...leagues.map((l) => buildEraCrestShapeCss(l.teams)),
    ...leagues.map((l) => buildEraCrestDarkStrokeCss(l.teams)),
    // TV network marks (Sunday Ticket board): same swap-else-stroke treatment,
    // in both directions — a broadcaster's brand can be pale (Channel 5, Kayo)
    // where a crest never is, so this block carries `html:not(.dark)` rules too.
    buildTvLogoThemeCss(),
  ]
    .filter(Boolean)
    .join('\n');
}
