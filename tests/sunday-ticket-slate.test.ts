import { describe, it, expect } from 'vitest';
import {
  buildSlateGames,
  buildSundayTicketSlate,
  classifyKickoff,
  formatKickoffZones,
  selectWeekMatchups,
  type GameBox,
  type LeagueContribution,
  type SlateGame,
} from '../src/utils/sunday-ticket-slate';

/**
 * Kickoffs as epoch SECONDS for Week 2 of the 2026 season (EDT, UTC-4), so
 * every window has a real calendar anchor rather than an offset from "now".
 * The suite pins TZ to Pacific; the slate classifies in Eastern explicitly,
 * so these hold on any runner.
 */
const utc = (y: number, m: number, d: number, h: number, min = 0) => Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);
const KICK = {
  tnf: utc(2026, 9, 18, 0, 15),        // Thu Sep 17 8:15 PM ET
  london: utc(2026, 9, 20, 13, 30),    // Sun 9:30 AM ET
  early: utc(2026, 9, 20, 17, 0),      // Sun 1:00 PM ET
  late405: utc(2026, 9, 20, 20, 5),    // Sun 4:05 PM ET
  late425: utc(2026, 9, 20, 20, 25),   // Sun 4:25 PM ET
  snf: utc(2026, 9, 21, 0, 20),        // Sun 8:20 PM ET
  mnf: utc(2026, 9, 22, 0, 15),        // Mon 8:15 PM ET
};

const game = (away: string, home: string, kickoff: number, broadcast?: string): SlateGame =>
  broadcast ? { id: `${away}@${home}`, kickoff, away, home, broadcast } : { id: `${away}@${home}`, kickoff, away, home };

const player = (playerId: string, nflTeam: string, proj: number, name = `P${playerId}`) => ({
  playerId, name, position: 'WR', nflTeam, proj,
});

const league = (leagueId: string, players: ReturnType<typeof player>[], extra: Partial<LeagueContribution> = {}): LeagueContribution => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  franchiseId: '0001',
  franchiseName: 'Pacific Pigskins',
  lineupResolved: true,
  players,
  ...extra,
});

const gameBoxes = (boxes: Array<GameBox | { kind: 'redzone' }>) =>
  boxes.filter((b): b is GameBox => b.kind === 'game').map((b) => b.game.id);

describe('classifyKickoff — only Sunday afternoon is Sunday Ticket', () => {
  it('puts the 1pm block early and the 4pm block late', () => {
    expect(classifyKickoff(KICK.early)).toBe('early');
    expect(classifyKickoff(KICK.late405)).toBe('late');
    expect(classifyKickoff(KICK.late425)).toBe('late');
  });

  it('sends every national-broadcast slot to other', () => {
    expect(classifyKickoff(KICK.tnf)).toBe('other');
    expect(classifyKickoff(KICK.london)).toBe('other');
    expect(classifyKickoff(KICK.snf)).toBe('other');
    expect(classifyKickoff(KICK.mnf)).toBe('other');
  });
});

describe('buildSlateGames — MFL schedule in, canonical games out', () => {
  it('normalizes MFL codes, keys by away@home and merges the ESPN network', () => {
    const matchups = [
      { kickoff: String(KICK.early), team: [{ id: 'GBP', isHome: '0' }, { id: 'WAS', isHome: '1' }] },
    ];
    const games = buildSlateGames(matchups, [{ away: 'GB', home: 'WSH', broadcast: 'FOX' }]);
    expect(games).toEqual([{ id: 'GB@WSH', kickoff: KICK.early, away: 'GB', home: 'WSH', broadcast: 'FOX' }]);
  });

  it('accepts MFL\'s one-matchup collapse to a bare object and drops kickoff-less rows', () => {
    const single = { kickoff: String(KICK.late425), team: [{ id: 'KCC', isHome: '0' }, { id: 'LAR', isHome: '1' }] };
    expect(buildSlateGames(single).map((g) => g.id)).toEqual(['KC@LAR']);
    expect(buildSlateGames([{ kickoff: '', team: [{ id: 'KCC', isHome: '0' }, { id: 'LAR', isHome: '1' }] }])).toEqual([]);
  });

  it('sorts by kickoff, then id', () => {
    const games = buildSlateGames([
      { kickoff: String(KICK.late425), team: [{ id: 'SEA', isHome: '0' }, { id: 'SFO', isHome: '1' }] },
      { kickoff: String(KICK.early), team: [{ id: 'NYJ', isHome: '0' }, { id: 'BUF', isHome: '1' }] },
      { kickoff: String(KICK.early), team: [{ id: 'CHI', isHome: '0' }, { id: 'DET', isHome: '1' }] },
    ]);
    expect(games.map((g) => g.id)).toEqual(['CHI@DET', 'NYJ@BUF', 'SEA@SF']);
  });
});

describe('selectWeekMatchups — the feed has two shapes', () => {
  const m = (away: string) => ({ kickoff: '1', team: [{ id: away, isHome: '0' }, { id: 'DAL', isHome: '1' }] });

  it('indexes the season archive by week', () => {
    const feed = { fullNflSchedule: { nflSchedule: [{ matchup: [m('NYG')] }, { matchup: m('PHI') }] } };
    expect(selectWeekMatchups(feed, 1)).toEqual([m('NYG')]);
    expect(selectWeekMatchups(feed, 2)).toEqual([m('PHI')]);
    expect(selectWeekMatchups(feed, 3)).toEqual([]);
  });

  it('reads the live shape, but not for a week it says it is not', () => {
    const live = { nflSchedule: { week: '2', matchup: [m('PHI')] } };
    expect(selectWeekMatchups(live, 2)).toEqual([m('PHI')]);
    expect(selectWeekMatchups(live, 3)).toEqual([]);
    expect(selectWeekMatchups({ nflSchedule: { matchup: m('PHI') } }, 7)).toEqual([m('PHI')]);
  });

  it('unwraps a dynamic-import default', () => {
    expect(selectWeekMatchups({ default: { nflSchedule: { matchup: [m('PHI')] } } }, 1)).toEqual([m('PHI')]);
  });
});

describe('buildSundayTicketSlate — the box rule', () => {
  const earlyGames = [
    game('NYJ@BUF'.split('@')[0], 'BUF', KICK.early),
    game('CHI', 'DET', KICK.early),
    game('GB', 'WSH', KICK.early),
    game('MIA', 'NE', KICK.early),
    game('CLE', 'BAL', KICK.early),
  ];

  it('fills exactly four boxes and no RedZone when five games are relevant', () => {
    const mine = league('A', ['BUF', 'DET', 'WSH', 'NE', 'BAL'].map((t, i) => player(String(i), t, 10)));
    const slate = buildSundayTicketSlate({ games: earlyGames, contributions: [mine], personalized: true });
    expect(slate.windows).toHaveLength(1);
    const [early] = slate.windows;
    expect(early.boxes).toHaveLength(4);
    expect(early.boxes.every((b) => b.kind === 'game')).toBe(true);
    expect(early.overflow).toHaveLength(1);
    expect(early.scheduled).toBe(5);
  });

  it('adds one RedZone box whenever fewer than four of your games are on', () => {
    for (const n of [3, 2, 1]) {
      const mine = league('A', ['BUF', 'DET', 'WSH'].slice(0, n).map((t, i) => player(String(i), t, 10)));
      const slate = buildSundayTicketSlate({ games: earlyGames, contributions: [mine], personalized: true });
      const boxes = slate.windows[0].boxes;
      expect(boxes).toHaveLength(n + 1);
      expect(boxes.filter((b) => b.kind === 'redzone')).toHaveLength(1);
      expect(boxes[boxes.length - 1].kind).toBe('redzone');
    }
  });

  it('never seats a game with none of your players — RedZone alone when nothing is relevant', () => {
    const mine = league('A', [player('1', 'DAL', 30)]);
    const slate = buildSundayTicketSlate({ games: earlyGames, contributions: [mine], personalized: true });
    expect(slate.windows[0].boxes).toEqual([{ kind: 'redzone' }]);
    expect(slate.windows[0].scheduled).toBe(5);
  });

  it('omits a window with nothing scheduled and lists national games under other', () => {
    const games = [game('MIA', 'NE', KICK.early), game('KC', 'LAR', KICK.snf), game('SEA', 'SF', KICK.tnf)];
    const mine = league('A', [player('1', 'NE', 10), player('2', 'KC', 25), player('3', 'SF', 12)]);
    const slate = buildSundayTicketSlate({ games, contributions: [mine], personalized: true });
    expect(slate.windows.map((w) => w.window)).toEqual(['early']);
    expect(slate.other.map((b) => b.game.id)).toEqual(['SEA@SF', 'KC@LAR']); // chronological, not by points
  });
});

describe('buildSundayTicketSlate — ranking across leagues', () => {
  const games = [game('NYJ', 'BUF', KICK.early), game('CHI', 'DET', KICK.early), game('GB', 'WSH', KICK.early)];

  it('ranks by starter count summed across leagues, then by summed projection', () => {
    const a = league('A', [player('1', 'BUF', 8), player('2', 'DET', 30)]);
    const b = league('B', [player('1', 'BUF', 6), player('3', 'WSH', 9)]);
    const slate = buildSundayTicketSlate({ games, contributions: [a, b], personalized: true });
    // BUF: 2 starters (one player, two leagues) → first even though DET has the biggest single projection.
    expect(gameBoxes(slate.windows[0].boxes)).toEqual(['NYJ@BUF', 'CHI@DET', 'GB@WSH']);
    const buf = slate.windows[0].boxes[0] as GameBox;
    expect(buf.starterCount).toBe(2);
    expect(buf.projTotal).toBe(14);
    expect(buf.byLeague.map((g) => g.leagueId)).toEqual(['A', 'B']);
  });

  it('honors the league toggles — a disabled league contributes nothing', () => {
    const a = league('A', [player('1', 'BUF', 8)]);
    const b = league('B', [player('3', 'WSH', 40), player('4', 'WSH', 40)]);
    const slate = buildSundayTicketSlate({ games, contributions: [a, b], personalized: true, enabledLeagueIds: ['A'] });
    expect(gameBoxes(slate.windows[0].boxes)).toEqual(['NYJ@BUF']);
    expect((slate.windows[0].boxes[0] as GameBox).byLeague.map((g) => g.leagueId)).toEqual(['A']);
  });

  it('breaks a tie on projection, then on kickoff, then on id', () => {
    const a = league('A', [player('1', 'BUF', 8), player('2', 'DET', 9), player('3', 'WSH', 8)]);
    const slate = buildSundayTicketSlate({ games, contributions: [a], personalized: true });
    expect(gameBoxes(slate.windows[0].boxes)).toEqual(['CHI@DET', 'GB@WSH', 'NYJ@BUF']);
  });

  it('ranks the league-wide fallback by points, not by player count', () => {
    const everyone = league('A', [
      player('1', 'BUF', 3), player('2', 'BUF', 3), player('3', 'BUF', 3),
      player('4', 'DET', 25),
    ], { lineupResolved: false });
    const slate = buildSundayTicketSlate({ games, contributions: [everyone], personalized: false });
    expect(slate.personalized).toBe(false);
    expect(gameBoxes(slate.windows[0].boxes)).toEqual(['CHI@DET', 'NYJ@BUF']);
  });

  it('a roster standing in for an unreadable lineup is shown but never outranks real starters', () => {
    const known = league('A', [player('1', 'BUF', 8)]);
    const unread = league('B', [player('2', 'DET', 30), player('3', 'DET', 20), player('4', 'DET', 10)], { lineupResolved: false });
    const slate = buildSundayTicketSlate({ games, contributions: [known, unread], personalized: true });
    expect(gameBoxes(slate.windows[0].boxes)).toEqual(['NYJ@BUF', 'CHI@DET']);
    const det = slate.windows[0].boxes[1] as GameBox;
    expect(det.starterCount).toBe(0);
    expect(det.rosterCount).toBe(3);
  });

  it('nor does it steer the tiebreak between equal starter counts', () => {
    const known = league('A', [player('1', 'BUF', 12), player('2', 'DET', 10)]);          // one starter in each game
    const unread = league('B', [player('3', 'DET', 30), player('4', 'DET', 28)], { lineupResolved: false }); // big roster projections on DET
    const slate = buildSundayTicketSlate({ games, contributions: [known, unread], personalized: true });
    expect(gameBoxes(slate.windows[0].boxes).slice(0, 2)).toEqual(['NYJ@BUF', 'CHI@DET']); // BUF's 12 beats DET's 10; the 58 never counts
  });

  it('matches players on MFL codes and games on ESPN codes', () => {
    const a = league('A', [player('1', 'GBP', 10), player('2', 'WAS', 10)]);
    const slate = buildSundayTicketSlate({ games, contributions: [a], personalized: true });
    const box = slate.windows[0].boxes[0] as GameBox;
    expect(box.game.id).toBe('GB@WSH');
    expect(box.starterCount).toBe(2);
  });

  it('sorts each league group by projection and carries lineupResolved through', () => {
    const a = league('A', [player('1', 'BUF', 4, 'Low'), player('2', 'BUF', 12, 'High')], { lineupResolved: false });
    const slate = buildSundayTicketSlate({ games, contributions: [a], personalized: true });
    const group = (slate.windows[0].boxes[0] as GameBox).byLeague[0];
    expect(group.players.map((p) => p.name)).toEqual(['High', 'Low']);
    expect(group.lineupResolved).toBe(false);
    expect(group.projTotal).toBe(16);
  });
});

describe('formatKickoffZones — the viewer\'s own clocks', () => {
  const sunSep20_1pmET = Math.floor(Date.UTC(2026, 8, 20, 17) / 1000);
  const sunOct18_1pmET = Math.floor(Date.UTC(2026, 9, 18, 17) / 1000);

  it('keeps the fixed ET/PT labels and the game day at home', () => {
    expect(formatKickoffZones(sunSep20_1pmET, [{ zone: 'America/New_York', label: 'ET' }, { zone: 'America/Los_Angeles', label: 'PT' }])).toEqual([
      { label: 'ET', time: '1:00 PM', day: 'Sun', dayDiffers: false },
      { label: 'PT', time: '10:00 AM', day: 'Sun', dayDiffers: false },
    ]);
  });

  it('is Monday morning in Australia, with the DST flip in the label', () => {
    const au = [{ zone: 'Australia/Sydney', label: 'auto', locale: 'en-AU' }, { zone: 'Australia/Perth', label: 'auto', locale: 'en-AU' }];
    expect(formatKickoffZones(sunSep20_1pmET, au)).toEqual([
      { label: 'AEST', time: '3:00 AM', day: 'Mon', dayDiffers: true },
      { label: 'AWST', time: '1:00 AM', day: 'Mon', dayDiffers: true },
    ]);
    expect(formatKickoffZones(sunOct18_1pmET, au)[0]).toEqual({ label: 'AEDT', time: '4:00 AM', day: 'Mon', dayDiffers: true });
  });

  it('records each window\'s earliest kickoff on the slate', () => {
    const g = (id: string, kickoff: number) => ({ id, kickoff, away: id.split('@')[0], home: id.split('@')[1] });
    const slate = buildSundayTicketSlate({
      games: [g('KC@LAR', sunSep20_1pmET + 3 * 3600 + 20 * 60), g('SEA@SF', sunSep20_1pmET + 3 * 3600 + 5 * 60), g('NYJ@BUF', sunSep20_1pmET)],
      contributions: [], personalized: false,
    });
    expect(slate.windows.map((w) => [w.window, w.kickoff])).toEqual([['early', sunSep20_1pmET], ['late', sunSep20_1pmET + 3 * 3600 + 5 * 60]]);
  });
});
