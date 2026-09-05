/**
 * Fixtures for the Sunday Ticket board.
 *
 * Mirrors what `buildSundayTicketSlate` (src/utils/sunday-ticket-slate.ts)
 * produces, frozen by hand — the real builder reads the week's schedule feed,
 * the owner's rosters across leagues and each league's projections, none of
 * which a story can reach. Kickoffs are Week 2 of 2026 so the ET/PT labels
 * are real clock times, not offsets from "now".
 *
 * Headshots are inline data-URI literals, never a CDN URL (Chromatic waits
 * for network idle) and never built with `Buffer` (story modules are bundled
 * for the browser — storybook.md, Trap 6). The cast is the suite's standard
 * four TheLeague franchises plus one AFL and one outside league, because the
 * multi-league grouping is the thing these stories exist to pin.
 */

import type {
  GameBox,
  LeagueContribution,
  SlateGame,
  SundayTicketSlate,
  WindowSlate,
} from '../../src/utils/sunday-ticket-slate';
import { WINDOW_LABELS } from '../../src/utils/sunday-ticket-slate';
import type { BoardLeague } from '../../src/utils/sunday-ticket-selection';

const FACE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48Y2lyY2xlIGN4PScxMDAnIGN5PSc3Micgcj0nNDInIGZpbGw9JyNjZmQ0ZGEnLz48cGF0aCBkPSdNMjAgMjAwYzAtNDYgMzYtNzQgODAtNzRzODAgMjggODAgNzR6JyBmaWxsPScjY2ZkNGRhJy8+PC9zdmc+';

const utc = (d: number, h: number, min = 0) => Math.floor(Date.UTC(2026, 8, d, h, min) / 1000);
export const KICK = {
  tnf: utc(18, 0, 15),      // Thu 8:15 PM ET
  early: utc(20, 17, 0),    // Sun 1:00 PM ET
  late: utc(20, 20, 25),    // Sun 4:25 PM ET
  snf: utc(21, 0, 20),      // Sun 8:20 PM ET
};

const game = (away: string, home: string, kickoff: number, broadcast?: string): SlateGame =>
  broadcast ? { id: `${away}@${home}`, kickoff, away, home, broadcast } : { id: `${away}@${home}`, kickoff, away, home };

const player = (name: string, position: string, nflTeam: string, proj: number, headshot = FACE) => ({
  playerId: name.replace(/\W/g, '').toLowerCase(),
  name, position, nflTeam, proj, headshot,
});

/** The two leagues this site runs plus one outside league, as the board sees them. */
export const leagues: BoardLeague[] = [
  { id: '13522', name: 'The League', franchiseId: '0001', franchiseName: 'Pacific Pigskins', registered: {} as any, host: null, isSession: true },
  { id: '19621', name: 'AFL', franchiseId: '0012', franchiseName: 'The Boondock Saints', registered: {} as any, host: null, isSession: false },
  { id: '55555', name: 'Dynasty Bros', franchiseId: '0004', franchiseName: 'Cowboy Up', registered: null, host: 'https://www45.myfantasyleague.com', isSession: false },
];

const group = (
  league: BoardLeague,
  players: ReturnType<typeof player>[],
  lineupResolved = true,
) => ({
  leagueId: league.id,
  leagueName: league.name,
  franchiseName: league.franchiseName,
  lineupResolved,
  players: [...players].sort((a, b) => b.proj - a.proj),
  projTotal: Math.round(players.reduce((s, p) => s + p.proj, 0) * 10) / 10,
});

const box = (g: SlateGame, groups: ReturnType<typeof group>[]): GameBox => ({
  kind: 'game',
  game: g,
  // Only a resolved lineup (or a best-ball roster) counts as starters; a
  // roster standing in for an unreadable lineup is listed but never ranks.
  starterCount: groups.filter((x) => x.lineupResolved).reduce((n, x) => n + x.players.length, 0),
  rosterCount: groups.filter((x) => !x.lineupResolved).reduce((n, x) => n + x.players.length, 0),
  projTotal: Math.round(groups.reduce((s, x) => s + x.projTotal, 0) * 10) / 10,
  starterProjTotal: Math.round(groups.filter((x) => x.lineupResolved).reduce((s, x) => s + x.projTotal, 0) * 10) / 10,
  byLeague: groups,
});

const [TL, AFL, OUT] = leagues;

const bufHou = box(game('BUF', 'HOU', KICK.early, 'CBS'), [
  group(TL, [player('Josh Allen', 'QB', 'BUF', 24.8), player('James Cook', 'RB', 'BUF', 15.2)]),
  group(AFL, [player('Josh Allen', 'QB', 'BUF', 22.1)]),
]);
const balInd = box(game('BAL', 'IND', KICK.early, 'CBS'), [
  group(TL, [player('Lamar Jackson', 'QB', 'BAL', 26.8)]),
  group(OUT, [player('Zay Flowers', 'WR', 'BAL', 13.4)]),
]);
const chiCar = box(game('CHI', 'CAR', KICK.early, 'FOX'), [
  group(TL, [player('Colston Loveland', 'TE', 'CHI', 11.4)]),
]);
const atlPit = box(game('ATL', 'PIT', KICK.early, 'FOX'), [
  group(AFL, [player('Bijan Robinson', 'RB', 'ATL', 19.6)]),
]);
const cleJax = box(game('CLE', 'JAX', KICK.early, 'CBS'), [
  group(OUT, [player('Brian Thomas Jr.', 'WR', 'JAX', 12.0)]),
]);
const miaLv = box(game('MIA', 'LV', KICK.late, 'FOX'), [
  group(TL, [player('Las Vegas Raiders', 'DEF', 'LV', 6.9, '')], false),
]);

const early = (boxes: WindowSlate['boxes'], overflow: GameBox[] = [], scheduled = 8): WindowSlate => ({
  window: 'early', label: WINDOW_LABELS.early, kickoff: KICK.early, scheduled, boxes, overflow,
});
const late = (boxes: WindowSlate['boxes'], scheduled = 4): WindowSlate => ({
  window: 'late', label: WINDOW_LABELS.late, kickoff: KICK.late, scheduled, boxes, overflow: [],
});

/** Three leagues, both windows, four full boxes early and one game + RedZone late. */
export const multiLeague: SundayTicketSlate = {
  windows: [early([bufHou, balInd, chiCar, atlPit], [cleJax]), late([miaLv, { kind: 'redzone' }])],
  other: [
    box(game('SF', 'LAR', KICK.tnf, 'Prime Video'), [group(TL, [player('Puka Nacua', 'WR', 'LAR', 16.3)])]),
    box(game('KC', 'DAL', KICK.snf, 'NBC'), [group(AFL, [player('CeeDee Lamb', 'WR', 'DAL', 17.0)])]),
  ],
  personalized: true,
  boxesPerWindow: 4,
};

/** One league only: no league line inside the boxes. */
export const singleLeague: SundayTicketSlate = {
  windows: [early([chiCar, miaLv, { kind: 'redzone' }], [], 8)],
  other: [],
  personalized: true,
  boxesPerWindow: 4,
};

/** Nothing of yours on Sunday: RedZone alone in both windows. */
export const nothingRelevant: SundayTicketSlate = {
  windows: [early([{ kind: 'redzone' }]), late([{ kind: 'redzone' }])],
  other: [],
  personalized: true,
  boxesPerWindow: 4,
};

/** Signed out: league-wide, ranked by points, long player lists capped by the box. */
export const leagueWide: SundayTicketSlate = {
  windows: [
    early([
      box(game('BUF', 'HOU', KICK.early, 'CBS'), [
        group(
          { ...TL, franchiseName: 'League-wide' },
          [
            player('Josh Allen', 'QB', 'BUF', 24.8), player('James Cook', 'RB', 'BUF', 15.2),
            player('Nico Collins', 'WR', 'HOU', 14.9), player('Joe Mixon', 'RB', 'HOU', 13.1),
            player('Khalil Shakir', 'WR', 'BUF', 9.8), player('Dalton Kincaid', 'TE', 'BUF', 8.7),
            player('Tank Dell', 'WR', 'HOU', 8.1),
          ],
          false,
        ),
      ]),
      { kind: 'redzone' },
    ]),
  ],
  other: [],
  personalized: false,
  boxesPerWindow: 4,
};

/** The week has no schedule yet. */
export const noGames: SundayTicketSlate = { windows: [], other: [], personalized: true, boxesPerWindow: 4 };

export type { LeagueContribution };
