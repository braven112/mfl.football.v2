import { describe, it, expect } from 'vitest';
import { attachGameStories, buildPost, validate, getUserPrompt, gamesMissingScore, correctionFor } from '../scripts/article-types/matchup-preview.mjs';

// Two cards in stakes order; the fact sheet numbers pairings in schedule order.
const visuals = {
  year: 2026,
  week: 11,
  gameOfWeek: 0,
  matchups: [
    { a: { franchiseId: '0003' }, b: { franchiseId: '0004' }, series: null },
    { a: { franchiseId: '0001' }, b: { franchiseId: '0002' }, series: null },
  ],
};
// MATCHUP 1 = 0001 v 0002, MATCHUP 2 = 0004 v 0003.
const pairKeys = ['0001-0002', '0003-0004'];

describe('attachGameStories', () => {
  it('puts each write-up on the card for its MATCHUP number, as plain text', () => {
    const out = attachGameStories(
      visuals,
      [
        { matchup: 2, paragraphs: ['<p>The big one. <a href="/x">Read</a> it.</p>', 'Pick: 0003.'] },
        { matchup: 1, paragraphs: ['Quick hitter.'] },
      ],
      pairKeys,
      { closing: ['Watch <b>BUF</b> at KC.'] },
    );
    expect(out.matchups[0].story).toEqual(['The big one. Read it.', 'Pick: 0003.']);
    expect(out.matchups[1].story).toEqual(['Quick hitter.']);
    expect(out.closing).toEqual(['Watch BUF at KC.']);
    // The snapshot passed in is not mutated.
    expect(visuals.matchups[0]).not.toHaveProperty('story');
  });

  it('drops a number with no card and empty write-ups', () => {
    const out = attachGameStories(visuals, [{ matchup: 9, paragraphs: ['Nope.'] }, { matchup: 1, paragraphs: [''] }], pairKeys);
    expect(out.matchups.every((m: { story?: string[] }) => !m.story)).toBe(true);
    expect(out).not.toHaveProperty('closing');
  });
});

describe('matchup preview post', () => {
  it('carries the stories on matchupVisuals and keeps the opener short', () => {
    const post = buildPost(
      {
        headline: 'H',
        excerpt: 'E',
        content: ['<p>Opener.</p>'],
        games: [{ matchup: 1, paragraphs: ['Quick hitter.'] }],
        closing: ['Watch this.'],
      },
      { visuals, pairKeys },
      'sf_2026_matchup_preview_w11',
      { league: 'theleague' },
    );
    expect(post.content).toEqual(['<p>Opener.</p>']);
    expect(post.matchupVisuals.matchups[1].story).toEqual(['Quick hitter.']);
    expect(post.matchupVisuals.closing).toEqual(['Watch this.']);
  });

  it('requires per-game write-ups', () => {
    expect(validate({ headline: 'H', excerpt: 'E', content: ['<p>x</p>'] })).toContain('Missing per-game write-ups');
    expect(validate({ headline: 'H', excerpt: 'E', content: ['<p>x</p>'], games: [{ matchup: 1, paragraphs: ['x', 'My pick: A, 124-117.'] }] })).toEqual([]);
  });

  // Owner's call (Nov 2026): every pick in every league carries a score. The
  // Week 10 AFL preview picked twelve winners and scored none of them.
  it('flags a pick without a predicted score, and asks for one rewrite', () => {
    const games = [
      { matchup: 1, paragraphs: ['Fullybaked own the series 21-16.', 'My pick: Drunk Indians.'] },
      { matchup: 2, paragraphs: ['My pick: Running down the Dream, 131-129, in a tight one.'] },
      { matchup: 3, paragraphs: ['My pick: Smokane FC, 118.5–112.2.'] },
    ];
    expect(gamesMissingScore({ games })).toEqual([1]);
    expect(validate({ headline: 'H', excerpt: 'E', content: ['<p>x</p>'], games })).toContain('No predicted score for matchup 1');
    expect(correctionFor({ games })).toMatch(/MATCHUP 1 has no predicted score/);
    expect(correctionFor({ games: games.slice(1) })).toBeNull();
    expect(getUserPrompt('FACTS')).toMatch(/EVERY pick carries a predicted final score/);
  });

  it('asks for a long featured game and quick hitters for the rest', () => {
    const prompt = getUserPrompt('FACTS');
    expect(prompt).toMatch(/FEATURED GAME gets the long write-up: about 10 sentences/);
    expect(prompt).toMatch(/quick hitter: 2-5 sentences/);
  });
});

describe('key NFL game', () => {
  it('picks the NFL game with the most projected points across both lineups', async () => {
    const { keyNflGame, nflWeekGames } = await import('../src/utils/nfl-week-games.mjs');
    const games = nflWeekGames([
      { kickoff: '100', team: [{ id: 'BUF', isHome: '0' }, { id: 'KCC', isHome: '1' }] },
      { kickoff: '50', team: [{ id: 'DAL', isHome: '0' }, { id: 'PHI', isHome: '1' }] },
    ]);
    const game = keyNflGame(games, [
      { franchiseId: '0001', players: [{ name: 'Allen', position: 'QB', nflTeam: 'BUF', proj: 22 }, { name: 'Lamb', position: 'WR', nflTeam: 'DAL', proj: 15 }] },
      { franchiseId: '0002', players: [{ name: 'Kelce', position: 'TE', nflTeam: 'KCC', proj: 9 }, { name: 'Hurts', position: 'QB', nflTeam: 'PHI', proj: 10 }] },
    ]);
    expect(game).toMatchObject({ away: 'BUF', home: 'KCC', projTotal: 31 });
    expect(game?.players.map((p: { name: string }) => p.name)).toEqual(['Allen', 'Kelce']);
    expect(keyNflGame(games, [{ franchiseId: '0001', players: [] }])).toBeNull();
  });

  it('uses a submitted lineup, else the nine best projected', async () => {
    const { startersResolver, keyGameFact } = await import('../scripts/article-types/matchup-preview.mjs');
    const players = new Map(Array.from({ length: 12 }, (_, i) => [`p${i}`, { name: `P${i}`, position: 'WR', team: 'BUF' }]));
    const projections = new Map(Array.from({ length: 12 }, (_, i) => [`p${i}`, i]));
    const rosterMap = { '0001': [...players.keys()], '0002': [...players.keys()] };
    const raw = [{ weeklyResults: { week: '11', matchup: [{ franchise: [
      { id: '0001', player: [{ id: 'p0', status: 'starter' }, { id: 'p1', status: 'nonstarter' }] },
      { id: '0002' },
    ] }] } }];
    const startersOf = startersResolver(raw, 11, rosterMap, projections, players);
    expect(startersOf('0001').map((p: { name: string }) => p.name)).toEqual(['P0']);
    expect(startersOf('0002')).toHaveLength(9);
    expect(startersOf('0002')[0].name).toBe('P11');
    const line = keyGameFact({ away: 'BUF', home: 'KCC', kickoff: 0, projTotal: 31, players: [{ franchiseId: '0001', name: 'Allen', position: 'QB', nflTeam: 'BUF', proj: 22 }] }, (id: string) => `Team ${id}`);
    // MFL's KCC prints as KC, the code the card shows (a raw NOS once put "CAR at NOS" in the copy).
    expect(line).toBe('KEY NFL GAME: BUF at KC, 31.0 projected points from these two teams\' starters — QB Allen (Team 0001, 22.0).');
  });
});
