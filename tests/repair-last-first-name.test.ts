import { describe, expect, it } from 'vitest';
import { repairLastFirstName } from '../src/utils/player-name-matching';

describe('repairLastFirstName', () => {
  it('flips a "Last, First" name in a headline', () => {
    expect(
      repairLastFirstName('Dark Magicians of Chaos trade with Da Dangsters for WR Samuel, Deebo', 'Deebo Samuel'),
    ).toBe('Dark Magicians of Chaos trade with Da Dangsters for WR, Deebo Samuel');
  });

  it('rejoins the AI rewrite that split one player into two', () => {
    expect(
      repairLastFirstName("I'm told they are sending WR Samuel and WR Deebo, along with…", 'Deebo Samuel'),
    ).toBe("I'm told they are sending WR, Deebo Samuel, along with…");
  });

  it('handles a multi-word surname', () => {
    expect(repairLastFirstName('for WR St. Brown, Amon-Ra', 'Amon-Ra St. Brown')).toBe('for WR, Amon-Ra St. Brown');
  });

  it('adds the comma to an already-flipped name, once', () => {
    expect(repairLastFirstName('Team A land WR Deebo Samuel', 'Deebo Samuel')).toBe('Team A land WR, Deebo Samuel');
    const ok = 'Team A land WR, Deebo Samuel';
    expect(repairLastFirstName(ok, 'Deebo Samuel')).toBe(ok);
  });

  it('leaves other players alone', () => {
    const other = 'RB Smith, Jane goes to Team B';
    expect(repairLastFirstName(other, 'Deebo Samuel')).toBe(other);
  });
});
