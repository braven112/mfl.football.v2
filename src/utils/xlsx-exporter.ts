/**
 * XLSX Exporter Utility
 *
 * Exports salary analytics data to Excel format.
 * Uses dynamic import to lazy-load SheetJS only when the user clicks Export.
 */

interface TopPlayer {
  id: string;
  name: string;
  salary: number;
  franchiseId: string;
}

interface PositionData {
  totalPlayers: number;
  top3Average: number;
  top5Average: number;
  starterAverage?: number;
  starterMedian?: number;
  starterCount?: number;
  averageSalary?: number;
  medianSalary?: number;
  topPlayers: TopPlayer[];
}

interface SalaryMetadata {
  leagueId?: string;
  season?: string;
  week?: number;
  generatedAt?: string;
}

interface SalarySummary {
  metadata?: SalaryMetadata;
  positions?: Record<string, PositionData>;
}

interface FranchiseInfo {
  name?: string;
  icon?: string;
}

interface ExportOptions {
  season: string;
  week: string;
  summary: SalarySummary;
  franchiseMeta: Record<string, FranchiseInfo>;
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'Def'];

function getTimestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildSummaryRows(positions: Record<string, PositionData>) {
  return POSITION_ORDER
    .filter((pos) => positions[pos])
    .map((pos) => {
      const d = positions[pos];
      return {
        Position: pos,
        'Total Players': d.totalPlayers,
        'Franchise Tag (Top 3 Avg)': d.top3Average,
        'Extension (Top 5 Avg)': d.top5Average,
        'Starter Average': d.starterAverage ?? null,
        'Starter Median': d.starterMedian ?? null,
        'Starter Count': d.starterCount ?? null,
        'Average Salary': d.averageSalary ?? null,
        'Median Salary': d.medianSalary ?? null,
      };
    });
}

const POSITION_LABELS: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  PK: 'PK',
  Def: 'Def',
};

function buildPositionPlayerRows(
  players: TopPlayer[],
  franchiseMeta: Record<string, FranchiseInfo>
) {
  return players.map((player, i) => {
    const franchise = franchiseMeta[player.franchiseId];
    return {
      Rank: i + 1,
      Player: player.name,
      Salary: player.salary,
      Team: franchise?.name ?? player.franchiseId ?? '',
    };
  });
}

function formatWeekLabel(week: string): string {
  if (week === 'season') return 'Season Total';
  if (week.startsWith('off-')) return `Off Season Week ${week.slice(4)}`;
  return `Week ${week}`;
}

export async function exportSalaryToXLSX(options: ExportOptions): Promise<void> {
  const XLSX = await import('xlsx');
  const { season, week, summary, franchiseMeta } = options;
  const positions = summary.positions ?? {};

  const wb = XLSX.utils.book_new();

  // Sheet 1: Position Summary
  const summaryData = buildSummaryRows(positions);
  const summarySheet = XLSX.utils.json_to_sheet(summaryData);

  // Set column widths for readability
  summarySheet['!cols'] = [
    { wch: 10 }, // Position
    { wch: 14 }, // Total Players
    { wch: 22 }, // Franchise Tag
    { wch: 22 }, // Extension
    { wch: 16 }, // Starter Average
    { wch: 16 }, // Starter Median
    { wch: 14 }, // Starter Count
    { wch: 16 }, // Average Salary
    { wch: 16 }, // Median Salary
  ];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Position Summary');

  // One sheet per position
  for (const pos of POSITION_ORDER) {
    const data = positions[pos];
    if (!data?.topPlayers?.length) continue;
    const rows = buildPositionPlayerRows(data.topPlayers, franchiseMeta);
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [
      { wch: 6 },  // Rank
      { wch: 28 }, // Player
      { wch: 16 }, // Salary
      { wch: 24 }, // Team
    ];
    XLSX.utils.book_append_sheet(wb, sheet, POSITION_LABELS[pos] ?? pos);
  }

  const weekLabel = formatWeekLabel(week);
  const filename = week === 'season'
    ? `salary-analytics-${season}-${getTimestamp()}.xlsx`
    : `salary-analytics-${season}-${week}-${getTimestamp()}.xlsx`;

  XLSX.writeFile(wb, filename);
}
