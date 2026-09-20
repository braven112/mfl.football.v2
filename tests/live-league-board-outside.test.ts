/**
 * `/live/league/<mflLeagueId>` — one league's FULL board, for a league this
 * site does not run.
 *
 * The drill-down from MFL Live. Four rules are pinned here, and every one of
 * them is a way this feature goes wrong quietly rather than loudly:
 *
 *  - **The board builder must serve an OUTSIDE league.** It used to take a
 *    registry slug and answer `unavailable` for anything else. A second
 *    builder for the outside case would have to re-derive the bench split, the
 *    four statuses and the per-theme colour grounds — which is how this repo
 *    got 24 forked routes.
 *  - **A matchup the viewer is not in carries NO viewer.** Most of a league
 *    board's cards are nobody's, and `viewerSide` is what stops every one of
 *    them claiming to be yours.
 *  - **Bench rows never reach a leaderboard.** Same rule that keeps them out
 *    of a projection, one level up where it is harder to spot.
 *  - **Zero is never a leader.** An unplayed week is a payload of zeros, and a
 *    strip that does not filter invents a leaderboard for a week nobody has
 *    played.
 */
import { describe, it, expect } from 'vitest';

import { buildBoardFromSnapshot } from '../src/utils/live/read';
import { buildLeaders } from '../src/utils/live/leaders';
import { getLeagueBySlug } from '../src/config/leagues';
import type { LivePanel } from '../src/types/live';

const WEEK = 3;
const YEAR = 2026;

const row = (id: string, live = 0, secondsRemaining = 0) => ({
  id,
  live,
  secondsRemaining,
  status: 'starter',
});

const snapshot = (over: Partial<Record<string, unknown>> = {}) => ({
  matchups: [
    { home: '0001', away: '0002' },
    { home: '0003', away: '0004' },
  ],
  scores: { '0001': 100, '0002': 90, '0003': 70, '0004': 120 },
  remaining: { '0001': 0, '0002': 0, '0003': 0, '0004': 0 },
  players: {
    '0001': [row('p1', 60), row('p2', 40)],
    '0002': [row('p3', 90)],
    '0003': [row('p4', 70)],
    '0004': [row('p5', 120)],
  },
  bench: {},
  playersYetToPlay: {},
  ...over,
});

const build = (over: Record<string, unknown> = {}) =>
  buildBoardFromSnapshot({
    league: { id: '99999', name: 'Some Other League', slug: null },
    week: WEEK,
    year: YEAR,
    ok: true,
    snapshot: snapshot() as never,
    projections: new Map(),
    surface: 'mfl',
    ...over,
  });

describe('an OUTSIDE league gets a real board', () => {
  it('builds every matchup for a league with no registry slug', () => {
    const panel = build().panels[0];
    expect(panel.status).toBe('ok');
    expect(panel.matchups).toHaveLength(2);
    expect(panel.leagueId).toBe('99999');
    expect(panel.leagueName).toBe('Some Other League');
  });

  it('says it is NOT one of ours, so the UI can tag it honestly', () => {
    const panel = build().panels[0];
    expect(panel.slug).toBeNull();
    expect(panel.registered).toBe(false);
  });

  it('a registered league still reports itself registered', () => {
    const league = getLeagueBySlug('theleague')!;
    const panel = build({
      league: { id: league.id, name: league.name, slug: 'theleague' },
    }).panels[0];
    expect(panel.slug).toBe('theleague');
    expect(panel.registered).toBe(true);
  });

  it('names franchises from the fetched names when there are no brands', () => {
    // Without these the board reads "Franchise 0015" against "Franchise 0032",
    // and their NFL crests never resolve because the matcher has no name.
    const panel = build({
      franchiseNames: { '0001': 'Brooklyn Bandits', '0002': 'Tulsa Twisters' },
    }).panels[0];
    const names = panel.matchups[0].sides.map((s) => s.name);
    expect(names).toContain('Brooklyn Bandits');
    expect(names).toContain('Tulsa Twisters');
  });

  it('lets the REGISTRY win over a fetched name for a league we run', () => {
    // A real identity outranks an inferred one: the brands carry colours and a
    // crest that a name cannot.
    const league = getLeagueBySlug('theleague')!;
    const panel = build({
      league: { id: league.id, name: league.name, slug: 'theleague' },
      franchiseNames: { '0001': 'NOT THE REAL NAME' },
    }).panels[0];
    const side = panel.matchups[0].sides.find((s) => s.franchiseId === '0001');
    expect(side?.name).not.toBe('NOT THE REAL NAME');
  });
});

describe('a viewer owns at most one side of at most some cards', () => {
  it('leaves every matchup viewer-less when the viewer is in none of them', () => {
    const panel = build().panels[0];
    for (const m of panel.matchups) expect(m.viewerSide).toBeNull();
  });

  it('marks only the viewer’s own matchup', () => {
    const panel = build({ viewerFranchiseId: '0003' }).panels[0];
    const mine = panel.matchups.filter((m) => m.viewerSide !== null);
    expect(mine).toHaveLength(1);
    expect(mine[0].sides[mine[0].viewerSide!].franchiseId).toBe('0003');
  });
});

describe('the top-scorers strips', () => {
  const panelOf = (over: Record<string, unknown> = {}): LivePanel =>
    build(over).panels[0];

  it('ranks teams by live score, highest first', () => {
    const { teams } = buildLeaders(panelOf());
    expect(teams.map((t) => t.franchiseId)).toEqual(['0004', '0001', '0002', '0003']);
    expect(teams[0].live).toBe(120);
  });

  it('ranks individual performances across the whole league', () => {
    const { players } = buildLeaders(panelOf());
    expect(players[0]).toMatchObject({ playerId: 'p5', franchiseId: '0004', points: 120 });
    expect(players.map((p) => p.playerId)).toEqual(['p5', 'p3', 'p4', 'p1', 'p2']);
  });

  it('NEVER counts a bench row', () => {
    // A bench row on a leaderboard credits an owner points that cannot be
    // scored — the same defect that inflates a projection, moved somewhere it
    // is harder to spot.
    const withBench = panelOf({
      snapshot: snapshot({ bench: { '0003': [row('benchGuy', 999)] } }) as never,
    });
    const { players, teams } = buildLeaders(withBench);
    expect(players.map((p) => p.playerId)).not.toContain('benchGuy');
    expect(teams.find((t) => t.franchiseId === '0003')?.live).toBe(70);
  });

  it('renders NOTHING for a week nobody has played, rather than rows of zeros', () => {
    const unplayed = panelOf({
      snapshot: snapshot({
        scores: { '0001': 0, '0002': 0, '0003': 0, '0004': 0 },
        players: {
          '0001': [row('p1', 0)],
          '0002': [row('p3', 0)],
          '0003': [row('p4', 0)],
          '0004': [row('p5', 0)],
        },
      }) as never,
    });
    const leaders = buildLeaders(unplayed);
    expect(leaders.teams).toEqual([]);
    expect(leaders.players).toEqual([]);
  });

  it('keeps the SAME player started by two owners as two rows', () => {
    // In the AFL a player is routinely rostered in both conferences, and both
    // sides of one matchup can start him. Those are different owners' points;
    // collapsing them drops the credit from every roster but one.
    const shared = panelOf({
      snapshot: snapshot({
        players: {
          '0001': [row('star', 50)],
          '0002': [row('star', 50)],
          '0003': [row('p4', 10)],
          '0004': [row('p5', 10)],
        },
      }) as never,
    });
    const rows = buildLeaders(shared).players.filter((p) => p.playerId === 'star');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.franchiseId))).toEqual(new Set(['0001', '0002']));
  });

  it('does not reshuffle a tie between two polls', () => {
    // This re-derives every poll. A tie broken by array order moves rows under
    // the reader's thumb on a board that did not change.
    const tied = () =>
      buildLeaders(
        panelOf({
          snapshot: snapshot({
            scores: { '0001': 50, '0002': 50, '0003': 50, '0004': 50 },
          }) as never,
        }),
      ).teams.map((t) => t.franchiseId);
    expect(tied()).toEqual(tied());
  });

  it('counts a DOUBLEHEADER franchise once, not once per matchup', () => {
    // TheLeague's own schedule runs doubleheader weeks, which put every
    // franchise in two pairings. Walking the matchups without a per-franchise
    // gate counts each roster twice — this shipped visibly on the first cut:
    // the same player at #1 and #2 of the leaderboard, same owner, same score.
    const doubleheader = panelOf({
      snapshot: snapshot({
        matchups: [
          { home: '0001', away: '0002' },
          // Both franchises again, against different opponents.
          { home: '0001', away: '0003' },
          { home: '0002', away: '0004' },
        ],
      }) as never,
    });
    const { teams, players } = buildLeaders(doubleheader);

    expect(teams.map((t) => t.franchiseId)).toEqual([...new Set(teams.map((t) => t.franchiseId))]);
    const keys = players.map((p) => `${p.franchiseId}:${p.playerId}`);
    expect(keys).toEqual([...new Set(keys)]);
    // And nothing was lost to the de-duplication: every franchise still ranks.
    expect(teams).toHaveLength(4);
    expect(players).toHaveLength(5);
  });

  it('caps each strip', () => {
    const { teams, players } = buildLeaders(panelOf(), { teamLimit: 2, playerLimit: 3 });
    expect(teams).toHaveLength(2);
    expect(players).toHaveLength(3);
  });
});
