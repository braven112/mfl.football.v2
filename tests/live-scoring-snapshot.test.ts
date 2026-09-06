/**
 * The MFL liveScoring parser, tested directly.
 *
 * This parse used to live inline in `/api/live-scoring` and now backs BOTH
 * that route and the Sunday Ticket board's server-side first paint. That is
 * the point of extracting it — but it also means a regression here is a
 * regression on two surfaces at once, so the rules get pinned at the source
 * rather than only through the route (tests/live-scoring-bench.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { parseLiveScoringPayload, emptyLiveSnapshot, hasLiveSignal } from '../src/utils/live-scoring-snapshot';

const p = (id: string, status: string, score = '0', sec = '0') => ({
  id, status, score, gameSecondsRemaining: sec,
});

describe('parseLiveScoringPayload', () => {
  it('splits starters from bench, and a bench row NEVER lands in players', () => {
    const snap = parseLiveScoringPayload({
      liveScoring: {
        matchup: {
          franchise: [
            { id: '0001', score: '88.4', gameSecondsRemaining: '1800',
              players: { player: [p('1', 'starter', '12.5'), p('2', 'nonstarter', '30.0')] } },
            { id: '0002', score: '70.1', gameSecondsRemaining: '0',
              players: { player: [p('3', 'starter', '9.0')] } },
          ],
        },
      },
    });

    expect(snap.players['0001'].map((r) => r.id)).toEqual(['1']);
    expect(snap.bench['0001'].map((r) => r.id)).toEqual(['2']);
    // The whole risk of carrying a bench at all: it must not reach the map
    // every downstream consumer treats as "the rows that score".
    expect(snap.players['0001'].some((r) => r.status === 'nonstarter')).toBe(false);
  });

  it('a franchise with no bench is ABSENT from the bench map, not an empty array', () => {
    const snap = parseLiveScoringPayload({
      liveScoring: { franchise: { id: '0002', score: '5', players: { player: p('9', 'starter') } } },
    });
    // The island renders no disclosure control at all rather than one that
    // opens onto nothing.
    expect('0002' in snap.bench).toBe(false);
  });

  it('treats a row MFL does not confirm as nonstarter as a STARTER', () => {
    const snap = parseLiveScoringPayload({
      liveScoring: { franchise: { id: '0001', players: { player: [
        { id: '7', score: '4.2' },              // no status at all
        { id: '8', status: '', score: '1.0' },  // empty status
      ] } } },
    });
    // Dropping a real starter silently subtracts his points from the matchup,
    // which is far worse than one extra row.
    expect(snap.players['0001'].map((r) => r.id).sort()).toEqual(['7', '8']);
    expect(snap.bench['0001']).toBeUndefined();
  });

  it('normalizes MFL collapsing a one-element list to a bare object', () => {
    const snap = parseLiveScoringPayload({
      liveScoring: { matchup: { franchise: [
        { id: '0001', score: '10', players: { player: { id: '1', status: 'starter', score: '3' } } },
        { id: '0002', score: '20', players: { player: { id: '2', status: 'starter', score: '4' } } },
      ] } },
    });
    expect(snap.players['0001']).toHaveLength(1);
    expect(snap.matchups).toEqual([{ home: '0001', away: '0002' }]);
  });

  it('accepts the flat franchise.player[] shape as well as players.player[]', () => {
    const snap = parseLiveScoringPayload({
      liveScoring: { franchise: { id: '0001', player: [p('1', 'starter', '6.0')] } },
    });
    expect(snap.players['0001'][0].live).toBe(6);
  });

  it('never throws on a malformed or empty body', () => {
    for (const body of [null, undefined, {}, { liveScoring: {} }, { error: 'throttled' }, 'nope']) {
      expect(() => parseLiveScoringPayload(body)).not.toThrow();
      expect(parseLiveScoringPayload(body).scores).toEqual({});
    }
  });

  it('emptyLiveSnapshot returns a fresh object each call', () => {
    const a = emptyLiveSnapshot();
    a.scores['0001'] = 1;
    expect(emptyLiveSnapshot().scores).toEqual({});
  });
});

describe('hasLiveSignal — the unplayed-week trap', () => {
  /**
   * The real shape MFL returns for a week that has not been played, recorded
   * from both leagues at 2026 week 10: every franchise present, every score
   * "0.00", every player a `nonstarter` (no lineup was ever submitted),
   * gameSecondsRemaining 0. HTTP 200, well-formed, and completely empty of
   * meaning. Read literally it says "both teams finished on 0.0".
   */
  const unplayedWeek = {
    liveScoring: {
      week: '10',
      matchup: [{
        franchise: [
          { id: '0001', score: '0.00', gameSecondsRemaining: '0', playersYetToPlay: '0',
            players: { player: [
              { id: '0518', score: '0.00', status: 'nonstarter', gameSecondsRemaining: '0' },
              { id: '0519', score: '0.00', status: 'nonstarter', gameSecondsRemaining: '0' },
            ] } },
          { id: '0002', score: '0.00', gameSecondsRemaining: '0', playersYetToPlay: '0',
            players: { player: [
              { id: '0620', score: '0.00', status: 'nonstarter', gameSecondsRemaining: '0' },
            ] } },
        ],
      }],
    },
  };

  it('rejects an unplayed week even though it has franchises and parses cleanly', () => {
    const snap = parseLiveScoringPayload(unplayedWeek);
    // Every weaker guard passes here — which is the whole point.
    expect(Object.keys(snap.scores)).toHaveLength(2);
    expect(snap.matchups).toHaveLength(1);
    // Only the starter/score test catches it.
    expect(hasLiveSignal(snap)).toBe(false);
  });

  it('accepts a live week that is still 0-0 in the first quarter', () => {
    // A real game can legitimately be scoreless. It always has STARTERS.
    const snap = parseLiveScoringPayload({
      liveScoring: { franchise: { id: '0001', score: '0.00', gameSecondsRemaining: '3600',
        players: { player: [{ id: '1', status: 'starter', score: '0.00', gameSecondsRemaining: '3600' }] } } },
    });
    expect(hasLiveSignal(snap)).toBe(true);
  });

  it('accepts real totals even when the DETAILS breakdown is missing', () => {
    const snap = parseLiveScoringPayload({
      liveScoring: { franchise: { id: '0001', score: '76.63', gameSecondsRemaining: '0' } },
    });
    expect(snap.players['0001']).toBeUndefined();
    expect(hasLiveSignal(snap)).toBe(true);
  });

  it('rejects an empty snapshot', () => {
    expect(hasLiveSignal(emptyLiveSnapshot())).toBe(false);
  });
});
