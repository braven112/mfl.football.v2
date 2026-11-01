import { createElement } from 'react';
import type { ReactElement } from 'react';
import '../../src/styles/live-broadcast.css';
import DriveStakesCard from '../../src/components/shared/live-broadcast/DriveStakesCard';
import type { RedZoneAlert } from '../../src/utils/broadcast-moments';

/**
 * The "if he scores" card the TV board hangs under the red-zone banner: the
 * viewer's win chance now, and where one score on this drive would put it,
 * league by league.
 *
 * Dark in both themes, like the rest of the board, so one TV-sized mode
 * covers it. It is placed against the board's own header height, so the
 * decorator gives it a 16:9 `.lbc` ground to sit in.
 */
export default {
  title: 'Live Broadcast/DriveStakesCard',
  component: DriveStakesCard,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: {
      modes: {
        TV: { theme: 'dark', league: 'theleague', viewport: { width: 1280, height: 720 } },
      },
    },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement(
        'div',
        { className: 'lbc', style: { position: 'relative', width: '1280px', height: '720px', background: '#05070b' } },
        createElement(Story),
      ),
  ],
};

const player = (
  overrides: Partial<RedZoneAlert['players'][number]>,
): RedZoneAlert['players'][number] => ({
  leagueId: 'theleague',
  leagueName: 'TheLeague',
  side: 'mine',
  playerId: '2',
  playerName: 'Bijan Robinson',
  position: 'RB',
  franchiseId: '0001',
  ...overrides,
});

/** One player in three leagues: helps in two, and the third is an opponent's receiver on the same drive. */
export const OnePlayer = {
  args: {
    alerts: [
      {
        team: 'ATL',
        downDistance: '1st & Goal at NO 6',
        players: [
          player({ stake: { matchupIndex: 0, before: 0.54, after: 0.68, points: 6 } }),
          player({ leagueId: 'afl', leagueName: 'AFL', stake: { matchupIndex: 0, before: 0.71, after: 0.79, points: 6 } }),
        ],
      },
    ] satisfies RedZoneAlert[],
  },
};

/** Two players on the drive: each row names its player, and a loss is striped as well as amber. */
export const TwoPlayers = {
  args: {
    alerts: [
      {
        team: 'ATL',
        downDistance: '1st & Goal at NO 6',
        players: [
          player({ stake: { matchupIndex: 0, before: 0.54, after: 0.68, points: 6 } }),
          player({ leagueId: 'afl', leagueName: 'AFL', stake: { matchupIndex: 0, before: 0.71, after: 0.79, points: 6 } }),
          player({
            leagueId: 'dynasty',
            leagueName: 'Dynasty League',
            side: 'opponent',
            playerId: '12',
            playerName: 'Drake London',
            position: 'WR',
            franchiseId: '0007',
            stake: { matchupIndex: 0, before: 0.6, after: 0.51, points: 6 },
          }),
        ],
      },
    ] satisfies RedZoneAlert[],
  },
};
