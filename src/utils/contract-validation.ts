/**
 * Contract Validation Utilities
 * Validates contract years against league rules and submission windows
 */

import type { ContractValidationResult, ContractValidationError } from '../types/contracts';
import type { DeclarationType } from '../types/contract-eligibility';

/**
 * Get the Pacific Time UTC offset in hours for a given month.
 * PDT (UTC-7): March second Sunday through November first Sunday
 * PST (UTC-8): November first Sunday through March second Sunday
 *
 * For window boundary checks, we only need month-level accuracy
 * since boundaries fall well within DST or standard periods.
 */
function pacificOffsetForMonth(month: number): number {
  // March (partially), Apr-Oct are PDT (UTC-7); Nov-Feb, early March are PST (UTC-8)
  // Feb 15 is always PST; Aug 3rd Sunday is always PDT; Sept 1 is always PDT
  return (month >= 3 && month <= 10) ? 7 : 8;
}

/**
 * Create a Date representing a specific Pacific Time moment as UTC.
 * Converts "hour in PT" → correct UTC instant.
 */
function pacificDate(year: number, month: number, day: number, hour = 0, min = 0, sec = 0, ms = 0): Date {
  const offset = pacificOffsetForMonth(month);
  return new Date(Date.UTC(year, month, day, hour + offset, min, sec, ms));
}

/**
 * Calculate the 3rd Sunday in August for the current year at 8:45 PM PT.
 * Used for the offseason contract deadline.
 */
function getThirdSundayInAugust(year: number): Date {
  const august1DayOfWeek = new Date(Date.UTC(year, 7, 1)).getUTCDay();
  const daysToFirstSunday = (7 - august1DayOfWeek) % 7 || 7;
  const thirdSundayDay = 1 + daysToFirstSunday + 14;

  // August is always PDT (UTC-7): 8:45 PM PT = 3:45 AM+1 UTC
  return pacificDate(year, 7, thirdSundayDay, 20, 45, 0, 0);
}

/**
 * Get the current year in Pacific Time.
 */
function getPacificYear(now: Date): number {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric' }).format(now));
}

/**
 * Check if current date is within offseason contract setting window
 * Offseason: February 15 midnight PT - 3rd Sunday in August at 8:45pm PT
 */
function isInOffseasonWindow(now: Date = new Date()): boolean {
  const ptYear = getPacificYear(now);

  // Feb 15 at midnight PT (always PST = UTC-8)
  const seasonStart = pacificDate(ptYear, 1, 15);

  // 3rd Sunday in August at 8:45 PM PT (always PDT = UTC-7)
  const seasonEnd = getThirdSundayInAugust(ptYear);

  return now >= seasonStart && now <= seasonEnd;
}

/**
 * Check if current date is within in-season window (Weeks 1-17)
 * In-season: Sept 1 - Feb 14 (all boundaries in Pacific Time)
 */
function isInSeasonWindow(now: Date = new Date()): boolean {
  const ptYear = getPacificYear(now);

  // Sept 1 at midnight PT (always PDT = UTC-7)
  const seasonStartDate = pacificDate(ptYear, 8, 1);
  // Feb 14 at 11:59:59 PM PT next year (always PST = UTC-8)
  const seasonEndDate = pacificDate(ptYear + 1, 1, 14, 23, 59, 59, 999);

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
  const ALLOWED_LEAGUES = ['13522', '18202', '36189'];
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
  options: {
    type?: DeclarationType;
    currentContractInfo?: string;
    now?: Date;
  } = {},
): ContractValidationResult {
  const { type, currentContractInfo, now = new Date() } = options;
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
  const windowStatus = getContractWindow(now);

  if (type === 'team-option') {
    if (currentContractInfo !== 'TO') {
      errors.push({
        field: 'contractInfo',
        message: 'Team option is only available for TO contracts',
      });
    }

    if (oldYears < 2) {
      errors.push({
        field: 'contractYears',
        message: 'Team option must be exercised before the player begins Year 4',
      });
    }
  } else if (!windowStatus.inWindow) {
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
