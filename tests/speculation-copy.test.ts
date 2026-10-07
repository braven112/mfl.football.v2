import { describe, it, expect } from 'vitest';
import { sharesDivision, vetSpeculationCopy } from '../scripts/lib/speculation-copy.mjs';

// The post that shipped: Pacific Pigskins (Northwest) and Midwestside
// Connection (Southwest) called "division rivals" by the model.
const SHIPPED =
  'The talk-radio crowd in Midwestside-country has been kicking around a wild hypothetical: what if the Pigskins moved Lamar Jackson, 29, to a division rival desperate for QB stability?';

describe('sharesDivision', () => {
  it('is true only for a known, matching division', () => {
    expect(sharesDivision({ division: 'Northwest' }, { division: 'Northwest' })).toBe(true);
    expect(sharesDivision({ division: 'Northwest' }, { division: 'Southwest' })).toBe(false);
    expect(sharesDivision({ division: 'Northwest' }, undefined)).toBe(false);
    expect(sharesDivision({}, {})).toBe(false);
  });
});

describe('vetSpeculationCopy', () => {
  it('rejects a division claim between teams in different divisions', () => {
    expect(vetSpeculationCopy(SHIPPED, { sameDivision: false })).toBeNull();
    expect(vetSpeculationCopy('…pry him away from the division.', { sameDivision: false })).toBeNull();
    expect(vetSpeculationCopy('An intra-divisional swap?', { sameDivision: false })).toBeNull();
  });

  it('keeps a division claim when the teams do share one', () => {
    expect(vetSpeculationCopy(SHIPPED, { sameDivision: true })).toBe(SHIPPED);
  });

  it('passes copy that makes no division claim', () => {
    const post = 'Fan boards are floating Chris Bell for Lamar Jackson.';
    expect(vetSpeculationCopy(post, { sameDivision: false })).toBe(post);
  });

  it('passes through a missing post as null', () => {
    expect(vetSpeculationCopy(null, { sameDivision: true })).toBeNull();
  });
});
