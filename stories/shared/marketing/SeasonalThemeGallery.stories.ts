import SeasonalThemeGallery from '../../../src/components/shared/marketing/SeasonalThemeGallery.astro';

/**
 * The before-and-after logo gallery on /mfl-league-themes: regular marks next
 * to their Halloween and Christmas remakes, then the "your own season" ideas.
 * Takes no props; every image is a committed file under public/assets.
 */
export default {
  title: 'Shared/Marketing/SeasonalThemeGallery',
  component: SeasonalThemeGallery,
  parameters: {
    layout: 'padded',
  },
};

export const Default = {};
