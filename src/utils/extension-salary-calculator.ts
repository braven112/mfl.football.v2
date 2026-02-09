/**
 * Centralized formula for calculating 2-year extension salary
 * 
 * Formula:
 * 1. Extension Value Per Year = (Average of Top 5 at Position × 2) ÷ (Current Years + 2)
 * 2. New Contract Salary = Current Salary + Extension Value Per Year
 * 3. Future years follow 10% annual increase league-wide
 */

export interface ExtensionSalaryResult {
  currentSalary: number;
  currentYears: number;
  top5Average: number;
  extensionValuePerYear: number;
  newContractSalary: number;
  totalNewValue: number; // newContractSalary * (currentYears + 2)
}

/**
 * Calculate the new contract salary for a 2-year extension
 * @param currentSalary - Player's current annual salary
 * @param currentYears - Years remaining on current contract
 * @param top5Average - Average salary of top 5 players at the position
 * @returns Extension salary calculation details
 */
export const calculateExtensionSalary = (
  currentSalary: number,
  currentYears: number,
  top5Average: number
): ExtensionSalaryResult => {
  // Extension value per year = (top 5 average × 2) / (current years + 2)
  const extensionValuePerYear = (top5Average * 2) / (currentYears + 2);
  
  // New contract salary = current salary + extension value per year
  const newContractSalary = currentSalary + extensionValuePerYear;
  
  // Total value over all years
  const totalNewValue = newContractSalary * (currentYears + 2);

  return {
    currentSalary,
    currentYears,
    top5Average,
    extensionValuePerYear,
    newContractSalary,
    totalNewValue,
  };
};

/**
 * Get projected salary for a future year with 10% annual increase
 * @param newContractSalary - The new contract salary (year 1)
 * @param yearsFromNow - How many years in the future
 * @returns Projected salary
 */
export const getProjectedSalary = (
  newContractSalary: number,
  yearsFromNow: number
): number => {
  return newContractSalary * Math.pow(1.1, yearsFromNow);
};
