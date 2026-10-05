import HeroBanner from '../../src/components/shared/HeroBanner.astro';
import { allModes } from '../../.storybook/modes';

/**
 * The editorial and event hero banner — shared since the per-league theme
 * review pages (/<league>/theme/light|dark) render it for every league.
 *
 * Snapshotted across leagues because its colours come from the league's theme
 * (src/themes/<id>.json): a league diff here is the theme working, not a
 * regression. No image story — the split layout loads a What's New screenshot,
 * and a snapshot must not depend on an asset another change can rename.
 */
export default {
  title: 'Shared/HeroBanner',
  component: HeroBanner,
  parameters: { chromatic: { modes: allModes } },
};

export const Editorial = {
  args: {
    variant: 'editorial',
    kicker: 'New Feature',
    kickerDate: 'Oct 2',
    title: 'Every Stat Behind Every Score',
    summary: 'Live Scoring now opens a stat sheet for any player you tap: his full line for the week, stat by stat, under the official score.',
    link: '#',
    linkLabel: 'Open Live Scoring',
    allNewsLink: '#',
    allNewsLabel: 'All releases',
  },
};

export const Event = {
  args: {
    variant: 'event',
    title: 'Trade Deadline',
    summary: 'Deals must be accepted before the deadline. Pending offers expire with it.',
    dateDisplay: 'Thu, Nov 13 · 4:00 PM',
    statusText: '3 days left',
    isActive: true,
    link: '#',
    linkLabel: 'Open the trade builder',
  },
};
