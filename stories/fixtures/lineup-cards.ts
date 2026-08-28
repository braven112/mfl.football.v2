/**
 * Fixtures for LineupGameStrip.
 *
 * Mirrors what `buildMatchupCards` (src/utils/lineup-matchup-cards.ts)
 * produces, frozen by hand: the real builder reads the week's live
 * projections, the signed-in owner's roster and the opponent's, none of which
 * a story can reach.
 *
 * Headshots and watermarks are inline data URIs. Same rule as the playoff
 * fixtures: a visual regression suite must never depend on a third party's
 * CDN, because Chromatic waits for network idle before capturing.
 */

import type { MatchupCard } from '../../src/utils/lineup-matchup-cards';

/**
 * Neutral player silhouette — deterministic and offline.
 *
 * Written as a LITERAL, not built with `Buffer.from(...)`. Story modules are
 * bundled for the browser, where `Buffer` does not exist: the module throws on
 * import, the args never construct, and the story renders EMPTY rather than
 * erroring visibly. Keep fixture modules free of Node globals.
 */
const FACE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48Y2lyY2xlIGN4PScxMDAnIGN5PSc3Micgcj0nNDInIGZpbGw9JyNjZmQ0ZGEnLz48cGF0aCBkPSdNMjAgMjAwYzAtNDYgMzYtNzQgODAtNzRzODAgMjggODAgNzR6JyBmaWxsPScjY2ZkNGRhJy8+PC9zdmc+';

function model(name: string, position: string, nflTeam: string) {
  return { mflId: '0000', name, position, nflTeam, headshot: FACE, descriptor: '' };
}

function side(
  name: string,
  position: string,
  nflTeam: string,
  chip: string,
  color: string,
  stat: string,
) {
  return { model: model(name, position, nflTeam), chip, color, stat };
}

/** A single game — the shape that renders exactly as it always has. */
export const singleGame: MatchupCard[] = [
  {
    opponentFranchiseId: '0004',
    faceoff: {
      away: side('Ja’Marr Chase', 'WR', 'CIN', 'SKINS', '#bd1f2b', '24.6 proj'),
      home: side('Christian McCaffrey', 'RB', 'SF', 'DEAD CAP', '#203b5b', '21.2 proj'),
      statSource: 'projected',
    },
    awayChip: 'Pigskins',
    homeChip: 'Dead Cap',
    title: 'Week 12',
    userScoreSide: 'away',
    awayProjTotal: 128.4,
    homeProjTotal: 121.2,
    hasProjTotals: true,
  },
];

/** More than one game turns the strip into a swipeable carousel. */
export const doubleHeader: MatchupCard[] = [
  singleGame[0],
  {
    opponentFranchiseId: '0003',
    faceoff: {
      away: side('Justin Jefferson', 'WR', 'MIN', 'SKINS', '#bd1f2b', '19.8 proj'),
      home: side('Patrick Mahomes', 'QB', 'KC', 'MAVS', '#181818', '23.1 proj'),
      statSource: 'projected',
    },
    awayChip: 'Pigskins',
    homeChip: 'Mavericks',
    title: 'Week 12 · Game 2',
    userScoreSide: 'away',
    awayProjTotal: 119.7,
    homeProjTotal: 124.9,
    hasProjTotals: true,
  },
];

/**
 * Neither side composites — `faceoff: null` renders the band-only card.
 * This is the degraded path, and the one nobody looks at on purpose.
 */
export const bandOnly: MatchupCard[] = [
  {
    opponentFranchiseId: '0005',
    faceoff: null,
    awayChip: 'Pigskins',
    homeChip: 'Ninjas',
    title: 'Week 12',
    userScoreSide: 'home',
    awayProjTotal: 0,
    homeProjTotal: 0,
    hasProjTotals: false,
  },
];

/** Completed week: real scores rather than projections. */
export const finalScore: MatchupCard[] = [
  {
    ...singleGame[0],
    faceoff: {
      away: side('Ja’Marr Chase', 'WR', 'CIN', 'SKINS', '#bd1f2b', '31.4 pts'),
      home: side('Christian McCaffrey', 'RB', 'SF', 'DEAD CAP', '#203b5b', '18.9 pts'),
      statSource: 'actual',
    },
    awayProjTotal: 141.8,
    homeProjTotal: 117.3,
  },
];
