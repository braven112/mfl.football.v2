import { describe, expect, it } from 'vitest';
import { validateContractSubmission } from '../src/utils/contract-validation';

describe('validateContractSubmission', () => {
  it('allows team options outside the generic contract window', () => {
    const result = validateContractSubmission(
      '13522',
      2,
      3,
      '14867',
      '0001',
      {
        type: 'team-option',
        currentContractInfo: 'TO',
        now: new Date(2026, 7, 25, 12, 0, 0),
      },
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects team options once the player has reached Year 4', () => {
    const result = validateContractSubmission(
      '13522',
      1,
      2,
      '14867',
      '0001',
      {
        type: 'team-option',
        currentContractInfo: 'TO',
        now: new Date(2026, 7, 25, 12, 0, 0),
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.message.includes('before the player begins Year 4'))).toBe(true);
  });

  it('rejects team options for non-TO contracts', () => {
    const result = validateContractSubmission(
      '13522',
      2,
      3,
      '14867',
      '0001',
      {
        type: 'team-option',
        currentContractInfo: '',
        now: new Date(2026, 7, 25, 12, 0, 0),
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.message.includes('only available for TO contracts'))).toBe(true);
  });
});
