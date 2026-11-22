/**
 * The homepage scoreboard links each game to the live-scoring board with
 * `?matchup=`, and the board opens the card whose `pairingKey` matches. The
 * two keys are written in two files; this pins that they agree, in either
 * home/away order, so a link can never silently land on the bare board.
 */
import { describe, expect, it } from 'vitest';
import { liveMatchupHref, matchupLinkKey, LIVE_MATCHUP_PARAM } from '../src/utils/live/matchup-link';
import { pairingKey } from '../src/utils/live/model';
import fs from 'node:fs';

const matchup = (a: string, b: string) =>
  ({ sides: [{ franchiseId: a }, { franchiseId: b }] }) as Parameters<typeof pairingKey>[0];

describe('live matchup links', () => {
  it('uses the board’s own pairing key, whichever side is home', () => {
    expect(matchupLinkKey('0007', '0002')).toBe(pairingKey(matchup('0002', '0007')));
    expect(matchupLinkKey('0002', '0007')).toBe(pairingKey(matchup('0007', '0002')));
  });

  it('adds the parameter to a bare path or one that already has a query', () => {
    expect(liveMatchupHref('/afl-fantasy/live-scoring', '0007', '0002')).toBe(
      '/afl-fantasy/live-scoring?matchup=0002%3A0007',
    );
    expect(liveMatchupHref('/live-scoring?week=12', '0001', '0003')).toBe(
      '/live-scoring?week=12&matchup=0001%3A0003',
    );
  });

  it('is read by the board under the same parameter name', () => {
    const board = fs.readFileSync('src/components/shared/live/LiveBoard.tsx', 'utf8');
    expect(LIVE_MATCHUP_PARAM).toBe('matchup');
    expect(board).toContain('searchParams.get(LIVE_MATCHUP_PARAM)');
  });
});
