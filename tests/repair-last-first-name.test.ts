import { describe, expect, it } from 'vitest';
import { repairLastFirstName } from '../src/utils/player-name-matching';

describe('repairLastFirstName', () => {
  it('flips a "Last, First" name in a headline', () => {
    expect(
      repairLastFirstName('Dark Magicians of Chaos trade with Da Dangsters for WR Samuel, Deebo', 'Deebo Samuel'),
    ).toBe('Dark Magicians of Chaos trade with Da Dangsters for WR Deebo Samuel');
  });

  it('rejoins the AI rewrite that split one player into two', () => {
    expect(
      repairLastFirstName("I'm told they are sending WR Samuel and WR Deebo, along with…", 'Deebo Samuel'),
    ).toBe("I'm told they are sending WR Deebo Samuel, along with…");
  });

  it('handles a multi-word surname', () => {
    expect(repairLastFirstName('for WR St. Brown, Amon-Ra', 'Amon-Ra St. Brown')).toBe('for WR Amon-Ra St. Brown');
  });

  it('leaves correct copy and other players alone', () => {
    const ok = 'Team A send WR Deebo Samuel and RB Smith, Jane to Team B';
    expect(repairLastFirstName(ok, 'Deebo Samuel')).toBe(ok);
  });
});
