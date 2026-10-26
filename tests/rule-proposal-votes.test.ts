/**
 * Rule proposal votes follow TheLeague constitution's "Rule Changes" section:
 * 75% to pass, abstentions count as Yes, final 5 days after the vote opens.
 */
import { describe, it, expect } from 'vitest';
import { closesAtFor, tallyVotes, votePhase, type ProposalVoteState } from '../src/utils/rule-proposal-votes';

const FRANCHISES = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));
const OPENED = '2026-12-20T18:00:00.000Z';
const window = { openedAt: OPENED, openedBy: '0001' };

function state(votes: Record<string, 'yes' | 'no'>, w: ProposalVoteState['window'] = window): ProposalVoteState {
  return {
    window: w,
    votes: Object.fromEntries(Object.entries(votes).map(([fid, choice]) => [fid, { choice, at: OPENED }])),
  };
}

const noVotes = (n: number) => Object.fromEntries(FRANCHISES.slice(0, n).map((f) => [f, 'no' as const]));

describe('rule proposal vote window', () => {
  it('stays in discussion until a commissioner opens it', () => {
    expect(votePhase(null)).toBe('discussion');
  });

  it('is final exactly 5 days after it opens', () => {
    expect(closesAtFor(window).toISOString()).toBe('2026-12-25T18:00:00.000Z');
    expect(votePhase(window, new Date('2026-12-25T17:59:59Z'))).toBe('open');
    expect(votePhase(window, new Date('2026-12-25T18:00:00Z'))).toBe('closed');
  });
});

describe('rule proposal tally', () => {
  const during = new Date('2026-12-21T00:00:00Z');

  it('needs 12 of 16, so 5 No votes sink it', () => {
    const t = tallyVotes(state({}), FRANCHISES, during);
    expect(t.needed).toBe(12);
    expect(t.noToFail).toBe(5);
  });

  it('counts teams that did not vote as Yes', () => {
    const t = tallyVotes(state(noVotes(4)), FRANCHISES, during);
    expect(t).toMatchObject({ yes: 0, no: 4, abstain: 12, passes: true });
    expect(tallyVotes(state(noVotes(5)), FRANCHISES, during).passes).toBe(false);
  });

  it('ignores a ballot from a franchise not in the league', () => {
    const t = tallyVotes(state({ '9999': 'no', '0001': 'yes' }), FRANCHISES, during);
    expect(t).toMatchObject({ yes: 1, no: 0, abstain: 15 });
  });
});
