/**
 * CSV Exporter Utility
 * 
 * Exports auction predictor data to CSV format for external analysis.
 */

import type { PlayerValuation, TeamCapSituation } from '../types/auction-predictor';

/**
 * Convert string to CSV-safe format
 */
const safe = (str: string | number | undefined | null): string => {
  if (str === undefined || str === null) return '';
  const s = String(str).replace(/"/g, '""');
  return `"${s}"`;
};

/**
 * Export Players to CSV
 */
export function exportPlayersToCSV(
  players: PlayerValuation[], 
  playerPrices: Map<string, any>
): void {
  const headers = [
    'ID', 'Name', 'Position', 'Team', 'Age', 'Experience',
    'Dynasty Rank', 'Redraft Rank', 'Composite Rank',
    'Current Salary', 'Contract Status',
    'Predicted 1-Yr', 'Predicted 2-Yr', 'Predicted 3-Yr', 'Predicted 4-Yr', 'Predicted 5-Yr',
    'Recommendation', 'Value Gap %'
  ];

  const rows = players.map(p => {
    const pricing = playerPrices.get(p.id);
    const contracts = pricing?.contracts;
    const factors = pricing?.factors;
    
    return [
      p.id,
      p.name,
      p.position,
      p.team || 'FA',
      p.age,
      p.experience,
      p.dynastyRank || '',
      p.redraftRank || '',
      p.compositeRank || '',
      p.currentSalary,
      p.contractYearsRemaining > 0 ? `${p.contractYearsRemaining} yrs left` : 'Expiring',
      contracts?.oneYear || '',
      contracts?.twoYear || '',
      contracts?.threeYear || '',
      contracts?.fourYear || '',
      contracts?.fiveYear || '',
      contracts?.recommended?.reason || '',
      factors?.valueGapPercent ? `${factors.valueGapPercent.toFixed(1)}%` : ''
    ].map(safe).join(',');
  });

  downloadCSV([headers.join(','), ...rows].join('\n'), `auction-players-${getTimestamp()}.csv`);
}

/**
 * Export Teams to CSV
 */
export function exportTeamsToCSV(teams: TeamCapSituation[]): void {
  const headers = [
    'Franchise ID', 'Team Name', 'Window', 
    'Current Cap Space', 'Projected 2026 Space',
    'Committed Salary', 'Dead Money',
    'Expiring Contracts', 'Total Expiring Value',
    'Discretionary Spending', 'Min Roster Spend'
  ];

  const rows = teams.map(t => [
    t.franchiseId,
    t.teamName,
    // Note: Window would need to be passed in or joined if needed, skipping for now as it's separate state
    '', 
    t.currentCapSpace,
    t.projectedCapSpace2026,
    t.committedSalaries,
    t.deadMoney,
    t.expiringContracts.length,
    t.totalExpiringValue,
    t.discretionarySpending,
    t.estimatedMinimumRosterSpend
  ].map(safe).join(','));

  downloadCSV([headers.join(','), ...rows].join('\n'), `auction-teams-${getTimestamp()}.csv`);
}

function getTimestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
