/**
 * Franchise-id normalization shared by app code (.ts/.astro) and node
 * scripts — plain JS for the same dual-consumer reason as
 * august-cut-selection-core.mjs.
 *
 * Matches auth.ts's franchise normalization so '1' and '0001' address the
 * same records (Redis keys, roster maps, report cards). Non-numeric input
 * is passed through trimmed, never padded.
 */
export function normalizeFranchiseId(franchiseId) {
  const trimmed = `${franchiseId ?? ''}`.trim();
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
}
