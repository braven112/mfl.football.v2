import HistoryRafters from '../../src/components/shared/league-history/HistoryRafters.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The Rafters: pennants in a franchise's broadcast colors. Gold stripe for a
 * title, silver for a title game lost, and a shorter, plain banner for a
 * division crown.
 */
export default {
  title: 'Shared/League History/HistoryRafters',
  component: HistoryRafters,
  parameters: { chromatic: { modes: themeModes } },
  args: { navSlug: 'theleague' },
};

const banner = (year: number, kind: 'C' | 'R' | 'D', caption: string) => ({
  year,
  kind,
  franchiseId: '0010',
  name: 'Computer Jocks',
  icon: '/assets/theleague/icons/computer_jocks.png',
  caption,
});

export const Titles = {
  args: { banners: [banner(2025, 'C', 'Champion'), banner(2019, 'R', 'Runner-up')] },
};

export const DivisionTitles = {
  args: { banners: [banner(2021, 'D', 'Northwest'), banner(2016, 'D', 'Northwest')] },
};
