import FaMarketRail from '../../src/components/shared/free-agents/FaMarketRail.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * Primetime Free Agents: the league's market over the last week. Counts are
 * league-wide; the Available / Gone tag answers for the division being viewed.
 */
export default {
  title: 'Shared/Free Agents/Market rail',
  component: FaMarketRail,
  parameters: { layout: 'padded', chromatic: { modes: themeModes } },
};

const r = (id: string, name: string, position: string, team: string, count: number, freeIn: string[]) => ({ id, name, position, team, count, freeIn, free: freeIn.length > 0 });

export const Default = {
  args: {
    leagueName: "Archie's",
    activePoolId: '00',
    windowDays: 7,
    hot: [
      r('1', 'Cincinnati Bengals', 'DEF', 'CIN', 8, ['01', '04']),
      r('2', 'Keon Coleman', 'WR', 'BUF', 6, ['00', '01']),
      r('3', 'Will Shipley', 'RB', 'PHI', 6, ['00']),
      r('4', 'Cleveland Browns', 'DEF', 'CLE', 5, ['00', '02']),
    ],
    dropped: [
      r('5', 'Braelon Allen', 'RB', 'NYJ', 4, ['00']),
      r('6', 'Darren Waller', 'TE', 'CAR', 4, ['03']),
    ],
  },
};

export const QuietWeek = { args: { ...Default.args, hot: [], dropped: [] } };
