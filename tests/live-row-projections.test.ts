/**
 * An in-progress player row must project a MIX of his projection and his
 * score — never one or the other.
 *
 * The model has always been right: `projectPlayerFinal` is
 * `live + projected × (secondsRemaining / 3600)`, so a starter projected for
 * 20 who has 20 at halftime is worth 10 more points and finishes at 30. What
 * was wrong was the INPUT. Both board builders set `PlayerMeta.projected` to a
 * deliberate 0 — the meta map is shared across every panel of a cross-league
 * board, and a projection belongs to a player IN A LEAGUE — and handed the
 * real per-league numbers straight to `computeTeamTotals`. The team totals and
 * the win-probability bar were therefore correct while every PLAYER row
 * multiplied a projection of 0 by the fraction of game left and printed its
 * own live score back as its projected final.
 *
 * The fix is `LivePlayerRow.projected`: a row sits inside exactly one team
 * inside exactly one panel, so it is the one per-league home a projection has.
 * These tests pin the stamping (both builders, starters AND bench), the blend
 * itself, and the row-first read in `LvPlayerRow` that consumes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const loadLiveScoringPayload = vi.fn();
vi.mock('../src/utils/live-scoring-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/live-scoring-source')>();
  return { ...actual, loadLiveScoringPayload: (...a: unknown[]) => loadLiveScoringPayload(...a) };
});

vi.mock('../src/utils/live/projections', () => ({
  loadLeagueWeekProjections: vi.fn(),
  __clearProjectionCache: () => {},
}));

const playerMapEntries = new Map<
  string,
  { name: string; position: string; nflTeam: string; headshot: string; espnId: string | null }
>();
vi.mock('../src/utils/player-map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/player-map')>();
  return { ...actual, getPlayerMap: () => playerMapEntries };
});

import { buildBoardFromSnapshot } from '../src/utils/live/read';
import { attachRowProjections, computeTeamTotals } from '../src/utils/live-scoring-view';
import { projectPlayerFinal, NFL_GAME_SECONDS } from '../src/utils/live-win-probability';
import type { LivePlayerRow } from '../src/types/live-scoring';

const WEEK = 3;
const YEAR = 2026;
const HALFTIME = NFL_GAME_SECONDS / 2;

const row = (id: string, live = 0, secondsRemaining = 0, status = 'starter'): LivePlayerRow => ({
  id,
  live,
  secondsRemaining,
  status,
});

beforeEach(() => {
  loadLiveScoringPayload.mockReset();
  playerMapEntries.clear();
  for (const id of ['p1', 'p2', 'b1']) {
    playerMapEntries.set(id, {
      name: `Name ${id}`,
      position: 'RB',
      nflTeam: 'KC',
      headshot: `${id}.png`,
      espnId: null,
    });
  }
});

describe('the blend itself', () => {
  it('projects 10 more for a 20-point projection sitting on 20 at halftime', () => {
    const p = { live: 20, projected: 20, secondsRemaining: HALFTIME };
    expect(projectPlayerFinal(p)).toBeCloseTo(30, 6);
    expect(projectPlayerFinal(p) - p.live).toBeCloseTo(10, 6);
  });

  it('is the live score with no projection — which is the bug, stated as arithmetic', () => {
    // 20 + 0 × 0.5. Nothing in the formula is wrong; the 0 is the whole fault,
    // and it is why this file pins where the number comes from rather than
    // re-testing `projectPlayerFinal`.
    expect(projectPlayerFinal({ live: 20, projected: 0, secondsRemaining: HALFTIME })).toBe(20);
  });
});

describe('attachRowProjections', () => {
  it('stamps this league’s number onto the row', () => {
    const out = attachRowProjections([row('p1', 20, HALFTIME)], new Map([['p1', 20]]));
    expect(out[0].projected).toBe(20);
    expect(projectPlayerFinal({ ...out[0], projected: out[0].projected ?? 0 })).toBeCloseTo(30, 6);
  });

  it('leaves a player the map has no number for UNTOUCHED, never stamped with 0', () => {
    // "We have no projection for him" and "we project him for nothing" are
    // different claims, and a 0 asserts the second one.
    const out = attachRowProjections([row('p1', 20, HALFTIME)], new Map([['p2', 14]]));
    expect(out[0].projected).toBeUndefined();
  });

  it('is a no-op for an empty map — the offseason replay keeps its own rows', () => {
    const rows = [row('p1', 20, HALFTIME)];
    expect(attachRowProjections(rows, new Map())).toBe(rows);
    expect(attachRowProjections(rows, undefined)).toBe(rows);
  });

  it('does not mutate the rows it was handed', () => {
    const rows = [row('p1', 20, HALFTIME)];
    attachRowProjections(rows, new Map([['p1', 20]]));
    expect(rows[0].projected).toBeUndefined();
  });
});

describe('buildBoardFromSnapshot stamps the per-league projections onto rows', () => {
  const snapshot = {
    ok: true,
    matchups: [{ home: '0001', away: '0002' }],
    scores: { '0001': 20, '0002': 9 },
    remaining: {},
    players: { '0001': [row('p1', 20, HALFTIME)], '0002': [row('p2', 9, HALFTIME)] },
    bench: { '0001': [row('b1', 4, HALFTIME, 'nonstarter')] },
    playersYetToPlay: {},
  };

  const board = (projections: Map<string, number>) =>
    buildBoardFromSnapshot({
      slug: 'theleague',
      week: WEEK,
      year: YEAR,
      ok: true,
      snapshot: snapshot as never,
      projections,
      viewerFranchiseId: null,
    });

  it('gives a starter row the projection his TEAM total is computed from', () => {
    const projections = new Map([['p1', 20], ['p2', 18], ['b1', 11]]);
    const side = board(projections).panels[0].matchups[0].sides[0];

    expect(side.players[0].projected).toBe(20);
    // The row and the team now agree: 20 live + half of 20 = 30 either way.
    // They disagreed before — the team said 30 and the row said 20.
    expect(side.projectedFinal).toBeCloseTo(30, 6);
    expect(
      projectPlayerFinal({
        live: side.players[0].live,
        projected: side.players[0].projected ?? 0,
        secondsRemaining: side.players[0].secondsRemaining,
      }),
    ).toBeCloseTo(side.projectedFinal, 6);
  });

  it('stamps the BENCH too — it renders the same row component', () => {
    const side = board(new Map([['b1', 11]])).panels[0].matchups[0].sides[0];
    expect(side.bench[0].projected).toBe(11);
  });

  it('never sums the bench into the team, stamped or not', () => {
    // The bench projection exists to be DISPLAYED. A bench row folded into the
    // totals inflates the projected final and the win-probability bar with
    // points that cannot be scored.
    const side = board(new Map([['p1', 20], ['b1', 11]])).panels[0].matchups[0].sides[0];
    expect(side.projectedFinal).toBeCloseTo(30, 6);
    expect(side.remainingPoints).toBeCloseTo(10, 6);
  });

  it('keeps the SHARED playerMeta at 0 — it cannot hold a per-league number', () => {
    // This is not an oversight being preserved: `playerMeta` is one map for
    // every panel of a cross-league board, and the same back is worth
    // different points under two leagues' rules.
    const built = board(new Map([['p1', 20]]));
    expect(built.playerMeta.p1.projected).toBe(0);
  });

  it('leaves rows unprojected when the league has no projections at all', () => {
    const side = board(new Map()).panels[0].matchups[0].sides[0];
    expect(side.players[0].projected).toBeUndefined();
    // Degrading to live-only is the honest answer, and it is what the team
    // totals have always done.
    expect(side.projectedFinal).toBe(20);
  });
});

describe('the team totals still read the map, not the rows', () => {
  it('prefers the per-league projections over PlayerMeta’s copy', () => {
    const meta = {
      p1: {
        id: 'p1',
        name: 'Name p1',
        position: 'RB',
        nflTeam: 'KC',
        headshot: '',
        espnId: null,
        projected: 0,
      },
    };
    const totals = computeTeamTotals([row('p1', 20, HALFTIME)], meta, {
      projections: new Map([['p1', 20]]),
    });
    expect(totals.projectedFinal).toBeCloseTo(30, 6);
  });
});

describe('LvPlayerRow reads the ROW first', () => {
  const source = readFileSync('src/components/shared/live/LvPlayerRow.tsx', 'utf8');

  it('resolves its projection from the row before falling back to meta', () => {
    // A scan guard, because the regression is invisible: reverting to
    // `meta?.projected ?? 0` still renders a number, still polls, still draws
    // a correct win-probability bar — it just prints every in-progress
    // starter's live score back as his projected final.
    expect(source).toMatch(/const projected = row\.projected \?\? meta\?\.projected \?\? 0;/);
  });

  it('still computes the projected final through the shared model', () => {
    expect(source).toContain('projectPlayerFinal');
  });
});
