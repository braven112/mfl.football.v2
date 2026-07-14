/**
 * Pure decision logic for the AFL keeper auto-finalize job.
 *
 * Kept side-effect free so tests/afl-keeper-finalize.test.ts can lock the
 * behavior in. All MFL/Redis I/O lives in scripts/afl-auto-finalize-keepers.mjs.
 */

export const KEEPER_LIMIT = 7;

/**
 * Parse an afl-keepers Redis hash field key: `{leagueId}:{year}:{franchiseId}`.
 * Returns null for anything that doesn't match the shape.
 */
export function parsePlanKey(key) {
  const m = /^(\d+):(\d{4}):(\d{4})$/.exec(String(key ?? ''));
  if (!m) return null;
  return { leagueId: m[1], year: Number(m[2]), franchiseId: m[3] };
}

/**
 * Decide what to do with one saved plan against the live roster.
 *
 * Mirrors the interactive Finalize flow's semantics (KeeperPlanner.astro):
 * cut every rostered player not in the keeper list. Two safety deviations,
 * because nobody is watching a cron run:
 *
 * - `skip-partial`: fewer than `limit` keepers saved. The UI disables the
 *   Finalize button in this state; auto-cutting around an unfinished line
 *   would strand the owner below their keeper allotment.
 * - `skip-missing-keepers`: a saved keeper is no longer on the live roster
 *   (trade/drop since the plan was saved). The plan is stale — executing it
 *   would keep fewer than `limit` players. Flag for a human instead.
 *
 * @returns {{ action: 'skip-partial'|'skip-missing-keepers'|'already-finalized'|'cut',
 *             cuts: string[], missingKeepers: string[] }}
 */
export function decidePlanAction({ keepers, rosterIds, limit = KEEPER_LIMIT }) {
  const keeperList = Array.isArray(keepers) ? keepers.map(String) : [];
  const roster = Array.isArray(rosterIds) ? rosterIds.map(String) : [];
  const keeperSet = new Set(keeperList);

  if (keeperList.length < limit) {
    return { action: 'skip-partial', cuts: [], missingKeepers: [] };
  }

  const missingKeepers = keeperList.filter((id) => !roster.includes(id));
  if (missingKeepers.length > 0) {
    return { action: 'skip-missing-keepers', cuts: [], missingKeepers };
  }

  const cuts = roster.filter((id) => !keeperSet.has(id));
  if (cuts.length === 0) {
    return { action: 'already-finalized', cuts: [], missingKeepers: [] };
  }

  return { action: 'cut', cuts, missingKeepers: [] };
}

/**
 * Resolve the AFL keeper deadline instant for a given year from the league
 * events file (data/afl-fantasy/league-events.json). The deadline is a fixed
 * July date, which is always PDT (UTC-7) — same fixed-offset approach as
 * getAflLeagueYear() in src/utils/league-year.ts.
 */
export function resolveKeeperDeadline(events, year) {
  const event = (events ?? []).find((e) => e?.id === 'afl-keeper-deadline');
  const start = event?.startDate;
  if (!start || start.type !== 'fixed') {
    throw new Error('afl-keeper-deadline event with a fixed startDate not found in league-events.json');
  }
  const [hh, mm] = String(start.time ?? '00:00').split(':').map(Number);
  return new Date(Date.UTC(year, start.month - 1, start.day, hh + 7, mm, 0, 0));
}

/**
 * Gate for the cron: only act between the deadline and `graceDays` after it.
 * The window keeps a stray manual run months later from executing a
 * long-forgotten plan; --force in the script bypasses this.
 */
export function isWithinAutoFinalizeWindow(now, deadline, { graceDays = 5 } = {}) {
  const start = deadline.getTime();
  const end = start + graceDays * 24 * 60 * 60 * 1000;
  const ts = now.getTime();
  return ts >= start && ts <= end;
}
