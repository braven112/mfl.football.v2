/**
 * Client-side handler for the salary page Export to Excel button.
 * This file is imported as an Astro-processed <script> so Vite resolves imports.
 */
import { exportSalaryToXLSX } from '../utils/xlsx-exporter';

function initExportButton() {
  const configEl = document.getElementById('salary-config');
  if (!configEl) return;

  const { seasons, weeklyData, franchiseMeta } = JSON.parse(configEl.textContent ?? '{}');
  const exportBtn = document.getElementById('exportXlsxBtn') as HTMLButtonElement | null;
  if (!exportBtn) return;

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    try {
      // Read current selection from the dropdowns
      const seasonSelect = document.getElementById('salarySeasonSelect') as HTMLSelectElement | null;
      const weekSelect = document.getElementById('salaryWeekSelect') as HTMLSelectElement | null;
      const currentSeason = seasonSelect?.value ?? Object.keys(seasons).sort((a: string, b: string) => Number(b) - Number(a))[0];
      const currentWeek = weekSelect?.value ?? 'season';

      const summary = currentWeek === 'season'
        ? seasons?.[currentSeason]
        : weeklyData?.[currentSeason]?.[currentWeek];

      await exportSalaryToXLSX({
        season: currentSeason,
        week: currentWeek,
        summary: summary ?? {},
        franchiseMeta: franchiseMeta ?? {},
      });
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export to Excel';
    }
  });
}

initExportButton();
