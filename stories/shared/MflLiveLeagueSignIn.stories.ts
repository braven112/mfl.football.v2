import MflLiveLeagueSignIn from '../../src/components/shared/mfl-live/MflLiveLeagueSignIn.astro';
import { getLeagueBySlug } from '../../src/config/leagues';
import { mflModes } from '../../.storybook/modes';

/**
 * MFL Live's branded sign-in — what `/live?from=<slug>` shows a signed-out
 * owner who clicked through from their own league's site.
 *
 * The league's mark and wordmark sit above the standard MFL Live form, so the
 * page reads as their league's live scoring. `Archies` is the league it was
 * built for (a mark plus a wordmark); `TheLeague` has no wordmark and shows
 * the text-name arm instead.
 *
 * Light + dark under `mflModes` (`data-league="mfl"`), the palette the page
 * really renders in — the league brings only its art, never its colours.
 */
export default {
  title: 'Shared/MFL Live/League sign-in',
  component: MflLiveLeagueSignIn,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: mflModes },
  },
  args: {
    league: getLeagueBySlug('archies'),
    seasonYear: 2026,
  },
};

export const Archies = {};

export const TheLeague = {
  args: { league: getLeagueBySlug('theleague') },
};
