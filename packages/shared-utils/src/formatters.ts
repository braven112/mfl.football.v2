/**
 * Formatting utilities for currency, numbers, and display values
 */

/**
 * Safely parse any value to a number
 * @param value - Value to parse (number, string, or other)
 * @returns Parsed number or 0 if invalid
 */
export const parseNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

/**
 * Intl.NumberFormat instance for USD currency formatting
 */
export const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/**
 * Format a number as USD currency
 * @param value - Number to format
 * @returns Formatted currency string (e.g., "$1,234,567")
 */
export const formatCurrency = (value: number): string => {
  return currencyFormatter.format(value);
};

/**
 * Format cap space in a compact display format
 * - Values >= $1M: "$X.X million" (always 1 decimal for precision)
 * - Values < $1M: "$XXX,XXX"
 * @param value - Cap space amount
 * @returns Formatted cap space string
 */
export const formatCapSpaceDisplay = (value = 0): string => {
  if (!Number.isFinite(value)) return currencyFormatter.format(0);
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `$${millions.toFixed(1)} million`;
  }
  return currencyFormatter.format(value);
};

/**
 * Format a percentage value
 * @param value - Decimal value (0.75 = 75%)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string (e.g., "75.0%")
 */
export const formatPercentage = (value: number, decimals = 1): string => {
  return `${(value * 100).toFixed(decimals)}%`;
};

/**
 * Format a number with commas as thousands separators
 * @param value - Number to format
 * @returns Formatted number string (e.g., "1,234,567")
 */
export const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value);
};

/**
 * Compact number formatter for large values
 * - 1,500,000 → "1.5M"
 * - 25,000 → "25K"
 * - 500 → "500"
 */
export const formatCompactNumber = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }
  return String(value);
};
