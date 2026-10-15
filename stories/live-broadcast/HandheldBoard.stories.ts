import { createElement } from 'react';
import HandheldBoard from '../../src/components/shared/live-broadcast/HandheldBoard';
import type {
  BroadcastLeaguePanel,
  BroadcastLeagueScore,
  BroadcastTeam,
} from '../../src/types/live-broadcast';
import type { BroadcastMoment } from '../../src/utils/broadcast-moments';

/**
 * The broadcast on a phone held sideways beside the TV: matchup cards, and
 * every play as a banner along the bottom.
 *
 * Dark in both themes, like the TV board, so one mode at a landscape phone
 * size covers it. Crests are left empty so the snapshot depends on no asset.
 */
export default {
  title: 'Live Broadcast/HandheldBoard',
  component: HandheldBoard,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: {
      modes: {
        'Phone landscape': { theme: 'dark', league: 'theleague', viewport: { width: 844, height: 390 } },
      },
    },
  },
};

const team = (id: string, name: string, swatch: string): BroadcastTeam => ({
  franchiseId: id,
  name,
  nameShort: name,
  abbrev: name.slice(0, 3).toUpperCase(),
  icon: '',
  iconSmall: '',
  primary: swatch,
  secondary: '#1f2937',
  swatch,
  gradient: '',
});

const pigskins = team('0001', 'Pigskins', '#c8102e');

const panels: BroadcastLeaguePanel[] = [
  {
    leagueId: 'a',
    leagueName: 'The League',
    slug: 'theleague',
    franchiseId: '0001',
    home: true,
    status: 'ok',
    matchups: [{ index: 0, mine: pigskins, opponent: team('0002', 'Ninjas', '#15803d') }],
  },
  {
    leagueId: 'b',
    leagueName: 'AFL Fantasy',
    slug: 'afl-fantasy',
    franchiseId: '0001',
    home: true,
    status: 'ok',
    matchups: [
      { index: 0, mine: team('0001', 'Hammers', '#1d4ed8'), opponent: team('0004', 'Comets', '#a16207') },
      { index: 1, mine: team('0001', 'Hammers', '#1d4ed8'), opponent: team('0007', 'Gators', '#047857') },
    ],
  },
  {
    leagueId: 'c',
    leagueName: 'Work League',
    slug: '',
    franchiseId: '0003',
    home: false,
    status: 'unavailable',
    matchups: [{ index: 0, mine: team('0003', 'Office Bears', '#7c3aed'), opponent: team('0006', 'Interns', '#be185d') }],
  },
];

const score = (live: number, projectedFinal: number, yetToPlay: number) => ({
  live,
  projectedFinal,
  remainingPoints: projectedFinal - live,
  yetToPlay,
  players: [],
});

const scores: Record<string, BroadcastLeagueScore> = {
  a: { leagueId: 'a', ok: true, live: true, winProbability: [0.72], teams: { '0001': score(84.2, 112.4, 3), '0002': score(71.6, 98.1, 2) } },
  b: {
    leagueId: 'b',
    ok: true,
    live: true,
    winProbability: [0.41, 0.58],
    teams: { '0001': score(66.0, 101.3, 4), '0004': score(73.4, 104.9, 3), '0007': score(59.8, 95.0, 5) },
  },
  c: { leagueId: 'c', ok: false, live: false, winProbability: [], teams: {} },
};

const moment = {
  key: 'p1:a:0001',
  playId: 'p1',
  leagueId: 'a',
  leagueName: 'The League',
  franchiseId: '0001',
  franchiseName: 'Pigskins',
  side: 'mine',
  kind: 'touchdown',
  playerId: '1',
  playerName: 'Davante Adams',
  team: 'LAR',
  text: 'Davante Adams 32 Yd pass (Kick)',
  clock: 'Q3 4:08',
  wallclock: '2026-10-11T22:14:00Z',
  scoreValue: 11.2,
  yards: 32,
} as BroadcastMoment;

const base = {
  week: 6,
  panels,
  scores,
  games: [],
  meta: {},
  live: true,
  moment: null,
  momentTeam: null,
  momentScoreLine: '',
  redZone: [],
  statusText: '',
  statusError: false,
};

export const Cards = { render: () => createElement(HandheldBoard, base) };

export const YourPlay = {
  render: () =>
    createElement(HandheldBoard, { ...base, moment, momentTeam: pigskins, momentScoreLine: '84.2 – 71.6' }),
};

export const PlayAgainstYou = {
  render: () =>
    createElement(HandheldBoard, {
      ...base,
      moment: { ...moment, side: 'opponent', playerName: 'James Cook', text: 'James Cook 4 Yd Rush (Kick)', scoreValue: 6.4 } as BroadcastMoment,
      momentTeam: panels[0].matchups[0].opponent,
      momentScoreLine: '84.2 – 71.6',
    }),
};

/** More matchups than one landscape screen holds: the cards become pages. */
const extraPanels: BroadcastLeaguePanel[] = ['d', 'e', 'f'].map((id, i) => ({
  leagueId: id,
  leagueName: ['Dynasty Two', 'Family League', 'Best Ball'][i],
  slug: '',
  franchiseId: '0001',
  home: false,
  status: 'ok',
  matchups: [
    { index: 0, mine: team('0001', ['Wolves', 'Dads', 'Drafters'][i], '#0e7490'), opponent: team('0009', 'Rivals', '#b45309') },
    { index: 1, mine: team('0001', ['Wolves', 'Dads', 'Drafters'][i], '#0e7490'), opponent: team('0010', 'Others', '#9d174d') },
  ],
}));
const extraScores: Record<string, BroadcastLeagueScore> = Object.fromEntries(
  extraPanels.map((p) => [
    p.leagueId,
    {
      leagueId: p.leagueId,
      ok: true,
      live: true,
      winProbability: [0.55, 0.47],
      teams: { '0001': score(70.1, 99.0, 3), '0009': score(64.3, 96.2, 4), '0010': score(77.7, 101.5, 2) },
    },
  ]),
);

export const ManyLeagues = {
  render: () =>
    createElement(HandheldBoard, {
      ...base,
      panels: [...panels, ...extraPanels],
      scores: { ...scores, ...extraScores },
    }),
};

/** Two of the owner's starters on offense, one of them in the red zone. */
const fieldMeta = {
  p1: { id: 'p1', name: 'Patrick Mahomes', position: 'QB', nflTeam: 'KC', headshot: '', espnId: null, projected: 0 },
  p2: { id: 'p2', name: 'George Kittle', position: 'TE', nflTeam: 'SF', headshot: '', espnId: null, projected: 0 },
  p3: { id: 'p3', name: 'Davante Adams', position: 'WR', nflTeam: 'LAR', headshot: '', espnId: null, projected: 0 },
};
const row = (id: string, live: number) => ({ id, live, secondsRemaining: 1200, status: 'starter' });
const liveGame = (id: string, home: string, away: string, possession: string, isRedZone: boolean) => ({
  id,
  state: 'in' as const,
  shortDetail: '07:31 - 3rd',
  period: 3,
  clock: '07:31',
  date: '',
  home: { code: home, score: 17 },
  away: { code: away, score: 10 },
  possession,
  situation: { possession, isRedZone, downDistanceText: '1st & Goal at 6', shortDownDistanceText: '1st & Goal', lastPlay: '' },
});

export const OnTheField = {
  render: () =>
    createElement(HandheldBoard, {
      ...base,
      meta: fieldMeta,
      scores: {
        ...scores,
        a: { ...scores.a, teams: { ...scores.a.teams, '0001': { ...scores.a.teams['0001'], players: [row('p1', 18.4), row('p2', 6.1), row('p3', 9.0)] } } },
      },
      games: [liveGame('g1', 'KC', 'LV', 'KC', true), liveGame('g2', 'SF', 'SEA', 'SF', false), liveGame('g3', 'LAR', 'ARI', 'ARI', false)],
      redZone: [
        {
          team: 'KC',
          downDistance: '1st & Goal',
          players: [{ leagueId: 'a', leagueName: 'The League', side: 'mine', playerId: 'p1', playerName: 'Patrick Mahomes', position: 'QB' }],
        },
      ],
    }),
};
