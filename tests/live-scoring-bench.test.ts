/**
 * The starter/bench split in /api/live-scoring, tested through the real route.
 *
 * The bench exists on the board because owners asked to see it, but the whole
 * risk of adding it is that a bench row leaks into the map everything else
 * SCORES from. `players` is read by computeTeam (which sums each row's
 * remaining projection into the team's projected final and counts it in "yet
 * to play"), by winProbability through that, and by buildMoments (which
 * credits a scoring play to whoever is listed). A bench row in there inflates
 * every projection on the board with points that cannot be scored and puts
 * bench touchdowns in a matchup ticker.
 *
 * Greps can't hold that line: the split is a `push` into one of two arrays,
 * and inverting the condition, dropping the `status === 'nonstarter'` check,
 * or concatenating the two maps at the response boundary all leave the source
 * looking exactly as it does now. So this drives the real handler with a
 * stubbed `fetch` and asserts on the JSON it returns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../src/pages/api/live-scoring';

const ctx = (search: string) => ({ url: new URL(`https://example.test/api/live-scoring${search}`) }) as never;

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const bad = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

/** One MFL liveScoring player row, DETAILS=1 shape. */
const p = (id: string, status: string, score = '0', sec = '0') => ({
  id, status, score, gameSecondsRemaining: sec,
});

/** A liveScoring payload with one matchup between two franchises. */
const liveScoring = (a: unknown[], b: unknown[]) => ({
  liveScoring: {
    matchup: {
      franchise: [
        { id: '0001', score: '88.4', gameSecondsRemaining: '1800', players: { player: a } },
        { id: '0002', score: '71.2', gameSecondsRemaining: '0', players: { player: b } },
      ],
    },
  },
});

/** Drive the route and return its parsed body. */
async function call(search = '?week=3') {
  return (await GET(ctx(search))).json();
}

describe('GET /api/live-scoring — starter / bench split', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** liveScoring answers first, playoffBrackets second (Promise.all order). */
  const respond = (payload: unknown) => {
    fetchMock
      .mockResolvedValueOnce(ok(payload))
      .mockResolvedValueOnce(bad(404));
  };

  it('routes nonstarters to `bench` and keeps `players` starters-only', async () => {
    respond(liveScoring(
      [p('a', 'starter', '19.4'), p('b', 'nonstarter', '31.8'), p('c', 'starter', '4.1')],
      [p('d', 'nonstarter', '12.0')],
    ));
    const body = await call();

    expect(body.players['0001'].map((r: any) => r.id)).toEqual(['a', 'c']);
    expect(body.bench['0001'].map((r: any) => r.id)).toEqual(['b']);
    expect(body.players['0002']).toEqual([]);
    expect(body.bench['0002'].map((r: any) => r.id)).toEqual(['d']);
  });

  it('carries a bench row through with its real points and clock', async () => {
    // The bench renders the same PlayerRow as the lineup — live points, the
    // game-state dot and the projected final all come off these three fields.
    respond(liveScoring([p('a', 'starter'), p('b', 'nonstarter', '31.8', '900')], []));
    const [row] = (await call()).bench['0001'];
    expect(row).toEqual({ id: 'b', live: 31.8, secondsRemaining: 900, status: 'nonstarter' });
  });

  it('treats an unclassifiable row as a STARTER, not as bench', async () => {
    // Erring toward the scoring side on purpose: dropping a real starter out
    // of the matchup silently subtracts his points from the team's total,
    // which is far worse than one extra row among the starters.
    respond(liveScoring([p('a', ''), { id: 'b', score: '9.0' }], []));
    const body = await call();
    expect(body.players['0001'].map((r: any) => r.id)).toEqual(['a', 'b']);
    expect(body.bench['0001']).toBeUndefined();
  });

  it('omits a franchise from `bench` entirely when it has none', async () => {
    // An absent key, not an empty array: the island renders no disclosure
    // control at all rather than one that opens onto nothing.
    respond(liveScoring([p('a', 'starter'), p('b', 'starter')], [p('c', 'nonstarter')]));
    const body = await call();
    expect(body.bench['0001']).toBeUndefined();
    expect(body.bench['0002']).toHaveLength(1);
  });

  it('still drops a row with no player id from both maps', async () => {
    respond(liveScoring([p('a', 'starter'), { status: 'nonstarter', score: '5' }], []));
    const body = await call();
    expect(body.players['0001']).toHaveLength(1);
    expect(body.bench['0001']).toBeUndefined();
  });

  it('handles MFL returning a lone player object instead of an array', async () => {
    // MFL collapses a one-element array to a bare object throughout its API,
    // and the bench is the map most likely to have exactly one row.
    fetchMock
      .mockResolvedValueOnce(ok({
        liveScoring: {
          franchise: {
            id: '0001', score: '12.0', gameSecondsRemaining: '0',
            players: { player: p('solo', 'nonstarter', '12.0') },
          },
        },
      }))
      .mockResolvedValueOnce(bad(404));
    const body = await call();
    expect(body.players['0001']).toEqual([]);
    expect(body.bench['0001'].map((r: any) => r.id)).toEqual(['solo']);
  });

  it('returns a bench map even when the upstream feed is dead', async () => {
    // Offseason / outage. The island spreads `data.bench ?? {}`, but the
    // response shape must not go undefined and force every caller to guard.
    fetchMock.mockResolvedValueOnce(bad(500)).mockResolvedValueOnce(bad(404));
    const body = await call();
    expect(body.ok).toBe(false);
    expect(body.bench).toEqual({});
    expect(body.players).toEqual({});
  });

  it('does not fold the bench back into the franchise score', async () => {
    // `score` is MFL's own franchise total and must pass through untouched —
    // it is what the scoreboard card prints. A bench sum added anywhere here
    // would show a team winning by points it did not score.
    respond(liveScoring([p('a', 'starter', '19.4')], [p('d', 'nonstarter', '99.9')]));
    const body = await call();
    expect(body.scores['0001']).toBe(88.4);
    expect(body.scores['0002']).toBe(71.2);
  });
});
