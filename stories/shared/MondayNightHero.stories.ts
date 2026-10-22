import MondayNightHero from '../../src/components/shared/MondayNightHero.astro';

/**
 * Monday's homepage hero (both leagues, 10am PT onward): the closest game
 * Monday night can still swing, worn by the player still to play in it with
 * the most projected points left. The rule lives in monday-spotlight.ts; this
 * only draws a spotlight it is handed, so a fixture is all it needs.
 */
const game = {
  home: { franchiseId: '0001', live: 86.72, projectedFinal: 101.4, stillToPlay: 1 },
  away: { franchiseId: '0002', live: 86.05, projectedFinal: 97.3, stillToPlay: 2 },
  projectedMargin: 4.1,
  homeWinProbability: 0.58,
  isViewer: false,
};

const spotlight = {
  league: 'theleague',
  week: 6,
  game,
  others: [
    {
      home: { franchiseId: '0003', live: 78.75, projectedFinal: 99.1, stillToPlay: 2 },
      away: { franchiseId: '0004', live: 93.59, projectedFinal: 93.59, stillToPlay: 0 },
      projectedMargin: 5.5,
      homeWinProbability: 0.6,
      isViewer: false,
    },
  ],
  teams: {
    '0001': { name: 'Pacific Pigskins', shortName: 'Pigskins', color: '#1c497c' },
    '0002': { name: 'Mariachi Ninjas', shortName: 'Mariachi Ninjas', color: '#a8321f' },
    '0003': { name: 'Dead Cap', shortName: 'Dead Cap', color: '#333333' },
    '0004': { name: 'The Dream', shortName: 'The Dream', color: '#6a3db6' },
  },
  model: {
    mflId: '17052',
    name: 'Bhayshul Tuten',
    position: 'RB',
    nflTeam: 'JAX',
    headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/4882093.png',
    descriptor: 'Still to play',
  },
  player: { playerId: '17052', name: 'Bhayshul Tuten', franchiseId: '0002', remainingProjection: 14.6 },
};

export default {
  title: 'Shared/MondayNightHero',
  component: MondayNightHero,
  parameters: { layout: 'padded' },
  args: { spotlight, liveScoringHref: '/theleague/live-scoring' },
};

/** A signed-out viewer: the league's closest game. */
export const LeagueClosest = {};

/** The viewer's own game is close, so it leads and names where they stand. */
export const YourGame = {
  args: {
    spotlight: { ...spotlight, game: { ...game, isViewer: true } },
    viewerFranchiseId: '0001',
  },
};

/** No cutout could be cast: the crest and copy still carry the card. */
export const NoCutout = {
  args: { spotlight: { ...spotlight, model: null } },
};
