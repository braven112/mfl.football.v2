/**
 * Tests for the August cuts deadline job's pure decision logic
 * (src/utils/august-cuts-logic.mjs) plus source-contract assertions on the
 * orchestrator script itself (grep-sentinel style, like
 * tests/schefter-quiet-day.test.ts).
 *
 * Covers: the never-early live gate, --auto mode-selection windows
 * (T-7/T-2 → validate-only, T-1 → rehearse, ≥ deadline → live), touch
 * dedupe, retry cap (MAX_ATTEMPTS), done-skip, ≤22 → zero-cut done
 * bookkeeping, and the cut-lists-are-never-deleted invariant.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  MAX_ATTEMPTS,
  AUTO_TOUCHES,
  touchKey,
  selectAutoMode,
  parseDoneValue,
  failedDoneValue,
  decideFranchiseAction,
  summarizeDoneHash,
  isRunComplete,
  completionCommands,
  buildSnapshotEntry,
  appendOutcome,
  mergeSnapshot,
  snapshotHasOutcomes,
} from '../src/utils/august-cuts-logic.mjs';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { getAugustCutdownDate, calendarDaysUntilCutdown } from '../scripts/lib/august-cutdown.mjs';

// 2026 deadline: Sunday Aug 16, 8:45 PM PT.
const YEAR = 2026;
const cutdownDate = getAugustCutdownDate(YEAR);

function autoModeAt(iso: string, firedTouches: string[] = []) {
  const now = new Date(iso);
  return selectAutoMode({
    now,
    cutdownDate,
    daysUntil: calendarDaysUntilCutdown(YEAR, now),
    firedTouches: new Set(firedTouches),
  });
}

const ALL_TOUCHES = AUTO_TOUCHES.map(touchKey);

describe('selectAutoMode — never-early live gate', () => {
  it('does NOT go live one minute before the deadline instant', () => {
    expect(autoModeAt('2026-08-16T20:44:00-07:00', ALL_TOUCHES)).toEqual({ mode: 'noop' });
  });

  it('goes live exactly at the deadline instant', () => {
    expect(autoModeAt('2026-08-16T20:45:00-07:00')).toEqual({ mode: 'live' });
  });

  it('goes live on late/catch-up ticks after the deadline', () => {
    expect(autoModeAt('2026-08-16T23:59:00-07:00')).toEqual({ mode: 'live' });
    expect(autoModeAt('2026-08-18T09:00:00-07:00')).toEqual({ mode: 'live' });
  });
});

describe('selectAutoMode — touch windows (target day or one day late, never early)', () => {
  it('T-7 fires validate-only', () => {
    expect(autoModeAt('2026-08-09T09:00:00-07:00')).toEqual({ mode: 'validate-only', touch: 'validate-only:7' });
  });

  it('T-8 is too early for the T-7 touch', () => {
    expect(autoModeAt('2026-08-08T09:00:00-07:00')).toEqual({ mode: 'noop' });
  });

  it('T-6 is the one-day-late catch-up for a missed T-7 touch', () => {
    expect(autoModeAt('2026-08-10T09:00:00-07:00')).toEqual({ mode: 'validate-only', touch: 'validate-only:7' });
  });

  it('T-6 is a noop when the T-7 touch already fired (dedupe)', () => {
    expect(autoModeAt('2026-08-10T09:00:00-07:00', ['validate-only:7'])).toEqual({ mode: 'noop' });
  });

  it('mid-window days (T-5..T-3) are noops', () => {
    expect(autoModeAt('2026-08-11T09:00:00-07:00', ['validate-only:7'])).toEqual({ mode: 'noop' });
    expect(autoModeAt('2026-08-13T09:00:00-07:00', ['validate-only:7'])).toEqual({ mode: 'noop' });
  });

  it('T-2 fires the second validate-only touch', () => {
    expect(autoModeAt('2026-08-14T09:00:00-07:00', ['validate-only:7'])).toEqual({ mode: 'validate-only', touch: 'validate-only:2' });
  });

  it('T-1 fires the rehearsal (rehearse outranks a missed T-2 catch-up)', () => {
    expect(autoModeAt('2026-08-15T09:00:00-07:00', ['validate-only:7'])).toEqual({ mode: 'rehearse', touch: 'rehearse:1' });
  });

  it('T-1 falls back to the missed T-2 validate catch-up once the rehearsal fired', () => {
    expect(autoModeAt('2026-08-15T12:00:00-07:00', ['validate-only:7', 'rehearse:1'])).toEqual({ mode: 'validate-only', touch: 'validate-only:2' });
  });

  it('deadline-day morning is the rehearsal catch-up if T-1 was missed, else a noop until 8:45pm', () => {
    expect(autoModeAt('2026-08-16T09:00:00-07:00', ['validate-only:7', 'validate-only:2'])).toEqual({ mode: 'rehearse', touch: 'rehearse:1' });
    expect(autoModeAt('2026-08-16T09:00:00-07:00', ALL_TOUCHES)).toEqual({ mode: 'noop' });
  });

  it('every touch fired + pre-deadline = noop (a normal August 15-min tick)', () => {
    expect(autoModeAt('2026-08-15T18:00:00-07:00', ALL_TOUCHES)).toEqual({ mode: 'noop' });
  });
});

describe('resumability — done-hash bookkeeping', () => {
  it('a fresh franchise gets attempt 1', () => {
    expect(decideFranchiseAction(undefined)).toEqual({ action: 'attempt', attempt: 1 });
    expect(decideFranchiseAction(null)).toEqual({ action: 'attempt', attempt: 1 });
  });

  it('done franchises are skipped', () => {
    expect(decideFranchiseAction('done')).toEqual({ action: 'skip-done' });
  });

  it('failed franchises are retried with an incremented attempt', () => {
    expect(decideFranchiseAction('failed:1')).toEqual({ action: 'attempt', attempt: 2 });
    expect(decideFranchiseAction('failed:2')).toEqual({ action: 'attempt', attempt: 3 });
  });

  it('retries stop at MAX_ATTEMPTS', () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(decideFranchiseAction(`failed:${MAX_ATTEMPTS}`)).toEqual({ action: 'skip-exhausted', attempts: 3 });
    expect(decideFranchiseAction('failed:7')).toEqual({ action: 'skip-exhausted', attempts: 7 });
  });

  it('garbage values are treated as pending (defensive)', () => {
    expect(decideFranchiseAction('wat')).toEqual({ action: 'attempt', attempt: 1 });
    expect(parseDoneValue('failed:x')).toEqual({ status: 'pending', attempts: 0 });
  });

  it('failedDoneValue round-trips through parseDoneValue', () => {
    expect(parseDoneValue(failedDoneValue(2))).toEqual({ status: 'failed', attempts: 2 });
  });

  it('summarizeDoneHash buckets and isRunComplete require done-or-exhausted for every franchise', () => {
    const doneHash = { '0001': 'done', '0002': 'failed:1', '0003': 'failed:3' };
    const fids = ['0001', '0002', '0003', '0004'];
    expect(summarizeDoneHash(doneHash, fids)).toEqual({
      done: ['0001'],
      failed: ['0002'],
      exhausted: ['0003'],
      pending: ['0004'],
    });
    expect(isRunComplete(doneHash, fids)).toBe(false);
    expect(isRunComplete({ '0001': 'done', '0002': 'failed:3' }, ['0001', '0002'])).toBe(true);
  });

  it('a franchise already at/under the limit books as done with zero cuts (no attempts consumed)', () => {
    // The script marks slate.overage <= 0 as plain 'done' — same value a
    // fully-executed franchise gets, so later ticks skip it.
    const entry = appendOutcome(
      buildSnapshotEntry({
        franchiseId: '0005',
        markedList: { year: YEAR, playerIds: ['123'], updatedAt: '2026-08-01T00:00:00Z' },
        roster: Array.from({ length: 22 }, (_, i) => ({ id: String(i), status: 'ROSTER' })),
        slate: { cuts: [], activeCount: 22, overage: 0, target: 22 },
      }),
      { status: 'no-cuts-needed', activeCount: 22, at: '2026-08-16T20:46:00Z' },
    );
    expect(entry.slate.cuts).toEqual([]);
    expect(entry.outcomes).toEqual([{ status: 'no-cuts-needed', activeCount: 22, at: '2026-08-16T20:46:00Z' }]);
    // The owner's marked list survives untouched in the frozen plan.
    expect(entry.markedList).toEqual({ year: YEAR, playerIds: ['123'], updatedAt: '2026-08-01T00:00:00Z' });
    expect(decideFranchiseAction('done')).toEqual({ action: 'skip-done' });
  });
});

describe('completionCommands — cut lists are NEVER deleted (plan decision #8)', () => {
  it('a completed franchise writes the done hash and deletes ONLY its credential', () => {
    const commands = completionCommands({ year: YEAR, franchiseId: '0001', doneValue: 'done', deleteCredential: true });
    expect(commands).toEqual([
      ['HSET', `autocut:done:${YEAR}`, '0001', 'done'],
      ['DEL', 'autocut:cred:0001'],
    ]);
  });

  it('a failed franchise writes only the done hash (credential retained for the retry)', () => {
    expect(completionCommands({ year: YEAR, franchiseId: '0002', doneValue: 'failed:1' })).toEqual([
      ['HSET', `autocut:done:${YEAR}`, '0002', 'failed:1'],
    ]);
  });

  it('no completion command ever touches an autocut:{fid} cut-list key', () => {
    for (const deleteCredential of [true, false]) {
      for (const fid of ['0001', '0016']) {
        const commands = completionCommands({ year: YEAR, franchiseId: fid, doneValue: 'done', deleteCredential });
        for (const cmd of commands) {
          expect(cmd[1]).not.toMatch(/^autocut:\d+$/);
        }
        // And DEL is only ever aimed at the credential key.
        const dels = commands.filter((c: string[]) => c[0] === 'DEL');
        for (const del of dels) expect(del[1]).toBe(`autocut:cred:${fid}`);
      }
    }
  });
});

describe('snapshot shaping — plans frozen before writes, outcomes appended', () => {
  const entryA = buildSnapshotEntry({
    franchiseId: '0001',
    franchiseName: 'Pacific Pigskins',
    markedList: { year: YEAR, playerIds: ['11', '22'], updatedAt: '2026-08-10T00:00:00Z' },
    roster: [
      { id: '11', status: 'ROSTER', salary: '1000000.00' },
      { id: '22', status: 'ROSTER' },
      { id: '33', status: 'TAXI_SQUAD' },
    ],
    slate: { cuts: [{ playerId: '11', reason: 'marked' }], activeCount: 23, overage: 1, target: 22 },
  });

  it('buildSnapshotEntry freezes the marked list, roster (with salary where present), and slate', () => {
    expect(entryA.markedList?.playerIds).toEqual(['11', '22']);
    expect(entryA.rosterAtExecution).toEqual([
      { id: '11', status: 'ROSTER', salary: '1000000.00' },
      { id: '22', status: 'ROSTER' },
      { id: '33', status: 'TAXI_SQUAD' },
    ]);
    expect(entryA.outcomes).toEqual([]);
  });

  it('appendOutcome is immutable and never rewrites the frozen plan', () => {
    const after = appendOutcome(entryA, { playerId: '11', status: 'cut-verified', at: 'x' });
    expect(entryA.outcomes).toEqual([]); // original untouched
    expect(after.outcomes).toEqual([{ playerId: '11', status: 'cut-verified', at: 'x' }]);
    expect(after.markedList).toEqual(entryA.markedList);
    expect(after.slate).toBe(entryA.slate);
  });

  it('mergeSnapshot never clobbers an entry that already has outcomes (resumable re-entry)', () => {
    const executed = appendOutcome(entryA, { playerId: '11', status: 'cut-verified', at: 'x' });
    const existing = mergeSnapshot(null, [executed], { year: YEAR, mode: 'live', generatedAt: 't1' });
    const freshPlanSameFid = buildSnapshotEntry({
      franchiseId: '0001',
      markedList: null,
      roster: [],
      slate: { cuts: [], activeCount: 0, overage: -22, target: 22 },
    });
    const entryB = buildSnapshotEntry({
      franchiseId: '0002',
      markedList: null,
      roster: [{ id: '9', status: 'ROSTER' }],
      slate: { cuts: [], activeCount: 1, overage: -21, target: 22 },
    });
    const merged = mergeSnapshot(existing, [freshPlanSameFid, entryB], { year: YEAR, mode: 'live', generatedAt: 't2' });
    expect(merged.franchises['0001']).toEqual(executed); // preserved, not clobbered
    expect(merged.franchises['0002']).toEqual(entryB); // new franchise added
    expect(merged.firstWrittenAt).toBe('t1'); // original freeze time survives
    expect(snapshotHasOutcomes(merged)).toBe(true);
    expect(snapshotHasOutcomes(existing)).toBe(true);
    expect(snapshotHasOutcomes({ franchises: { '0002': entryB } })).toBe(false);
  });
});

describe('apply-august-cuts.mjs — source contracts (grep sentinels)', () => {
  const source = readFileSync(path.join(__dirname, '..', 'scripts', 'apply-august-cuts.mjs'), 'utf8');

  it('never sends FRANCHISE_ID on the owner-mode add_drop (lockout impersonation trap)', () => {
    // The invariant comment must exist…
    expect(source).toContain('NEVER send FRANCHISE_ID');
    // …and no code actually sets a FRANCHISE_ID form field or cookie.
    expect(source).not.toMatch(/FRANCHISE_ID['"]?\s*[:=]/);
    // The commissioner cookie must never ride along either.
    expect(source).not.toMatch(/MFL_IS_COMMISH/);
  });

  it('dry-run stops before the MFL write (sentinel guard, quiet-day style)', () => {
    expect(source).toContain('DRY-RUN SENTINEL');
    const sentinelIndex = source.indexOf('DRY-RUN SENTINEL');
    const writeIndex = source.indexOf('await postAddDrop(');
    expect(sentinelIndex).toBeGreaterThan(-1);
    expect(writeIndex).toBeGreaterThan(-1);
    // The dry-run guard sits before the write call inside the cut loop.
    expect(sentinelIndex).toBeLessThan(writeIndex);
  });

  it('never deletes autocut:{fid} cut lists — only completionCommands touches completion state', () => {
    expect(source).toContain('cut lists are never deleted');
    // No raw DEL of a cut-list key anywhere in the orchestrator.
    expect(source).not.toMatch(/DEL'\s*,\s*cutListKey/);
    // Credential deletion is routed through completionCommands (tested above),
    // never issued directly.
    expect(source).not.toMatch(/\['DEL'/);
  });

  it('imports league constants from the registry, never literals', () => {
    expect(source).toContain("from '../src/config/leagues-data.mjs'");
  });
});
