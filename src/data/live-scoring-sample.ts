/**
 * Sample live-scoring dataset for `/theleague/live-scoring?demo=1`.
 *
 * The real MFL `liveScoring` feed is empty in the offseason, so this bundled
 * snapshot lets us validate the deployed page (layout, theming, headshots, NFL
 * strip, moments) without a live game. It is only used when ?demo=1 is present
 * and the page renders a "SAMPLE DATA" badge; real usage never touches it.
 *
 * Player headshots use real ESPN ids so the deployed preview shows real photos
 * (a wrong/missing id degrades to the team-color gradient via the row onError).
 */

import type { LivePlayerRow, MatchupPairing, NflGame, PlayerMeta } from '../types/live-scoring';

/** Serializable moment seed (mirrors the island's Moment shape). */
export interface MomentSeed {
  key: string;
  fid: string;
  name: string;
  team: string;
  delta: number;
  clock: string;
}

export interface LiveScoringSample {
  week: number;
  matchups: MatchupPairing[];
  scores: Record<string, number>;
  remaining: Record<string, number>;
  players: Record<string, LivePlayerRow[]>;
  playersYetToPlay: Record<string, number>;
  playerMeta: Record<string, PlayerMeta>;
  nflGames: NflGame[];
  moments: MomentSeed[];
}

const ESPN = (id: string) => `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;

// [fid, name, pos, nflTeam, espnId, live, projected, secondsRemaining]
type Row = [string, string, string, string, string, number, number, number];

const ROSTERS: Row[] = [
  // Pacific Pigskins (0001)
  ['0001', 'Josh Allen', 'QB', 'BUF', '3918298', 24.6, 28.4, 1800],
  ['0001', 'Bijan Robinson', 'RB', 'ATL', '4430807', 18.2, 21.0, 900],
  ['0001', 'Saquon Barkley', 'RB', 'PHI', '3929630', 22.1, 22.1, 0],
  ['0001', "Ja'Marr Chase", 'WR', 'CIN', '4362628', 9.4, 19.8, 1800],
  ['0001', 'Puka Nacua', 'WR', 'LAR', '4426515', 0.0, 14.2, 3600],
  ['0001', 'Travis Kelce', 'TE', 'KC', '15847', 6.1, 11.0, 300],
  ['0001', 'Jahmyr Gibbs', 'RB', 'DET', '4429795', 15.7, 16.5, 700],
  ['0001', 'Ravens D/ST', 'DEF', 'BAL', '', 6.0, 7.5, 1200],
  // The Magicians (0015)
  ['0015', 'Lamar Jackson', 'QB', 'BAL', '3916387', 21.3, 26.0, 1200],
  ['0015', 'Christian McCaffrey', 'RB', 'SF', '3117251', 12.0, 20.4, 2400],
  ['0015', 'Derrick Henry', 'RB', 'BAL', '3043078', 19.8, 18.0, 1200],
  ['0015', 'Justin Jefferson', 'WR', 'MIN', '4262921', 27.5, 24.0, 0],
  ['0015', 'CeeDee Lamb', 'WR', 'DAL', '4241389', 4.2, 16.6, 600],
  ['0015', 'Sam LaPorta', 'TE', 'DET', '4430027', 8.9, 10.5, 700],
  ['0015', 'Amon-Ra St. Brown', 'WR', 'DET', '4374302', 11.1, 15.0, 700],
  ['0015', '49ers D/ST', 'DEF', 'SF', '', 3.0, 7.0, 2400],
  // Music City (0006)
  ['0006', 'Jalen Hurts', 'QB', 'PHI', '4040715', 22.0, 24.0, 900],
  ['0006', 'A.J. Brown', 'WR', 'PHI', '4047646', 14.0, 16.0, 900],
  // Midwest (0011)
  ['0011', 'Jared Goff', 'QB', 'DET', '3046779', 18.0, 19.0, 900],
  ['0011', 'Jaylen Waddle', 'WR', 'MIA', '4372016', 12.0, 14.0, 900],
  // Dead Cap (0004)
  ['0004', 'Josh Jacobs', 'RB', 'GB', '4047365', 24.0, 22.0, 0],
  // Vitside (0012)
  ['0012', 'Nico Collins', 'WR', 'HOU', '4258173', 0.0, 14.0, 3600],
];

const game = (
  away: string, aScore: number, home: string, hScore: number,
  state: 'pre' | 'in' | 'post', shortDetail: string, period: number, clock: string,
  possession: string | null,
): NflGame => ({
  id: `${away}-${home}`, state, shortDetail, period, clock,
  away: { code: away, score: aScore }, home: { code: home, score: hScore },
  possession, date: '',
});

export function getLiveScoringSample(opts: { doubleheader?: boolean } = {}): LiveScoringSample {
  const players: Record<string, LivePlayerRow[]> = {};
  const playerMeta: Record<string, PlayerMeta> = {};
  const scores: Record<string, number> = {};
  const remaining: Record<string, number> = {};
  const playersYetToPlay: Record<string, number> = {};

  let n = 0;
  for (const [fid, name, pos, team, espnId, live, projected, sec] of ROSTERS) {
    const id = `demo${++n}`;
    playerMeta[id] = {
      id, name, position: pos, nflTeam: team,
      headshot: espnId ? ESPN(espnId) : '',
      espnId: espnId || null,
      projected,
    };
    (players[fid] ??= []).push({ id, live, secondsRemaining: sec, status: 'starter' });
  }

  for (const [fid, rows] of Object.entries(players)) {
    scores[fid] = Number(rows.reduce((s, r) => s + r.live, 0).toFixed(1));
    remaining[fid] = rows.reduce((s, r) => s + r.secondsRemaining, 0);
    playersYetToPlay[fid] = rows.filter((r) => r.secondsRemaining >= 3600).length;
  }

  // Doubleheader demo: franchise 0001 plays two games this week.
  const matchups = opts.doubleheader
    ? [
        { home: '0001', away: '0015' },
        { home: '0001', away: '0006' },
        { home: '0004', away: '0012' },
      ]
    : [
        { home: '0001', away: '0015' },
        { home: '0006', away: '0011' },
        { home: '0004', away: '0012' },
      ];

  return {
    week: 15,
    matchups,
    scores,
    remaining,
    players,
    playersYetToPlay,
    playerMeta,
    nflGames: [
      game('CIN', 20, 'BUF', 17, 'in', '8:12 - 3rd', 3, '8:12', 'BUF'),
      game('SF', 10, 'LAR', 13, 'in', '2:40 - 2nd', 2, '2:40', 'SF'),
      game('DAL', 24, 'PHI', 27, 'in', '5:00 - 4th', 4, '5:00', 'PHI'),
      game('MIN', 27, 'GB', 24, 'post', 'Final', 4, '0:00', null),
      game('KC', 0, 'LAC', 0, 'pre', 'Sun 8:20 PM', 0, '', null),
      game('HOU', 0, 'TEN', 0, 'pre', 'Mon 8:15 PM', 0, '', null),
    ],
    moments: [
      { key: 'm1', fid: '0015', name: 'Justin Jefferson', team: 'MIN', delta: 8.8, clock: 'Final' },
      { key: 'm2', fid: '0001', name: 'Josh Allen', team: 'BUF', delta: 6.4, clock: 'Q2 0:00' },
      { key: 'm3', fid: '0001', name: 'Bijan Robinson', team: 'ATL', delta: 2.2, clock: 'Q3 1:40' },
      { key: 'm4', fid: '0015', name: 'Derrick Henry', team: 'BAL', delta: 7.2, clock: 'Q3 5:20' },
    ],
  };
}
