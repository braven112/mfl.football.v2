/**
 * Cap Space Calculator for 2026 Season
 * 
 * Calculates projected cap space for each team considering:
 * - 10% annual salary escalations
 * - Contract expirations
 * - Dead money
 * - Franchise tag implications
 */

import type { TeamCapSituation, ContractEscalation, PlayerValuation } from '../types/auction-predictor';

const SALARY_CAP = 45_000_000;
const ANNUAL_ESCALATION = 0.10; // 10% per year
const LEAGUE_MINIMUM = 425_000;
const MIN_ROSTER_SIZE = 20;
const MAX_ROSTER_SIZE = 22;

interface RosterPlayer {
  id: string;
  name: string;
  position: string;
  salary: number;
  contractYear: string; // "1", "2", etc.
  franchiseId: string;
  status: 'ROSTER' | 'INJURED_RESERVE' | 'TAXI_SQUAD';
  team: string;
  age?: number;
}

interface SalaryAdjustment {
  franchiseId: string;
  amount: number;
  description: string;
}

/**
 * Calculate salary with annual escalation
 */
export function calculateEscalatedSalary(
  baseSalary: number,
  yearsFromNow: number
): number {
  return Math.round(baseSalary * Math.pow(1 + ANNUAL_ESCALATION, yearsFromNow));
}

/**
 * Generate full contract escalation schedule
 */
export function generateContractSchedule(
  playerId: string,
  baseSalary: number,
  contractYears: number,
  startYear: number = 2026
): ContractEscalation {
  const yearlySchedule = [];
  let totalValue = 0;
  
  for (let i = 0; i < contractYears; i++) {
    const salary = calculateEscalatedSalary(baseSalary, i);
    totalValue += salary;
    
    yearlySchedule.push({
      year: startYear + i,
      salary,
      capHit: salary, // In this league, cap hit = salary
    });
  }
  
  return {
    playerId,
    baseYear: startYear,
    baseSalary,
    contractYears,
    yearlySchedule,
    totalContractValue: totalValue,
    averageAnnualValue: Math.round(totalValue / contractYears),
  };
}

/**
 * Calculate 2026 cap hit for a player with an existing contract
 */
export function calculate2026CapHit(
  currentSalary: number,
  contractYearsRemaining: number,
  status: 'ROSTER' | 'INJURED_RESERVE' | 'TAXI_SQUAD'
): number {
  // Contracts expire on Feb 15, reducing by one year
  const yearsRemainingIn2026 = contractYearsRemaining - 1;
  
  // If contract expired, no cap hit
  if (yearsRemainingIn2026 <= 0) {
    return 0;
  }
  
  // Salary escalates 10% on Feb 15
  const escalatedSalary = calculateEscalatedSalary(currentSalary, 1);
  
  // Taxi squad counts as 50% cap hit
  if (status === 'TAXI_SQUAD') {
    return Math.round(escalatedSalary * 0.5);
  }
  
  // Roster and IR count as 100% cap hit
  return escalatedSalary;
}

/**
 * Calculate franchise tag salary for a position
 */
export function calculateFranchiseTagSalary(
  position: string,
  salaryAverages: any
): number {
  const positionData = salaryAverages.positions[position];
  if (!positionData) {
    return LEAGUE_MINIMUM;
  }
  
  // Franchise tag = average of top 3 salaries at position
  return Math.round(positionData.top3Average);
}

/**
 * Identify players with expiring contracts
 */
export function identifyExpiringContracts(
  players: RosterPlayer[]
): RosterPlayer[] {
  return players.filter(player => {
    const contractYear = parseInt(player.contractYear, 10);
    // Contract year 1 means it expires after this season
    return contractYear === 1;
  });
}

/**
 * Calculate team's projected 2026 cap space
 */
export function calculateTeamCapSpace(
  franchiseId: string,
  teamName: string,
  players: RosterPlayer[],
  deadMoney: number = 0,
  franchiseTagSalary: number = 0
): TeamCapSituation {
  // Filter players for this team
  const teamPlayers = players.filter(p => p.franchiseId === franchiseId);
  
  // Identify expiring contracts
  const expiringContracts = identifyExpiringContracts(teamPlayers);
  const totalExpiringValue = expiringContracts.reduce((sum, p) => sum + p.salary, 0);
  
  // Calculate 2026 cap commitments (players with contracts)
  let committedSalaries = 0;
  const playersUnderContract = teamPlayers.filter(p => {
    const yearsRemaining = parseInt(p.contractYear, 10);
    if (yearsRemaining <= 1) return false; // Expiring
    
    const capHit = calculate2026CapHit(p.salary, yearsRemaining, p.status);
    committedSalaries += capHit;
    return true;
  });
  
  // Total committed = salaries + dead money + franchise tag
  const totalCommitted = committedSalaries + deadMoney + franchiseTagSalary;
  
  // Available cap space
  const projectedCapSpace2026 = SALARY_CAP - totalCommitted;
  
  // How many roster spots need to be filled?
  const currentRosterSize = playersUnderContract.length + (franchiseTagSalary > 0 ? 1 : 0);
  const spotsToFill = Math.max(0, MIN_ROSTER_SIZE - currentRosterSize);
  
  // Minimum spend = league minimum × spots to fill
  const estimatedMinimumRosterSpend = spotsToFill * LEAGUE_MINIMUM;
  
  // Discretionary spending = cap space - minimum roster spend
  const discretionarySpending = Math.max(0, projectedCapSpace2026 - estimatedMinimumRosterSpend);
  
  // Analyze positional needs
  const positionalNeeds = analyzePositionalNeeds(playersUnderContract, franchiseTagSalary > 0);
  
  return {
    franchiseId,
    teamName,
    currentCapSpace: 0, // Would need current season data
    projectedCapSpace2026,
    committedSalaries,
    deadMoney,
    expiringContracts: expiringContracts.map(p => ({
      id: p.id,
      name: p.name,
      position: p.position as any,
      team: p.team,
      currentSalary: p.salary,
      contractYearsRemaining: 1,
      franchiseId: p.franchiseId,
      isExpiring: true,
      isFranchiseTagCandidate: true,
      franchiseTagProbability: 0, // Will be calculated later
      age: p.age || 25,
      experience: 5, // Would need actual data
    })),
    totalExpiringValue,
    franchiseTagCommitment: franchiseTagSalary,
    availableAfterTag: projectedCapSpace2026,
    estimatedMinimumRosterSpend,
    discretionarySpending,
    positionalNeeds,
  };
}

/**
 * Analyze team's positional needs based on current roster
 */
function analyzePositionalNeeds(
  playersUnderContract: RosterPlayer[],
  hasTaggedPlayer: boolean
): TeamCapSituation['positionalNeeds'] {
  const positions = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
  const needs = [];
  
  // Count players by position
  const positionCounts = positions.reduce((acc, pos) => {
    acc[pos] = playersUnderContract.filter(p => p.position === pos).length;
    return acc;
  }, {} as Record<string, number>);
  
  // Define ideal depth by position
  const idealDepth: Record<string, number> = {
    QB: 2,
    RB: 6,
    WR: 8,
    TE: 3,
    PK: 1,
    DEF: 1,
  };
  
  for (const position of positions) {
    const currentDepth = positionCounts[position] || 0;
    const targetDepth = idealDepth[position];
    const deficit = targetDepth - currentDepth;
    
    let priority: 'critical' | 'high' | 'medium' | 'low' = 'low';
    
    if (deficit >= 3) priority = 'critical';
    else if (deficit >= 2) priority = 'high';
    else if (deficit >= 1) priority = 'medium';
    
    needs.push({
      position,
      priority,
      currentDepth,
      targetAcquisitions: Math.max(0, deficit),
    });
  }
  
  return needs.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Calculate league-wide cap space and market dynamics
 */
export function calculateLeagueWideCapSpace(
  allPlayers: RosterPlayer[],
  deadMoneyByTeam: Map<string, number>,
  salaryAverages: any,
  teams: Array<{ franchiseId: string; name: string }>
): {
  teamCapSituations: TeamCapSituation[];
  totalAvailableCap: number;
  averageCapPerTeam: number;
} {
  const teamCapSituations: TeamCapSituation[] = [];
  let totalAvailableCap = 0;
  
  for (const team of teams) {
    const deadMoney = deadMoneyByTeam.get(team.franchiseId) || 0;
    
    // Calculate without franchise tag first
    const capSituation = calculateTeamCapSpace(
      team.franchiseId,
      team.name,
      allPlayers,
      deadMoney,
      0
    );
    
    teamCapSituations.push(capSituation);
    totalAvailableCap += capSituation.discretionarySpending;
  }
  
  return {
    teamCapSituations,
    totalAvailableCap,
    averageCapPerTeam: totalAvailableCap / teams.length,
  };
}

/**
 * Load dead money from salary adjustments file
 */
export function loadDeadMoney(salaryAdjustments: any[]): Map<string, number> {
  const deadMoneyMap = new Map<string, number>();
  
  for (const adjustment of salaryAdjustments) {
    const current = deadMoneyMap.get(adjustment.franchiseId) || 0;
    deadMoneyMap.set(adjustment.franchiseId, current + adjustment.amount);
  }
  
  return deadMoneyMap;
}
