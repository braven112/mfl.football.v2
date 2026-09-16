/**
 * Row and error classification for the Schefter pending-trade lane
 * (scripts/schefter-scan.mjs#scanPendingTrades). Lives in its own module
 * because the scanner runs on import and cannot be loaded by a test.
 */

/**
 * A row from the commissioner's approval queue: an ACCEPTED trade waiting on
 * the commish. MFL's owner view of an open PROPOSAL has a different shape
 * (`will_give_up` / `will_receive` / `offeredto`). This lane announces a deal
 * as nearly done, so an open proposal must never reach it. The scanner's
 * fallback read (the commissioner's own view) can return the commish's own
 * proposals too, and this filter is what keeps them out.
 */
export function isApprovalQueueRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.will_give_up !== undefined || row.will_receive !== undefined || row.offeredto !== undefined) return false;
  return Boolean(row.franchise && row.franchise2 &&
    (row.franchise1_gave_up !== undefined || row.franchise2_gave_up !== undefined));
}

/** MFL refused a FRANCHISE_ID impersonation because commissioner lockout is on. */
export function isLockoutImpersonationError(error) {
  const msg = JSON.stringify(error ?? '');
  return /impersonate/i.test(msg) && /lockout/i.test(msg);
}
