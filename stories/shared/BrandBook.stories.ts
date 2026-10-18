import BrandFileStrip from '../../src/components/shared/brand/BrandFileStrip.astro';
import { allModes } from '../../.storybook/modes';

/**
 * A Brand Book filmstrip: every file on a league, conference, division or
 * archive page is listed through this one strip. Each box paints the ground
 * its file was drawn for, so a light-theme and a dark-theme snapshot must
 * look the same inside the boxes.
 */
export default {
  title: 'Shared/Brand Book/File strip',
  component: BrandFileStrip,
  parameters: { chromatic: { modes: allModes } },
};

export const DivisionBadges = {
  args: {
    subject: 'East',
    files: [
      { label: 'East', filename: 'east.svg', url: '/assets/theleague/division-badges/east.svg', forDark: false },
      { label: 'East', filename: 'east.svg', url: '/assets/theleague/halloween-marks/division-badges/east.svg', forDark: true },
    ],
  },
};

export const LightAndDarkCutsWithASource = {
  args: {
    subject: 'AFL',
    files: [
      { label: 'Premier League', filename: 'premier.svg', url: '/assets/afl/premier.svg', forDark: false },
      { label: 'Premier League, dark', filename: 'premier-dark.svg', url: '/assets/afl/premier-dark.svg', forDark: true },
      { label: 'AFL Team Logo (master PSD)', filename: 'afl_team_logo.psd', // Not an /assets path: a PSD renders as a label box, never an image, and
      // the master file is not in the repo for the Chromatic asset scan to find.
      url: 'afl_team_logo.psd', forDark: false, source: true },
    ],
  },
};
