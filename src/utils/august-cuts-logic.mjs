/**
 * August cuts — pure decision logic for the deadline execution job.
 *
 * Extracted from scripts/apply-august-cuts.mjs so the gated parts are
 * unit-testable without network or Redis (tests/apply-august-cuts.test.ts):
 * auto-mode selection from dates, per-franchise resumability decisions,
 * done-hash bookkeeping, and snapshot shaping.
 *
 * Never-early philosophy: reuses shouldFireReminder from
 * roger-reminder-window.mjs — a touch fires on its target day or one day
 * late (catch-up), NEVER early, and the live run fires only at/after the
 * deadline instant.
 */

import { shouldFireReminder } from '../../scripts/lib/roger-reminder-window.mjs';

/** Max execution attempts per franchise before it's left for the commissioner.
 * Raised from 3 → 8: the per-cut guards (already-gone detection, transaction
 * cross-check, verify-before-advance) make a retry cheap and idempotent, so a
 * transient MFL outage at 8:45 PM PT shouldn't exhaust a franchise in 45
 * minutes (3 ticks). 8 ticks buys two hours of catch-up. */
export const MAX_ATTEMPTS = 8;

/**
 * Done-hash sentinel for a franchise skipped because its owner has no usable
 * stored credential. It is DELIBERATELY NOT a `failed:<n>` value: a missing
 * credential is not a failed attempt — the owner just needs to log in once,
 * which recaptures the cookie and heals it on the very next tick. Tracking it
 * distinctly (rather than burning toward MAX_ATTEMPTS) means the franchise is
 * re-checked every tick for the rest of the run instead of exhausting.
 */
export const SKIPPED_NO_CRED = 'skipped-no-cred';

/**
 * The --auto touch schedule, closest-to-deadline first (priority order when
 * a missed touch's catch-up window overlaps a later touch's target day):
 *   T-7 / T-2 → --validate-only (credential checks + GroupMe nags)
 *   T-1       → --rehearse (full run minus MFL writes)
 *   ≥ deadline → live
 */
export const AUTO_TOUCHES = [
  { mode: 'rehearse', targetDays: 1 },
  { mode: 'validate-only', targetDays: 2 },
  { mode: 'validate-only', targetDays: 7 },
];

/** Stable identifier for a touch, used as the fired-dedupe hash field. */
export function touchKey(touch) {
  return `${touch.mode}:${touch.targetDays}`;
}

/**
 * Decide what an --auto invocation should do right now.
 *
 * @param {{
 *   now: Date,
 *   cutdownDate: Date,          // absolute deadline instant (8:45 PM PT)
 *   daysUntil: number,          // PT calendar days until the cutdown date
 *   firedTouches?: Set<string>, // touchKey()s already fired this year
 * }} input
 * @returns {{ mode: 'live' } | { mode: 'validate-only' | 'rehearse', touch: string } | { mode: 'noop' }}
 */
export function selectAutoMode({ now, cutdownDate, daysUntil, firedTouches = new Set() }) {
  // NEVER EARLY: live fires only at/after the deadline instant. A tick at
  // 8:44 PM on deadline day (daysUntil === 0) is still a no-op.
  if (now.getTime() >= cutdownDate.getTime()) {
    return { mode: 'live' };
  }
  for (const touch of AUTO_TOUCHES) {
    const key = touchKey(touch);
    if (shouldFireReminder(touch.targetDays, daysUntil) && !firedTouches.has(key)) {
      return { mode: touch.mode, touch: key };
    }
  }
  return { mode: 'noop' };
}

// ---------------------------------------------------------------------------
// Per-franchise resumability (Redis hash autocut:done:{year})
// ---------------------------------------------------------------------------

/**
 * Parse a done-hash value: 'done' | 'skipped-no-cred' | 'failed:<n>' |
 * anything else = pending.
 *
 * @param {string | null | undefined} value
 * @returns {{ status: 'done' | 'skipped-no-cred' | 'failed' | 'pending', attempts: number }}
 */
export function parseDoneValue(value) {
  if (value === 'done') return { status: 'done', attempts: 0 };
  if (value === SKIPPED_NO_CRED) return { status: 'skipped-no-cred', attempts: 0 };
  const failed = /^failed:(\d+)$/.exec(value ?? '');
  if (failed) return { status: 'failed', attempts: parseInt(failed[1], 10) };
  return { status: 'pending', attempts: 0 };
}

/** Done-hash value recording a failed attempt. */
export function failedDoneValue(attempt) {
  return `failed:${attempt}`;
}

/**
 * Decide whether to process a franchise on this tick.
 *
 * @param {string | null | undefined} doneValue current autocut:done value
 * @param {number} [maxAttempts]
 * @returns {{ action: 'skip-done' }
 *   | { action: 'skip-exhausted', attempts: number }
 *   | { action: 'attempt', attempt: number }}
 */
export function decideFranchiseAction(doneValue, maxAttempts = MAX_ATTEMPTS) {
  const parsed = parseDoneValue(doneValue);
  if (parsed.status === 'done') return { action: 'skip-done' };
  // A no-credential skip never counts as an attempt — always re-check it (a
  // fresh login heals it), starting the attempt counter back at 1 if a real
  // execution now runs and fails.
  if (parsed.status === 'skipped-no-cred') return { action: 'attempt', attempt: 1 };
  if (parsed.status === 'failed' && parsed.attempts >= maxAttempts) {
    return { action: 'skip-exhausted', attempts: parsed.attempts };
  }
  return { action: 'attempt', attempt: parsed.attempts + 1 };
}

/**
 * Bucket every over-limit franchise by its done-hash state.
 *
 * @param {Record<string, string>} doneHash
 * @param {string[]} franchiseIds
 * @param {number} [maxAttempts]
 * @returns {{ done: string[], failed: string[], exhausted: string[], pending: string[], skippedNoCred: string[] }}
 */
export function summarizeDoneHash(doneHash, franchiseIds, maxAttempts = MAX_ATTEMPTS) {
  const summary = { done: [], failed: [], exhausted: [], pending: [], skippedNoCred: [] };
  for (const fid of franchiseIds) {
    const parsed = parseDoneValue(doneHash?.[fid]);
    if (parsed.status === 'done') summary.done.push(fid);
    else if (parsed.status === 'skipped-no-cred') summary.skippedNoCred.push(fid);
    else if (parsed.status === 'failed' && parsed.attempts >= maxAttempts) summary.exhausted.push(fid);
    else if (parsed.status === 'failed') summary.failed.push(fid);
    else summary.pending.push(fid);
  }
  return summary;
}

/**
 * The run is fully complete when every franchise is done or has exhausted its
 * retries. Franchises that are still pending, retryable-failed, OR skipped for
 * a missing credential keep the run OPEN — the last one so a "log in once"
 * really does get re-checked on later ticks rather than being written off.
 */
export function isRunComplete(doneHash, franchiseIds, maxAttempts = MAX_ATTEMPTS) {
  const summary = summarizeDoneHash(doneHash, franchiseIds, maxAttempts);
  return (
    summary.failed.length === 0 &&
    summary.pending.length === 0 &&
    summary.skippedNoCred.length === 0
  );
}

/**
 * The Redis mutations that record one franchise's completion state.
 * Assembled here (and ONLY here) so the invariant is testable:
 *
 * INVARIANT (plan decision #8): franchise completion may write the done hash
 * and delete the franchise's CREDENTIAL — it must NEVER touch the owner's
 * cut list (`autocut:{fid}`). Selections outlive execution.
 *
 * @param {{ year: number|string, franchiseId: string, doneValue: string, deleteCredential?: boolean }} input
 * @returns {string[][]} Redis command arrays for scripts/lib/redis.mjs#redisCommand
 */
export function completionCommands({ year, franchiseId, doneValue, deleteCredential = false }) {
  const commands = [['HSET', `autocut:done:${year}`, franchiseId, doneValue]];
  if (deleteCredential) {
    commands.push(['DEL', `autocut:cred:${franchiseId}`]);
  }
  for (const cmd of commands) {
    const key = cmd[1] ?? '';
    if (/^autocut:\d+$/.test(key)) {
      throw new Error(`completionCommands must never touch a cut-list key: ${key}`);
    }
  }
  return commands;
}

// ---------------------------------------------------------------------------
// Snapshot shaping (Redis autocut:snapshot:{year} + committed report file)
// ---------------------------------------------------------------------------

/**
 * Freeze one franchise's plan for the audit snapshot: the owner's saved
 * marked list, the roster at execution time, and the computed slate.
 * Outcomes start empty and are appended as execution proceeds.
 *
 * @param {{
 *   franchiseId: string,
 *   franchiseName?: string,
 *   markedList: { year?: number, playerIds?: string[], updatedAt?: string } | null,
 *   roster: Array<{ id: string, status: string, salary?: string | number }>,
 *   slate: { cuts: Array<object>, activeCount: number, overage: number, target: number },
 * }} input
 */
export function buildSnapshotEntry({ franchiseId, franchiseName, markedList, roster, slate }) {
  return {
    franchiseId,
    ...(franchiseName ? { franchiseName } : {}),
    markedList: markedList
      ? {
          year: markedList.year ?? null,
          playerIds: [...(markedList.playerIds ?? [])],
          updatedAt: markedList.updatedAt ?? null,
        }
      : null,
    rosterAtExecution: roster.map((p) => ({
      id: p.id,
      status: p.status,
      ...(p.salary !== undefined ? { salary: p.salary } : {}),
    })),
    slate,
    outcomes: [],
  };
}

/**
 * Append an execution outcome to a snapshot entry. Immutable — returns a new
 * entry; the frozen plan (markedList / rosterAtExecution / slate) is never
 * modified.
 *
 * @param {object} entry
 * @param {{ playerId?: string, status: string, at?: string }} outcome
 */
export function appendOutcome(entry, outcome) {
  return { ...entry, outcomes: [...(entry.outcomes ?? []), outcome] };
}

/**
 * Merge freshly computed franchise entries into an existing snapshot.
 * Entries that already carry recorded outcomes are kept as-is — a resumable
 * re-entry tick must never clobber an earlier tick's frozen plan or its
 * outcome history. New franchises are added; outcome-free entries are
 * refreshed with the latest plan.
 *
 * @param {object | null} existing previous snapshot (or null)
 * @param {object[]} freshEntries buildSnapshotEntry() results
 * @param {{ year: number|string, mode: string, generatedAt: string }} meta
 */
export function mergeSnapshot(existing, freshEntries, { year, mode, generatedAt }) {
  const franchises = { ...(existing?.franchises ?? {}) };
  for (const entry of freshEntries) {
    const prior = franchises[entry.franchiseId];
    if (prior && Array.isArray(prior.outcomes) && prior.outcomes.length > 0) continue;
    franchises[entry.franchiseId] = entry;
  }
  return {
    version: 1,
    year: Number(year),
    mode,
    generatedAt,
    firstWrittenAt: existing?.firstWrittenAt ?? generatedAt,
    franchises,
  };
}

/** Whether a snapshot already carries execution outcomes for any franchise. */
export function snapshotHasOutcomes(snapshot) {
  return Object.values(snapshot?.franchises ?? {}).some(
    (entry) => Array.isArray(entry?.outcomes) && entry.outcomes.length > 0,
  );
}

/**
 * Merge-before-write for a single franchise (deadline-job item K).
 *
 * The job reads the snapshot once at the top of a tick and processes
 * franchises one at a time. Rewriting the WHOLE in-memory snapshot after each
 * franchise would clobber anything an external writer changed mid-tick — in
 * particular a manual-done the commissioner records for ANOTHER franchise via
 * /api/admin/autocut-control. This folds only the just-processed franchise's
 * `workingEntry` back into the CURRENTLY STORED snapshot, leaving every other
 * franchise's stored entry untouched.
 *
 * `workingEntry` is authoritative for its own franchise's execution outcomes
 * (unlike a blanket mergeSnapshot, which would DROP a retry tick's freshly
 * appended outcomes because the stored entry already had prior-attempt
 * outcomes). Any manual-done outcomes the commissioner appended to THIS
 * franchise's stored entry are still folded in, matched by playerId, so a
 * same-franchise race also survives.
 *
 * @param {object | null} stored the snapshot currently in Redis
 * @param {string} franchiseId
 * @param {object} workingEntry the job's freshly-updated entry for this franchise
 * @param {{ year: number|string, mode: string, generatedAt: string }} meta
 */
export function foldFranchiseIntoStored(stored, franchiseId, workingEntry, { year, mode, generatedAt }) {
  const franchises = { ...(stored?.franchises ?? {}) };
  const storedEntry = franchises[franchiseId];
  const storedOutcomes = Array.isArray(storedEntry?.outcomes) ? storedEntry.outcomes : [];
  const externalManualDones = storedOutcomes.filter((o) => o?.type === 'manual-done');

  let finalEntry = workingEntry;
  if (externalManualDones.length > 0) {
    const havePlayerIds = new Set(
      (workingEntry.outcomes ?? [])
        .filter((o) => o?.type === 'manual-done')
        .map((o) => o.playerId),
    );
    const missing = externalManualDones.filter((o) => !havePlayerIds.has(o.playerId));
    if (missing.length > 0) {
      finalEntry = { ...workingEntry, outcomes: [...(workingEntry.outcomes ?? []), ...missing] };
    }
  }
  franchises[franchiseId] = finalEntry;

  return {
    version: 1,
    year: Number(year),
    mode,
    generatedAt,
    firstWrittenAt: stored?.firstWrittenAt ?? generatedAt,
    franchises,
  };
}
