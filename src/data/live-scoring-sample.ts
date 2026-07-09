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
  // Dead Cap (0004) — Jacobs' game is final (MIN@GB); the other two are mid-game
  // on in-progress sample games (see nflGames) so the scoreboard and NFL strip agree.
  ['0004', 'Josh Jacobs', 'RB', 'GB', '4047365', 24.0, 22.0, 0],
  ['0004', 'George Kittle', 'TE', 'SF', '3040151', 16.5, 24.0, 1800],
  ['0004', 'Cooper Kupp', 'WR', 'LAR', '2977187', 12.0, 15.0, 900],
  // Vitside (0012) — starters on in-progress sample games (see nflGames)
  ['0012', 'Deebo Samuel', 'WR', 'SF', '3126486', 17.2, 20.0, 900],
  ['0012', 'James Cook', 'RB', 'BUF', '4379399', 19.5, 22.0, 1800],
  ['0012', 'DeVonta Smith', 'WR', 'PHI', '4241478', 16.0, 18.0, 900],
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

// Player pool for the 10 franchises without a hand-authored roster, so a full
// slate has realistic team totals + win probabilities. (Demo data — names need
// not match each franchise's real roster; wrong ESPN ids fall back to the
// team-color gradient.)
const POOL: Array<[string, string, string, string]> = [
  ['Patrick Mahomes', 'QB', 'KC', '3139477'],
  ['Tyreek Hill', 'WR', 'MIA', '3116406'],
  ['Saquon Barkley', 'RB', 'PHI', '3929630'],
  ['A.J. Brown', 'WR', 'PHI', '4047646'],
  ['Jahmyr Gibbs', 'RB', 'DET', '4429795'],
  ['Jared Goff', 'QB', 'DET', '3046779'],
  ['Josh Jacobs', 'RB', 'GB', '4047365'],
  ['Jaylen Waddle', 'WR', 'MIA', '4372016'],
  ['Derrick Henry', 'RB', 'BAL', '3043078'],
  ['Travis Kelce', 'TE', 'KC', '15847'],
  ['CeeDee Lamb', 'WR', 'DAL', '4241389'],
  ['Bijan Robinson', 'RB', 'ATL', '4430807'],
  ["Ja'Marr Chase", 'WR', 'CIN', '4362628'],
  ['Puka Nacua', 'WR', 'LAR', '4426515'],
  ['Amon-Ra St. Brown', 'WR', 'DET', '4374302'],
  ['Christian McCaffrey', 'RB', 'SF', '3117251'],
  ['Justin Jefferson', 'WR', 'MIN', '4262921'],
  ['Lamar Jackson', 'QB', 'BAL', '3916387'],
  ['Josh Allen', 'QB', 'BUF', '3918298'],
  ['Jalen Hurts', 'QB', 'PHI', '4040715'],
  ['Nico Collins', 'WR', 'HOU', '4258173'],
];
const EXTRA_TEAMS = ['0002', '0003', '0005', '0007', '0008', '0009', '0010', '0013', '0014', '0016'];

// Full weekly slate (16 teams). Single game: round A (8 matchups). Doubleheader:
// round A + round B (16 matchups) — every team, including yours, plays twice.
const ROUND_A = [
  { away: '0015', home: '0001' },
  { away: '0002', home: '0003' },
  { away: '0004', home: '0005' },
  { away: '0006', home: '0007' },
  { away: '0008', home: '0009' },
  { away: '0010', home: '0011' },
  { away: '0012', home: '0013' },
  { away: '0014', home: '0016' },
];
const ROUND_B = [
  { away: '0006', home: '0001' },
  { away: '0003', home: '0004' },
  { away: '0005', home: '0002' },
  { away: '0007', home: '0008' },
  { away: '0009', home: '0010' },
  { away: '0011', home: '0012' },
  { away: '0013', home: '0014' },
  { away: '0016', home: '0015' },
];

export function getLiveScoringSample(opts: { doubleheader?: boolean } = {}): LiveScoringSample {
  const players: Record<string, LivePlayerRow[]> = {};
  const playerMeta: Record<string, PlayerMeta> = {};
  const scores: Record<string, number> = {};
  const remaining: Record<string, number> = {};
  const playersYetToPlay: Record<string, number> = {};

  let n = 0;
  const addStarter = (fid: string, name: string, pos: string, team: string, espnId: string, live: number, projected: number, sec: number) => {
    const id = `demo${++n}`;
    playerMeta[id] = {
      id, name, position: pos, nflTeam: team,
      headshot: espnId ? ESPN(espnId) : '',
      espnId: espnId || null,
      projected,
    };
    (players[fid] ??= []).push({ id, live, secondsRemaining: sec, status: 'starter' });
  };

  for (const [fid, name, pos, team, espnId, live, projected, sec] of ROSTERS) {
    addStarter(fid, name, pos, team, espnId, live, projected, sec);
  }

  // Lightweight 3-man rosters for the remaining franchises (deterministic).
  EXTRA_TEAMS.forEach((fid, t) => {
    for (let i = 0; i < 3; i++) {
      const p = POOL[(t * 3 + i) % POOL.length];
      const live = 6 + ((t * 5 + i * 9) % 24);
      const projected = live + 3 + ((t + i * 2) % 12);
      const sec = [0, 1800, 3600][(t + i) % 3];
      addStarter(fid, p[0], p[1], p[2], p[3], live, projected, sec);
    }
  });

  for (const [fid, rows] of Object.entries(players)) {
    scores[fid] = Number(rows.reduce((s, r) => s + r.live, 0).toFixed(1));
    remaining[fid] = rows.reduce((s, r) => s + r.secondsRemaining, 0);
    playersYetToPlay[fid] = rows.filter((r) => r.secondsRemaining >= 3600).length;
  }

  const matchups = opts.doubleheader ? [...ROUND_A, ...ROUND_B] : ROUND_A;

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
