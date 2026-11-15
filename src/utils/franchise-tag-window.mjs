/**
 * The franchise tag calendar, per TheLeague Constitution
 * (src/data/league-constitution.ts § PLAYER TAGS):
 *
 *   Tagging period: February 1 – February 14 at 8:45pm PT.
 *
 * A tag is DECLARED (queued) inside that window and WRITTEN to MFL on
 * February 15, as a 1-year contract at the queued value (Brandon,
 * 2026-11-15). February is always PST (UTC-8), so the instants are fixed
 * offsets.
 *
 * Plain .mjs so both the app (TypeScript) and the headless
 * `scripts/apply-pending-contracts.mjs` read the same dates.
 * `tests/franchise-tag-window.test.ts` pins them.
 */

const PST_OFFSET_HOURS = 8;

/** Feb 1, 12:00am PT of `year`. */
export function franchiseTagOpens(year) {
  return new Date(Date.UTC(year, 1, 1, PST_OFFSET_HOURS, 0));
}

/** Feb 14, 8:45pm PT of `year` — the league-year rollover. */
export function franchiseTagCloses(year) {
  return new Date(Date.UTC(year, 1, 14, 20 + PST_OFFSET_HOURS, 45));
}

/** Feb 15, 12:00am PT of `year`: when a tag queued that February is written. */
export function franchiseTagWriteDate(year) {
  return new Date(Date.UTC(year, 1, 15, PST_OFFSET_HOURS, 0));
}

/** True while an owner may declare a franchise tag. */
export function isFranchiseTagOpen(now = new Date()) {
  const year = now.getUTCFullYear();
  return now >= franchiseTagOpens(year) && now < franchiseTagCloses(year);
}

/** The next window that has not closed yet, for "tags open Feb 1" copy. */
export function nextFranchiseTagWindow(now = new Date()) {
  let year = now.getUTCFullYear();
  if (now >= franchiseTagCloses(year)) year += 1;
  return { opens: franchiseTagOpens(year), closes: franchiseTagCloses(year), writes: franchiseTagWriteDate(year) };
}

/**
 * True once a tag queued at `submittedAt` may be written to MFL: from the
 * first Feb 15 at or after it was queued. (A tag queued inside the window is
 * written that Feb 15; anything older that is somehow still pending waits for
 * the next one rather than landing mid-season.)
 */
export function isFranchiseTagWritable(submittedAt, now = new Date()) {
  const queued = new Date(submittedAt);
  if (Number.isNaN(queued.getTime())) return false;
  let writes = franchiseTagWriteDate(queued.getUTCFullYear());
  if (queued > writes) writes = franchiseTagWriteDate(queued.getUTCFullYear() + 1);
  return now >= writes;
}
