import { describe, expect, it } from 'vitest';
import {
  arrangeStories,
  buildRivalryStory,
  buildScoreStrip,
  buildTransactionStory,
  buildWire,
  opponentsInWeek,
  podium,
  rivalryFacts,
  stripWeek,
  topScorer,
  type FrontStory,
  type ParsedWeek,
  teamsMentioned,
} from '../src/utils/front-page';
import { getLeagueBySlug, leagueHomeStyle } from '../src/config/leagues';
import type { SchefterPost } from '../src/types/schefter';

const game = (a: string, b: string, sa: number | null = null, sb: number | null = null) => ({
  franchises: [
    { id: a, score: sa },
    { id: b, score: sb },
  ],
});

const weeks: ParsedWeek[] = [
  { week: 1, matchups: [game('01', '02', 100, 90), game('03', '04', 80, 120), game('05', '06', 70, 71)] },
  { week: 2, matchups: [game('01', '03'), game('02', '05'), game('04', '06'), game('01', '04')] },
];
const division: Record<string, string> = { '01': 'A', '02': 'A', '03': 'B', '04': 'B', '05': 'C', '06': 'C' };
const wins: Record<string, number> = { '01': 1, '02': 0, '03': 0, '04': 1, '05': 0, '06': 1 };

describe('score strip', () => {
  it("shows this week's pairings, not last week's results", () => {
    expect(stripWeek(weeks)).toMatchObject({ state: 'upcoming', week: { week: 2 } });
  });

  it('falls back to the last week once every game is scored', () => {
    expect(stripWeek(weeks.slice(0, 1))).toMatchObject({ state: 'final', week: { week: 1 } });
  });

  it("shows a signed-in owner their division's games, their own first", () => {
    const strip = buildScoreStrip({ weeks, mine: '02', divisionOf: (id) => division[id], winsOf: (id) => wins[id] });
    expect(strip?.scope).toBe('division');
    // Division A is 01 and 02: every game touching either, 02's own leading.
    expect(strip?.games.map((g) => g.sides.map((s) => s.franchiseId).join('-'))).toEqual(['02-05', '01-03', '01-04']);
    expect(strip?.games[0].mine).toBe(true);
    expect(strip?.hidden).toBe(1);
  });

  it('shows a stranger the games between the best records', () => {
    const strip = buildScoreStrip({ weeks, mine: null, divisionOf: (id) => division[id], winsOf: (id) => wins[id], limit: 2 });
    expect(strip?.scope).toBe('league');
    expect(strip?.games.map((g) => g.sides.map((s) => s.franchiseId).join('-'))).toEqual(['04-06', '01-04']);
  });
});

describe('rivalry story', () => {
  const mine = { franchiseId: '01', name: 'Rhinos' };
  const opp = { franchiseId: '04', name: 'Killers' };

  it('counts the series and the current run from the viewer side, in date order', () => {
    const f = rivalryFacts([
      { year: 2023, week: 2, score: 90, opponentScore: 100 },
      { year: 2021, week: 1, score: 100, opponentScore: 90 },
      { year: 2024, week: 5, score: 80, opponentScore: 81 },
    ]);
    expect(f).toMatchObject({ meetings: 3, wins: 1, losses: 2, streak: { result: 'L', length: 2 } });
    expect(f.last).toMatchObject({ year: 2024, week: 5 });
  });

  it('leads with a losing run when there is one', () => {
    const story = buildRivalryStory({
      mine,
      opponent: opp,
      week: 5,
      meetings: [
        { year: 2021, week: 1, score: 100, opponentScore: 90 },
        { year: 2022, week: 3, score: 90, opponentScore: 100 },
        { year: 2024, week: 5, score: 99.14, opponentScore: 101.39 },
      ],
    });
    expect(story.headline).toBe('Killers have won the last 2 against Rhinos');
    expect(story.dek).toBe('1–2 all-time in 3 meetings. Last time, 2024 week 5, Killers won 101.39–99.14.');
    expect(story).toMatchObject({ kind: 'rivalry', pinned: true, franchiseIds: ['01', '04'] });
  });

  it('still writes a story for teams that have never met', () => {
    const story = buildRivalryStory({ mine, opponent: opp, week: 5, meetings: undefined, opponentRecord: '3-1' });
    expect(story.headline).toBe('First meeting: Rhinos vs Killers');
    expect(story.dek).toContain('Killers come in at 3-1');
  });

  it('finds both opponents in a doubleheader week', () => {
    expect(opponentsInWeek(weeks[1], '01')).toEqual(['03', '04']);
    expect(opponentsInWeek(weeks[1], null)).toEqual([]);
  });
});

describe('arranging the stories', () => {
  const s = (id: string, kind: FrontStory['kind'], at?: string, pinned = false): FrontStory => ({
    id,
    kind,
    kicker: kind,
    headline: id,
    franchiseIds: [],
    at,
    pinned,
  });

  it('leads with the newest leadable story and never with a rivalry', () => {
    const out = arrangeStories([
      s('riv', 'rivalry', '2026-10-11T00:00:00Z', true),
      s('gauntlet', 'gauntlet', '2026-10-07T00:00:00Z'),
      s('recap', 'recap', '2026-10-06T00:00:00Z'),
      s('move', 'transaction', '2026-10-09T00:00:00Z'),
    ]);
    expect(out.lead?.id).toBe('gauntlet');
    // The recap is on a card, so the list does not repeat it; the rivalry
    // heads the list AND tops up the card row.
    expect(out.headlines.map((h) => h.id)).toEqual(['riv', 'move']);
    expect(out.cards.map((c) => c.id)).toEqual(['recap', 'riv']);
  });

  it('keeps every pinned rivalry even past the headline limit', () => {
    const out = arrangeStories([s('a', 'rivalry', undefined, true), s('b', 'rivalry', undefined, true), s('c', 'transaction')], {
      headlines: 1,
    });
    expect(out.headlines.map((h) => h.id)).toEqual(['a', 'b']);
  });
});

describe('the race, the wire and moves', () => {
  it("keeps MFL's standings order", () => {
    expect(podium([{ id: '9' }, { id: '1' }, { id: '5' }, { id: '2' }]).map((r) => r.id)).toEqual(['9', '1', '5']);
  });

  it("picks a roster's best scorer", () => {
    expect(topScorer(['1', '2'], [{ id: '3', score: '200' }, { id: '2', score: '90.5' }, { id: '1', score: '80' }])).toBe('2');
    expect(topScorer([], [{ id: '1', score: 1 }])).toBeNull();
  });

  it('flags NFL news about a player on the viewer roster', () => {
    const post = (id: string, type: string, players: string[] = []) =>
      ({ id, type, headline: id, body: '', timestamp: `2026-10-0${id}T00:00:00Z`, franchiseIds: [], namedPlayerIds: players }) as unknown as SchefterPost;
    const wire = buildWire([post('1', 'external', ['77']), post('2', 'article'), post('3', 'external')], new Set(['77']));
    expect(wire.map((w) => [w.id, w.onMyRoster])).toEqual([
      ['3', false],
      ['1', true],
    ]);
  });

  it('links a move to its official record', () => {
    const story = buildTransactionStory(
      { franchiseId: '01', at: '2026-10-08T00:00:00Z', added: ['9'], dropped: ['8'], kind: 'waiver' },
      () => 'Rhinos',
      (id) => (id === '9' ? 'Roman Wilson' : 'Case Keenum'),
      '/archies/transactions',
    );
    expect(story?.headline).toBe('Rhinos add Roman Wilson and drop Case Keenum');
    expect(story?.action).toEqual({ label: 'Official move', href: '/archies/transactions' });
  });
});

describe('homepage style', () => {
  it("defaults every league to the classic homepage, with Archie's on the front page", () => {
    expect(leagueHomeStyle('theleague')).toBe('classic');
    expect(leagueHomeStyle('afl-fantasy')).toBe('classic');
    expect(getLeagueBySlug('archies')?.homeStyle).toBe('front-page');
    expect(leagueHomeStyle('archies')).toBe('front-page');
  });
});

describe('teams a story names', () => {
  const teams = [
    { franchiseId: '0001', name: 'Dallas Cowboys' },
    { franchiseId: '0002', name: 'Dallas Cowboys II' },
    { franchiseId: '0003', name: 'Rams' },
  ];
  it('reads the longest name first and keeps the order of appearance', () => {
    expect(teamsMentioned('Rams climb past Dallas Cowboys II in the Gauntlet', teams)).toEqual(['0003', '0002']);
  });
  it('finds both names when one contains the other', () => {
    expect(teamsMentioned('Dallas Cowboys II host the Dallas Cowboys', teams)).toEqual(['0002', '0001']);
  });
  it('returns nothing for a story about no team', () => {
    expect(teamsMentioned('The hardest schedules left', teams)).toEqual([]);
  });
});
