import BrandSubjectTiles from '../../src/components/shared/brand/BrandSubjectTiles.astro';
import { allModes } from '../../.storybook/modes';

/**
 * The Brand Book index's league, conference and division tiles. These marks
 * have no colour of their own, so each tile stands on the ground its art was
 * drawn for; a former division carries the "former" flag.
 */
export default {
  title: 'Shared/Brand Book/Subject tiles',
  component: BrandSubjectTiles,
  parameters: { chromatic: { modes: allModes } },
};

export const LeagueConferencesAndDivisions = {
  args: {
    tiles: [
      { href: '#', name: 'AFL', eyebrow: 'League', art: '/assets/logos/afl-logo.svg', artForDark: false },
      { href: '#', name: 'American League', eyebrow: 'Conference', art: '/assets/afl/conferences/al.svg', artForDark: false },
      { href: '#', name: 'AL North', eyebrow: 'American League', art: '/assets/afl/awards/al-north.svg', artForDark: false },
      { href: '#', name: 'AL Central', eyebrow: 'American League', art: '/assets/afl/awards/al-central.svg', artForDark: false, flag: 'former' },
      { href: '#', name: 'Retired clubs', eyebrow: 'Archive', art: null, artForDark: false },
    ],
  },
};
