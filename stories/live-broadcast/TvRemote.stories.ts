import TvRemote from '../../src/components/shared/live-broadcast/TvRemote';
import '../../src/styles/tv-remote.css';

/**
 * Remote mode (/live/broadcast/remote): the phone as a remote for a paired
 * TV, in portrait at phone size. The TVs are passed in, so no story asks a
 * server; a press sends nothing anywhere and reports "Could not reach the TV".
 */
export default {
  title: 'Live Broadcast/TvRemote',
  component: TvRemote,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: {
      modes: {
        'Phone light': { theme: 'light', league: 'mfl', viewport: { width: 390, height: 1100 } },
        'Phone dark': { theme: 'dark', league: 'mfl', viewport: { width: 390, height: 1100 } },
      },
    },
  },
};

const leagues = [
  { id: '13522', name: 'TheLeague' },
  { id: '19621', name: 'AFL Fantasy' },
];

export const OneTv = {
  args: { leagues, tvs: [{ id: 'a', device: 'Google TV', createdAt: 1 }] },
};

export const TwoTvs = {
  args: {
    leagues,
    tvs: [
      { id: 'a', device: 'Google TV', createdAt: 1 },
      { id: 'b', device: 'Fire TV', createdAt: 2 },
    ],
  },
};

export const NoTvPaired = {
  args: { leagues, tvs: [] },
};
