import { describe, it, expect } from 'vitest';
import { sharedDivision, vetSpeculationCopy } from '../scripts/lib/speculation-copy.mjs';

const DIVISIONS = ['Northwest', 'Southwest', 'Central', 'East'];

// The post that shipped: Pacific Pigskins (Northwest) and Midwestside
// Connection (Southwest) called "division rivals", the buyer "desperate".
const SHIPPED =
  'The talk-radio crowd in Midwestside-country has been kicking around a wild hypothetical: what if the Pigskins moved Lamar Jackson, 29, to a division rival desperate for QB stability?';

const vet = (post: string | null, shared: string | null) =>
  vetSpeculationCopy(post, { sharedDivision: shared, divisionNames: DIVISIONS });

describe('sharedDivision', () => {
  it('names the division only when both teams are known to share it', () => {
    expect(sharedDivision({ division: 'Northwest' }, { division: 'Northwest' })).toBe('Northwest');
    expect(sharedDivision({ division: 'Northwest' }, { division: 'Southwest' })).toBeNull();
    expect(sharedDivision({ division: 'Northwest' }, undefined)).toBeNull();
    expect(sharedDivision({}, {})).toBeNull();
  });
});

describe('vetSpeculationCopy', () => {
  it('rejects the post that shipped', () => {
    expect(vet(SHIPPED, null)).toBeNull();
  });

  it('rejects any division talk between teams in different divisions', () => {
    expect(vet('…pry him away from the division.', null)).toBeNull();
    expect(vet('An intra-divisional swap?', null)).toBeNull();
    expect(vet('Two Southwest rivals talking?', null)).toBeNull();
  });

  it('allows the shared division, by its own name only', () => {
    expect(vet('A Northwest division rival could use a QB.', 'Northwest')).not.toBeNull();
    expect(vet('A Southwest division rival could use a QB.', 'Northwest')).toBeNull();
  });

  it('rejects team-situation claims the input cannot support, in any division', () => {
    for (const post of [
      'A division rival desperate for a QB.',
      'The rebuilding Pigskins could listen.',
      'A contender in need of a WR.',
      'Pure win-now thinking.',
    ]) {
      expect(vet(post, 'Northwest')).toBeNull();
    }
  });

  it('passes copy that makes no such claim', () => {
    const post = 'Fan boards are floating Chris Bell for Lamar Jackson — neither front office has commented.';
    expect(vet(post, null)).toBe(post);
  });

  it('does not mistake a team name for a division', () => {
    const post = 'The talk-radio crowd in Midwestside-country is floating a Lamar Jackson deal.';
    expect(vet(post, null)).toBe(post);
  });

  it('passes through a missing post as null', () => {
    expect(vet(null, 'Northwest')).toBeNull();
  });
});
