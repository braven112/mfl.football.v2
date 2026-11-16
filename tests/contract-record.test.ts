import { describe, it, expect } from 'vitest';
import { contractTermsChange, isDeclarationVisible } from '../src/utils/contract-record';

describe('contractTermsChange', () => {
  it('shows a veteran extension as old terms → new terms', () => {
    expect(
      contractTermsChange({
        currentSalary: 2_500_000, currentYears: 2, currentContractInfo: '',
        requestedSalary: 5_760_000, requestedYears: 4, requestedContractInfo: 'E',
      }),
    ).toEqual({ before: '$2.50M · 2 yrs', after: '$5.76M · 4 yrs · E' });
  });

  it('shows a franchise tag with its F designation', () => {
    expect(
      contractTermsChange({
        currentSalary: 605_000, currentYears: 1, currentContractInfo: '',
        requestedSalary: 9_100_000, requestedYears: 1, requestedContractInfo: 'F',
      }),
    ).toEqual({ before: '$605K · 1 yr', after: '$9.10M · 1 yr · F' });
  });

  it('drops a rookie designation the extension removes, and keeps salary when none was asked', () => {
    expect(
      contractTermsChange({
        currentSalary: 1_000_000, currentYears: 2, currentContractInfo: 'RC',
        requestedYears: 4, requestedContractInfo: '',
      }),
    ).toEqual({ before: '$1.00M · 2 yrs · RC', after: '$1.00M · 4 yrs' });
  });

  it('shows years alone when no salary was recorded', () => {
    expect(contractTermsChange({ currentYears: 1, requestedYears: 3 })).toEqual({ before: '1 yr', after: '3 yrs' });
  });
});

describe('isDeclarationVisible', () => {
  const tag = { type: 'franchise-tag', status: 'pending', franchiseId: '0003' };
  it('keeps a queued tag secret from everyone but its own team and the commissioner', () => {
    expect(isDeclarationVisible(tag, { franchiseId: null, isCommissioner: false })).toBe(false);
    expect(isDeclarationVisible(tag, { franchiseId: '0001', isCommissioner: false })).toBe(false);
    expect(isDeclarationVisible(tag, { franchiseId: '0003', isCommissioner: false })).toBe(true);
    expect(isDeclarationVisible(tag, { franchiseId: null, isCommissioner: true })).toBe(true);
  });

  it('shows an applied tag and every other declaration to anyone', () => {
    const anon = { franchiseId: null, isCommissioner: false };
    expect(isDeclarationVisible({ ...tag, status: 'applied' }, anon)).toBe(true);
    expect(isDeclarationVisible({ ...tag, type: 'veteran-extension' }, anon)).toBe(true);
  });

  it('is applied by both pages that list declarations', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    for (const page of ['src/pages/theleague/rosters.astro', 'src/pages/theleague/front-office/contracts.astro']) {
      expect(readFileSync(join(__dirname, '..', page), 'utf8')).toContain('isDeclarationVisible(');
    }
  });
});
