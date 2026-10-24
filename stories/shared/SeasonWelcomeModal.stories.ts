import SeasonWelcomeModal from '../../src/components/shared/SeasonWelcomeModal.astro';
import { buildSeasonWelcome } from '../../src/utils/season-welcome';
import { SEASONAL_THEMES } from '../../src/config/seasonal-themes.mjs';
import { themeModes } from '../../.storybook/modes';

/**
 * The seasonal welcome — "This week your logo is Pacific Pigskins' Christmas
 * Week look", shown once per device when a season with a welcome opens.
 *
 * Props are built by the real `buildSeasonWelcome`, so the crest and band
 * colours are exactly what the layout would pass.
 */
const welcome = (league: 'theleague' | 'afl', franchiseId: string) =>
  buildSeasonWelcome({ league, franchiseId, season: SEASONAL_THEMES.christmas, now: new Date('2026-12-22T18:00:00Z') })!;

export default {
  title: 'Shared/SeasonWelcomeModal',
  component: SeasonWelcomeModal,
  parameters: {
    layout: 'centered',
    chromatic: { modes: themeModes },
  },
  args: {
    welcome: welcome('theleague', '0001'),
    leagueSlug: 'theleague',
    previewOpen: true,
  },
};

export const Christmas = {};

export const AflTeam = {
  args: { welcome: welcome('afl', '0002'), leagueSlug: 'afl-fantasy' },
};
