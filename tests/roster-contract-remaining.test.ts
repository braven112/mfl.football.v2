/**
 * "Total remaining" on a contract is this year's salary plus every later
 * year's +10% raise — the figures the salary table prints — not salary x years
 * (user, 2026-09-26: "it should calculate this year's salaries").
 */
import { describe, it, expect } from 'vitest';
import { ANNUAL_ESCALATION as TS_ESCALATION } from '../src/utils/salary-calculations';
import { ANNUAL_ESCALATION, contractRemaining } from '../scripts/lib/roster-season-payload.mjs';

describe('contractRemaining', () => {
  it('adds each remaining year with the +10% raise', () => {
    // $4.3M for 3 years: 4.3 + 4.73 + 5.203
    expect(contractRemaining(4_300_000, 3)).toBe(14_233_000);
  });

  it('a one-year (or unknown-length) deal is just this year', () => {
    expect(contractRemaining(1_000_000, 1)).toBe(1_000_000);
    expect(contractRemaining(1_000_000, 0)).toBe(1_000_000);
  });

  it('uses the same escalation as the salary table', () => {
    expect(ANNUAL_ESCALATION).toBe(TS_ESCALATION);
  });
});
