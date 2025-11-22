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
