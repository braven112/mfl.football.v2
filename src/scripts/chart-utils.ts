/**
 * Chart rendering utilities for donut/pie charts
 * Uses CSS conic-gradient for rendering, no external dependencies
 */

/**
 * Chart slice data structure
 */
export interface ChartSlice {
  /** Display label for the slice */
  label: string;
  /** Numeric value (dollar amount, count, etc.) */
  value: number;
  /** Hex color code for the slice */
  color: string;
}

/**
 * Build a donut chart using CSS conic-gradient
 * @param element - DOM element to render the chart into
 * @param slices - Array of chart slices
 * @param total - Total value for percentage calculation (if not provided, calculates from slices)
 */
export function buildDonut(
  element: HTMLElement | null,
  slices: ChartSlice[] = [],
  total?: number
): void {
  if (!element) return;

  // Calculate total if not provided
  const computedTotal = total ?? slices.reduce((sum, slice) => sum + slice.value, 0);

  // Guard: invalid total or no slices
  if (!computedTotal || computedTotal <= 0 || !slices.length) {
    element.style.background = 'conic-gradient(#e2e8f0 0deg, #e2e8f0 360deg)';
    return;
  }

  // Filter out zero-value slices
  const validSlices = slices.filter((s) => s.value > 0);

  if (!validSlices.length) {
    element.style.background = 'conic-gradient(#e2e8f0 0deg, #e2e8f0 360deg)';
    return;
  }

  // Build conic-gradient segments
  let start = 0;
  const gradientParts = validSlices.map((slice) => {
    const angle = (slice.value / computedTotal) * 360;
    const end = start + angle;
    const gradient = `${slice.color} ${start}deg ${end}deg`;
    start = end;
    return gradient;
  });

  // Apply the conic-gradient background
  element.style.background = `conic-gradient(${gradientParts.join(', ')})`;
}

/**
 * Render a legend list for chart slices
 * @param element - DOM element to render the legend into
 * @param slices - Array of chart slices
 * @param formatter - Optional formatter function for values (defaults to localized number)
 */
export function renderLegend(
  element: HTMLElement | null,
  slices: ChartSlice[] = [],
  formatter?: (value: number) => string
): void {
  if (!element) return;

  // Clear if no slices
  if (!slices.length) {
    element.innerHTML = '';
    return;
  }

  // Default formatter: localized number
  const defaultFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  const formatValue = formatter ?? ((v: number) => defaultFormatter.format(v));

  // Build legend HTML
  const legendHTML = slices
    .map(
      (slice) => `
      <div class="chart-legend__item">
        <span class="chart-legend__label">
          <span class="legend-dot" style="background:${slice.color}"></span>
          ${slice.label}
        </span>
        <span class="chart-legend__value">${formatValue(slice.value)}</span>
      </div>
    `
    )
    .join('');

  element.innerHTML = legendHTML;
}

/**
 * Render both chart and legend together
 * Convenience function for common use case
 * @param chartElement - DOM element for the chart
 * @param legendElement - DOM element for the legend (optional)
 * @param slices - Array of chart slices
 * @param formatter - Optional formatter for legend values
 */
export function renderChartWithLegend(
  chartElement: HTMLElement | null,
  legendElement: HTMLElement | null,
  slices: ChartSlice[] = [],
  formatter?: (value: number) => string
): void {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  buildDonut(chartElement, slices, total);
  if (legendElement) {
    renderLegend(legendElement, slices, formatter);
  }
}

/**
 * Build a horizontal bar chart
 * @param element - DOM element to render the chart into
 * @param slices - Array of chart slices
 * @param positionOrder - Order in which to display positions (e.g., ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'])
 * @param total - Total value for percentage calculation
 */
export function buildBarChart(
  element: HTMLElement | null,
  slices: ChartSlice[] = [],
  positionOrder: string[] = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'],
  total?: number
): void {
  if (!element) return;

  // Calculate total if not provided
  const computedTotal = total ?? slices.reduce((sum, slice) => sum + slice.value, 0);

  // Guard: invalid total or no slices
  if (!computedTotal || computedTotal <= 0 || !slices.length) {
    element.innerHTML = '';
    return;
  }

  // Create a map of position -> slice for quick lookup
  const sliceMap = new Map<string, ChartSlice>();
  slices.forEach((slice) => {
    sliceMap.set(slice.label.toUpperCase(), slice);
  });

  // Build bars in the specified order, only including positions in positionOrder
  const orderedBars = positionOrder
    .map((pos) => sliceMap.get(pos.toUpperCase()))
    .filter((slice): slice is ChartSlice => slice !== undefined && slice.value > 0);

  // Default currency formatter
  const defaultFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  // Build bar HTML
  const barsHTML = orderedBars
    .map((slice) => {
      const percentage = (slice.value / computedTotal) * 100;
      return `
        <div class="bar-item">
          <div class="bar-label">
            <span class="bar-label-position">${slice.label}</span>
            <span class="bar-label-value">${defaultFormatter.format(slice.value)}</span>
          </div>
          <div class="bar-fill" style="width: ${percentage}%; background-color: ${slice.color};"></div>
        </div>
      `;
    })
    .join('');

  element.innerHTML = barsHTML;
}
