import FaPositionLeaders from '../../src/components/shared/free-agents/FaPositionLeaders.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * Primetime Free Agents: the best healthy free agent at each position, by this
 * week's projection, with the next two behind him. Cards are a team-colour
 * fill that is dark in both themes. Headshots load from ESPN on the live site.
 */
export default {
  title: 'Shared/Free Agents/Position leaders',
  component: FaPositionLeaders,
  parameters: { layout: 'padded', chromatic: { modes: themeModes } },
};

const KICKOFF = Date.UTC(2026, 9, 18, 17, 0) / 1000;
const p = (id: string, name: string, position: string, team: string, projected: number) => ({ id, name, position, team, projected, espnId: null });

export const Default = {
  args: {
    activePoolId: '00',
    claimVerb: 'Bid',
    clock: { zone: 'America/Los_Angeles', label: 'PT' },
    poolName: () => 'Barry Sanders Division',
    nextGames: new Map([
      ['CHI', { opponent: 'ATL', home: false, kickoff: KICKOFF }],
      ['GB', { opponent: 'DAL', home: true, kickoff: KICKOFF + 26400 }],
      ['PIT', { opponent: 'TB', home: false, kickoff: KICKOFF }],
      ['DAL', { opponent: 'GB', home: false, kickoff: KICKOFF + 26400 }],
    ]),
    pools: [
      {
        id: '00',
        claimable: true,
        groups: [
          { position: 'QB', players: [p('1', 'Tyson Bagent', 'QB', 'CHI', 27.4), p('2', 'Jameis Winston', 'QB', 'NYG', 24.9), p('3', 'Aaron Rodgers', 'QB', 'PIT', 21.7)] },
          { position: 'RB', players: [p('4', 'MarShawn Lloyd', 'RB', 'GB', 10.8), p('5', 'Kenneth Gainwell', 'RB', 'PIT', 8.5), p('6', 'Sione Vaki', 'RB', 'DET', 7.5)] },
          { position: 'WR', players: [p('7', 'DK Metcalf', 'WR', 'PIT', 10.7), p('8', 'Dontayvion Wicks', 'WR', 'GB', 10.2), p('9', 'Romeo Doubs', 'WR', 'GB', 9.6)] },
          { position: 'TE', players: [p('10', 'Jake Ferguson', 'TE', 'DAL', 9.8), p('11', 'Brenton Strange', 'TE', 'JAX', 9.0), p('12', 'Hunter Henry', 'TE', 'NE', 8.9)] },
          { position: 'DEF', players: [p('13', 'Pittsburgh Steelers', 'DEF', 'PIT', 16.9), p('14', 'Las Vegas Raiders', 'DEF', 'LV', 10.8), p('15', 'Chicago Bears', 'DEF', 'CHI', 10.2)] },
        ],
      },
    ],
  },
};
