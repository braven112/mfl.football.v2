/**
 * Contract Validation Utilities
 * Validates contract years against league rules and submission windows
 */

import type { ContractValidationResult, ContractValidationError } from '../types/contracts';

// League season starts on February 15th
const SEASON_START_MONTH = 2; // February (0-indexed would be 1, but JS uses 0-indexed, so 2 for March would be 2... actually Feb is 1)
const SEASON_START_DAY = 15;

/**
 * Calculate the 3rd Sunday in August for the current year
 * Used for the offseason contract deadline
 */
function getThirdSundayInAugust(year: number): Date {
  const august1 = new Date(year, 7, 1); // August is month 7 (0-indexed)
  let dayOfWeek = august1.getDay();

  // Calculate first Sunday
  const daysToFirstSunday = (7 - dayOfWeek) % 7 || 7;
  const firstSunday = new Date(year, 7, 1 + daysToFirstSunday);

  // Third Sunday is 2 weeks later
  const thirdSunday = new Date(firstSunday);
  thirdSunday.setDate(thirdSunday.getDate() + 14);

  // Set to 8:45 PM PT
  thirdSunday.setHours(20, 45, 0, 0);

  return thirdSunday;
}

/**
 * Check if current date is within offseason contract setting window
 * Offseason: February 15 - 3rd Sunday in August (or 3 weeks before first Sunday game, whichever is later) at 8:45pm PT
 */
function isInOffseasonWindow(now: Date = new Date()): boolean {
  const year = now.getFullYear();

  // Season start: February 15 at midnight PT
  const seasonStart = new Date(year, 1, 15, 0, 0, 0, 0); // Month 1 is February

  // Season end: 3rd Sunday in August at 8:45 PM PT
  const seasonEnd = getThirdSundayInAugust(year);

  return now >= seasonStart && now <= seasonEnd;
}

/**
 * Check if current date is within in-season window (Weeks 1-17)
 * For this simplified version, we'll assume in-season is Sept 1 - Feb 14
 * In production, you'd want to tie this to actual NFL schedule
 */
function isInSeasonWindow(now: Date = new Date()): boolean {
  const year = now.getFullYear();

  // In-season roughly: September 1 - February 14 (before season restarts)
  const seasonStartDate = new Date(year, 8, 1, 0, 0, 0, 0); // Sept 1
  const seasonEndDate = new Date(year + 1, 1, 14, 23, 59, 59, 999); // Feb 14 next year

  return now >= seasonStartDate && now <= seasonEndDate;
}

/**
 * Determine if we're currently in a valid contract setting window
 */
export function getContractWindow(now: Date = new Date()): {
  inWindow: boolean;
  windowType?: 'offseason' | 'in-season';
  reason?: string;
} {
  if (isInOffseasonWindow(now)) {
    return {
      inWindow: true,
      windowType: 'offseason',
    };
  }

  if (isInSeasonWindow(now)) {
    return {
      inWindow: true,
      windowType: 'in-season',
    };
  }

  return {
    inWindow: false,
    reason: 'Contract setting is only allowed during offseason (Feb 15 - 3rd Sunday in Aug) or in-season (Weeks 1-17)',
  };
}

/**
 * Validate contract years
 */
function validateContractYears(newYears: number): ContractValidationError[] {
  const errors: ContractValidationError[] = [];

  if (!Number.isInteger(newYears)) {
    errors.push({
      field: 'contractYears',
      message: 'Contract years must be a whole number',
    });
  }

  if (newYears < 1) {
    errors.push({
      field: 'contractYears',
      message: 'Contract years must be at least 1',
    });
  }

  if (newYears > 5) {
    errors.push({
      field: 'contractYears',
      message: 'Contract years cannot exceed 5',
    });
  }

  return errors;
}

/**
 * Validate league ID
 * Currently accepts league 13522 (The League) and 18202 (test)
 */
function validateLeagueId(leagueId: string): ContractValidationError[] {
  const errors: ContractValidationError[] = [];

  // Allow both production league and test league
  const ALLOWED_LEAGUES = ['13522', '18202'];
  if (!ALLOWED_LEAGUES.includes(leagueId)) {
    errors.push({
      field: 'leagueId',
      message: `Contract management is only available for leagues: ${ALLOWED_LEAGUES.join(', ')}`,
    });
  }

  return errors;
}

/**
 * Complete validation of contract submission
 */
export function validateContractSubmission(
  leagueId: string,
  oldYears: number,
  newYears: number,
  playerId: string,
  franchiseId: string,
): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  // Validate league
  errors.push(...validateLeagueId(leagueId));

  // Validate required fields
  if (!playerId || !franchiseId) {
    errors.push({
      field: 'player',
      message: 'Player and franchise information is required',
    });
  }

  // Validate that we're changing the contract
  if (oldYears === newYears) {
    errors.push({
      field: 'contractYears',
      message: 'New contract years must be different from current contract years',
    });
  }

  // Validate new contract years
  errors.push(...validateContractYears(newYears));

  // Check if in valid window
  const windowStatus = getContractWindow();

  if (!windowStatus.inWindow) {
    errors.push({
      field: 'window',
      message: windowStatus.reason || 'Contract setting window is not currently open',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    windowStatus,
  };
}
