/**
 * The before → after terms of a filed contract, in one implementation the app
 * AND the headless Schefter scanner read (Brandon, 2026-11-15: every
 * declaration keeps the contract it replaced beside the one it asked for, so a
 * mistake can be traced and the change can be reported).
 *
 * Plain .mjs so `scripts/` can import it under node; the app reaches it through
 * `contract-record.ts` (types) and `contract-actions-client.ts`
 * (`formatSalaryCompact`). `tests/contract-record.test.ts` pins the strings.
 */

/**
 * Compact currency, for a chip or a modal line.
 * @param {unknown} val
 * @returns {string}
 */
export function formatSalaryCompact(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

/** @param {number | null | undefined} n */
const yearsLabel = (n) => `${Number(n) || 0} ${Number(n) === 1 ? 'yr' : 'yrs'}`;

/**
 * @param {number | null | undefined} salary
 * @param {number | null | undefined} years
 * @param {string | null | undefined} info
 */
function terms(salary, years, info) {
  const parts = [];
  if (salary != null && Number(salary) > 0) parts.push(formatSalaryCompact(salary));
  parts.push(yearsLabel(years));
  const tag = String(info ?? '').trim();
  if (tag) parts.push(tag);
  return parts.join(' · ');
}

/**
 * `{ before, after }` for one declaration. The requested salary falls back to
 * the current one, as the MFL write does (`requestedSalary ?? currentSalary`);
 * a requested designation of '' is a real answer (an RC or TO removed), so
 * only a missing one falls back. Salary is shown only when the declaration
 * recorded it: a "Contract Years" declaration on a new pickup changes years
 * alone.
 *
 * @param {{
 *   currentYears?: number | null, currentSalary?: number | null, currentContractInfo?: string | null,
 *   requestedYears?: number | null, requestedSalary?: number | null, requestedContractInfo?: string | null,
 * }} d
 * @param {{ designation?: boolean }} [opts] `designation: false` leaves the
 *   MFL contract letters (E, F, RC, TO) out — Schefter's copy, where a bare
 *   "F" reads as noise.
 * @returns {{ before: string, after: string }}
 */
export function contractTermsChange(d, { designation = true } = {}) {
  const afterSalary = d.requestedSalary ?? d.currentSalary;
  const afterInfo = d.requestedContractInfo !== undefined && d.requestedContractInfo !== null
    ? d.requestedContractInfo
    : d.currentContractInfo;
  return {
    before: terms(d.currentSalary, d.currentYears, designation ? d.currentContractInfo : ''),
    after: terms(afterSalary, d.requestedYears, designation ? afterInfo : ''),
  };
}
