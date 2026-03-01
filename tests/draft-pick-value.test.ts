import { describe, it, expect } from 'vitest';
import {
  getWeightedSalary,
  toOverallPick,
  calculatePickValue,
  estimateFuturePickValue,
  buildPickValueMap,
} from '../src/utils/draft-pick-value';

describe('draft-pick-value', () => {
  // ---------------------------------------------------------------------------
  // toOverallPick
  // ---------------------------------------------------------------------------
  describe('toOverallPick', () => {
    it('round 1 pick 1 → overall 1', () => {
      expect(toOverallPick(1, 1)).toBe(1);
    });

    it('round 1 pick 16 → overall 16', () => {
      expect(toOverallPick(1, 16)).toBe(16);
    });

    it('round 1 toilet bowl pick 17 → overall 17', () => {
      expect(toOverallPick(1, 17)).toBe(17);
    });

    it('round 2 pick 1 → overall 18', () => {
      expect(toOverallPick(2, 1)).toBe(18);
    });

    it('round 2 pick 16 → overall 33', () => {
      expect(toOverallPick(2, 16)).toBe(33);
    });

    it('round 3 pick 1 → overall 36', () => {
      expect(toOverallPick(3, 1)).toBe(36);
    });
  });

  // ---------------------------------------------------------------------------
  // getWeightedSalary
  // ---------------------------------------------------------------------------
  describe('getWeightedSalary', () => {
    it('returns data for round 1 pick 1', () => {
      const result = getWeightedSalary(1, 1);
      // QB: 3M, RB: 3.4M, WR: 3.5M, TE: 2.5M
      // Weighted: 3.5M×0.4 + 3.4M×0.3 + 3M×0.15 + 2.5M×0.15 = 1.4M + 1.02M + 0.45M + 0.375M = 3.245M
      expect(result.weightedAvg).toBeGreaterThan(2_000_000);
      expect(result.weightedAvg).toBeLessThan(4_000_000);
      expect(result.min).toBe(2_500_000); // TE
      expect(result.max).toBe(3_500_000); // WR
    });

    it('returns lower salary for later picks in the round', () => {
      const pick1 = getWeightedSalary(1, 1);
      const pick16 = getWeightedSalary(1, 16);
      expect(pick1.weightedAvg).toBeGreaterThan(pick16.weightedAvg);
    });

    it('returns lower salary for round 2 than round 1', () => {
      const rd1mid = getWeightedSalary(1, 8);
      const rd2mid = getWeightedSalary(2, 25); // overall pick 25 = middle of round 2
      expect(rd1mid.weightedAvg).toBeGreaterThan(rd2mid.weightedAvg);
    });

    it('returns fallback for round 3', () => {
      const result = getWeightedSalary(3, 36);
      expect(result.weightedAvg).toBe(450_000);
    });

    it('returns fallback for unknown round', () => {
      const result = getWeightedSalary(5, 1);
      expect(result.weightedAvg).toBe(450_000);
    });
  });

  // ---------------------------------------------------------------------------
  // calculatePickValue
  // ---------------------------------------------------------------------------
  describe('calculatePickValue', () => {
    it('round 1 pick 1 has highest surplus value', () => {
      const value = calculatePickValue(1, 1);
      expect(value.round).toBe(1);
      expect(value.pickInRound).toBe(1);
      expect(value.overallPick).toBe(1);
      expect(value.surplusValue).toBeGreaterThan(0);
      expect(value.expectedProductionValue).toBeGreaterThan(value.expectedSalary);
      expect(value.contractYears).toBe(3);
      expect(value.totalSurplusOverContract).toBe(value.surplusValue * 3);
    });

    it('round 1 pick 16 has lower surplus than pick 1', () => {
      const pick1 = calculatePickValue(1, 1);
      const pick16 = calculatePickValue(1, 16);
      expect(pick1.surplusValue).toBeGreaterThan(pick16.surplusValue);
    });

    it('round 2 has lower surplus than round 1', () => {
      const rd1 = calculatePickValue(1, 8);
      const rd2 = calculatePickValue(2, 8);
      expect(rd1.surplusValue).toBeGreaterThan(rd2.surplusValue);
    });

    it('round 3 has minimal or zero surplus', () => {
      const rd3 = calculatePickValue(3, 1);
      // At multiplier 1.0 (breakeven), surplus should be ~0
      expect(rd3.surplusValue).toBeLessThanOrEqual(50_000);
    });

    it('toilet bowl pick (1.17) has a valid value', () => {
      const tb = calculatePickValue(1, 17);
      expect(tb.overallPick).toBe(17);
      expect(tb.expectedSalary).toBeGreaterThan(0);
      expect(tb.surplusValue).toBeGreaterThan(0);
    });

    it('includes salary range across positions', () => {
      const value = calculatePickValue(1, 1);
      expect(value.salaryRange.min).toBeLessThan(value.salaryRange.max);
      expect(value.salaryRange.min).toBeGreaterThan(0);
    });

    it('all values are rounded to 50K increments', () => {
      const value = calculatePickValue(1, 5);
      expect(value.expectedSalary % 50_000).toBe(0);
      expect(value.expectedProductionValue % 50_000).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // estimateFuturePickValue
  // ---------------------------------------------------------------------------
  describe('estimateFuturePickValue', () => {
    it('uses middle of round (pick 8)', () => {
      const future = estimateFuturePickValue(1);
      const exact = calculatePickValue(1, 8);
      expect(future.surplusValue).toBe(exact.surplusValue);
      expect(future.expectedSalary).toBe(exact.expectedSalary);
    });

    it('round 1 future pick > round 2 future pick', () => {
      const rd1 = estimateFuturePickValue(1);
      const rd2 = estimateFuturePickValue(2);
      expect(rd1.surplusValue).toBeGreaterThan(rd2.surplusValue);
    });

    it('round 2 future pick > round 3 future pick', () => {
      const rd2 = estimateFuturePickValue(2);
      const rd3 = estimateFuturePickValue(3);
      expect(rd2.surplusValue).toBeGreaterThan(rd3.surplusValue);
    });
  });

  // ---------------------------------------------------------------------------
  // buildPickValueMap
  // ---------------------------------------------------------------------------
  describe('buildPickValueMap', () => {
    it('builds map keyed by year-round-franchiseId', () => {
      const picks = [
        { year: '2027', round: '1', originalPickFor: '0005' },
        { year: '2027', round: '2', originalPickFor: '0003' },
      ];
      const map = buildPickValueMap(picks);
      expect(map['2027-1-0005']).toBeDefined();
      expect(map['2027-2-0003']).toBeDefined();
      expect(map['2027-1-0005'].surplusValue).toBeGreaterThan(
        map['2027-2-0003'].surplusValue
      );
    });

    it('deduplicates picks with the same key', () => {
      const picks = [
        { year: '2027', round: '1', originalPickFor: '0005' },
        { year: '2027', round: '1', originalPickFor: '0005' },
      ];
      const map = buildPickValueMap(picks);
      expect(Object.keys(map)).toHaveLength(1);
    });

    it('handles empty array', () => {
      const map = buildPickValueMap([]);
      expect(Object.keys(map)).toHaveLength(0);
    });

    it('skips invalid round values', () => {
      const picks = [
        { year: '2027', round: 'invalid', originalPickFor: '0005' },
      ];
      const map = buildPickValueMap(picks);
      expect(Object.keys(map)).toHaveLength(0);
    });
  });
});
