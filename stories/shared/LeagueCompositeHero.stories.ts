import LeagueCompositeHero from '../../src/components/shared/LeagueCompositeHero.astro';
import {
  aflWaiverDay,
  theLeagueWaiverDay,
  theLeagueWaiversCleared,
} from '../fixtures/league-composite-hero';

/**
 * The homepage composite hero, for any league: a resolved `EventHeroView`
 * rendered as the spotlight card (ghost wordmark, palette, cast player).
 *
 * The AFL routes most of its hero states here; TheLeague routes its waiver-day
 * card here. Storyable because it takes one resolved view plus a `league` —
 * no feeds, no clock, no auth — which is also what let the second league adopt
 * it without a fork.
 *
 * The palette comes from `view.composite.accent`, NOT from `league`: the two
 * waiver-day stories are the same view in each league's colours, and a
 * regression that let `league` leak into the palette shows up as those two
 * snapshots converging. The league arg only picks the crest, the franchise skin
 * and the fallback mark (see `NoCutout`).
 *
 * Light + dark via the global `themeModes`. The league skin is decided by args,
 * so `leagueModes` would add snapshots that cannot differ.
 */
export default {
  title: 'Shared/LeagueCompositeHero',
  component: LeagueCompositeHero,
  parameters: { layout: 'padded' },
  args: {
    view: theLeagueWaiverDay,
    regionLabel: 'Waiver Wire',
    league: 'theleague',
  },
  argTypes: {
    league: { control: 'inline-radio', options: ['theleague', 'afl-fantasy'] },
  },
};

/** TheLeague's waiver day: its blue (`kickoff`), 7:00 PM PT. */
export const TheLeagueWaiverDay = {};

/** The same card in the AFL's navy, 8:00 PM PT. */
export const AflWaiverDay = {
  args: { view: aflWaiverDay, league: 'afl-fantasy' },
};

/** After the run — the `fcfs` state, the only one worded as cleared. */
export const WaiversCleared = {
  args: { view: theLeagueWaiversCleared },
};

/**
 * No cast player: the league's own mark takes the flank. Production reaches
 * this when the cutout 404s; the silhouette must be the viewer's league.
 */
export const NoCutout = {
  args: { view: { ...theLeagueWaiverDay, model: null } },
};

/** The AFL's mark in the same fallback. */
export const NoCutoutAfl = {
  args: { view: { ...aflWaiverDay, model: null }, league: 'afl-fantasy' },
};
