/**
 * The 2-year extension price, in the shape the candidate cards want.
 *
 * The arithmetic is NOT defined here. `calculateVeteranExtension` in
 * salary-calculations.ts is the league's extension formula and this is a
 * presentation wrapper around it: same numbers, plus the intermediate
 * (`extensionValuePerYear`, `totalNewValue`) the cards print. It was a
 * fifth independent implementation of that formula until Phase D, agreeing
 * by coincidence of both being written from the same rule — which is not
 * the same as agreeing by construction.
 *
 * Original description, still accurate:
 * 
 * Formula:
 * 1. Extension Value Per Year = (Average of Top 5 at Position × 2) ÷ (Current Years + 2)
 * 2. New Contract Salary = Current Salary + Extension Value Per Year
 * 3. Future years follow 10% annual increase league-wide
 */

import { calculateVeteranExtension } from './salary-calculations';

/** This helper only ever prices a TWO-year extension — the cards' "Extended"
 *  column is defined as +2. A different term goes through
 *  calculateVeteranExtension directly. */
const EXTENSION_YEARS = 2;
/** The averages shape is keyed by position; this wrapper is handed a bare
 *  top-5 number, so the key is arbitrary and never leaves this call. */
const EXTENSION_POSITION_KEY = 'X';

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
  // The league formula, from the one module that owns it. `positions` is
  // the shape it reads averages in; only top5 matters for an extension.
  const { newSalary } = calculateVeteranExtension(
    currentYears,
    EXTENSION_POSITION_KEY,
    EXTENSION_YEARS,
    currentSalary,
    { positions: { [EXTENSION_POSITION_KEY]: { top5Average } } },
  );

  const newContractSalary = newSalary;
  // Kept for the cards, which print the delta and the total separately.
  const extensionValuePerYear = newContractSalary - currentSalary;
  const totalNewValue = newContractSalary * (currentYears + EXTENSION_YEARS);

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
