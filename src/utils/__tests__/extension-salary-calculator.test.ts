import { describe, it, expect } from 'vitest';
import { calculateExtensionSalary, getProjectedSalary } from '../extension-salary-calculator';

describe('Extension Salary Calculator', () => {
  describe('calculateExtensionSalary', () => {
    it('should calculate extension salary with standard values', () => {
      // Example: Rashee Rice
      // Current Salary: $756,250
      // Current Years: 3
      // Top 5 Average: $8,614,333 (WR)
      const result = calculateExtensionSalary(756250, 3, 8614333);

      // Extension value per year = (8,614,333 * 2) / (3 + 2) = 17,228,666 / 5 = 3,445,733.20
      expect(result.extensionValuePerYear).toBeCloseTo(3445733.20, 0);

      // New contract salary = 756,250 + 3,445,733.20 = 4,201,983.20
      expect(result.newContractSalary).toBeCloseTo(4201983.20, 0);

      // Total value = 4,201,983.20 * 5 = 21,009,916
      expect(result.totalNewValue).toBeCloseTo(21009916, 0);

      // Verify the formula components
      expect(result.currentSalary).toBe(756250);
      expect(result.currentYears).toBe(3);
      expect(result.top5Average).toBe(8614333);
    });

    it('should calculate correctly with 2 current years', () => {
      const result = calculateExtensionSalary(1000000, 2, 5000000);

      // Extension value per year = (5,000,000 * 2) / (2 + 2) = 10,000,000 / 4 = 2,500,000
      expect(result.extensionValuePerYear).toBeCloseTo(2500000, 0);

      // New contract salary = 1,000,000 + 2,500,000 = 3,500,000
      expect(result.newContractSalary).toBeCloseTo(3500000, 0);

      // Total value = 3,500,000 * 4 = 14,000,000
      expect(result.totalNewValue).toBeCloseTo(14000000, 0);
    });

    it('should handle edge case with 1 current year', () => {
      const result = calculateExtensionSalary(500000, 1, 6000000);

      // Extension value per year = (6,000,000 * 2) / (1 + 2) = 12,000,000 / 3 = 4,000,000
      expect(result.extensionValuePerYear).toBeCloseTo(4000000, 0);

      // New contract salary = 500,000 + 4,000,000 = 4,500,000
      expect(result.newContractSalary).toBeCloseTo(4500000, 0);

      // Total value = 4,500,000 * 3 = 13,500,000
      expect(result.totalNewValue).toBeCloseTo(13500000, 0);
    });

    it('should return correct values with zero top 5 average', () => {
      const result = calculateExtensionSalary(500000, 2, 0);

      // Extension value per year = (0 * 2) / (2 + 2) = 0
      expect(result.extensionValuePerYear).toBe(0);

      // New contract salary = 500,000 + 0 = 500,000
      expect(result.newContractSalary).toBe(500000);

      // Total value = 500,000 * 4 = 2,000,000
      expect(result.totalNewValue).toBe(2000000);
    });

    it('should maintain unbreakable formula consistency', () => {
      // Test that the formula is mathematically consistent
      const currentSalary = 1200000;
      const currentYears = 3;
      const top5Average = 7500000;

      const result = calculateExtensionSalary(currentSalary, currentYears, top5Average);

      // Verify the extension value per year formula
      const expectedExtensionPerYear = (top5Average * 2) / (currentYears + 2);
      expect(result.extensionValuePerYear).toBeCloseTo(expectedExtensionPerYear, 0);

      // Verify the new contract salary formula
      const expectedNewSalary = currentSalary + expectedExtensionPerYear;
      expect(result.newContractSalary).toBeCloseTo(expectedNewSalary, 0);

      // Verify total value formula
      const expectedTotal = expectedNewSalary * (currentYears + 2);
      expect(result.totalNewValue).toBeCloseTo(expectedTotal, 0);
    });
  });

  describe('getProjectedSalary', () => {
    it('should calculate projected salary with 10% annual increase', () => {
      const newContractSalary = 4000000;

      // Year 0 (current year)
      expect(getProjectedSalary(newContractSalary, 0)).toBeCloseTo(4000000, 0);

      // Year 1 (10% increase)
      expect(getProjectedSalary(newContractSalary, 1)).toBeCloseTo(4400000, 0);

      // Year 2 (10% increase each year)
      expect(getProjectedSalary(newContractSalary, 2)).toBeCloseTo(4840000, 0);

      // Year 3
      expect(getProjectedSalary(newContractSalary, 3)).toBeCloseTo(5324000, 0);
    });

    it('should handle zero years in the future', () => {
      const newContractSalary = 3500000;
      expect(getProjectedSalary(newContractSalary, 0)).toBe(newContractSalary);
    });

    it('should compound correctly over multiple years', () => {
      const newContractSalary = 2000000;
      const year5Salary = getProjectedSalary(newContractSalary, 5);

      // 2,000,000 * (1.1)^5 = 2,000,000 * 1.61051 = 3,221,020
      expect(year5Salary).toBeCloseTo(3221020, 0);
    });
  });

  describe('Formula validation', () => {
    it('should never break the unbreakable formula', () => {
      // This test ensures the formula can never be accidentally changed
      // If this fails, someone has modified the core formula logic
      const testCases = [
        // [currentSalary, currentYears, top5Average, expectedNewSalary]
        [750000, 3, 8614333, 4201983.20],
        [1000000, 2, 5000000, 3500000],
        [500000, 1, 6000000, 4500000],
        [2000000, 3, 10000000, 6000000],
        [400000, 2, 4500000, 2400000],
      ];

      testCases.forEach(([current, years, top5, expectedNew]) => {
        const result = calculateExtensionSalary(current as number, years as number, top5 as number);
        expect(result.newContractSalary).toBeCloseTo(expectedNew as number, 0);
      });
    });
  });
});
