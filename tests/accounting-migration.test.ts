/**
 * Guard tests for the year-rollover migration.
 *
 * MFL starts every new league year with an empty ledger, so this is what stops
 * the league's books resetting to zero each February. The sign test is the one
 * that matters most: flipping it turns every debt in the league into a credit
 * in a single pass, and the resulting ledger looks entirely plausible.
 */

import { describe, it, expect } from 'vitest';
import {
  planYearMigration,
  carryDescription,
  assessCarryReadiness,
} from '../src/utils/accounting-migration.mjs';

const ledger = (balances: Record<string, number>) => ({
  balances,
  records: Object.entries(balances).map(([franchiseId, amount]) => ({
    franchiseId,
    amount,
    description: 'seed',
  })),
});

const FRANCHISES = [
  { id: '0001', name: 'Pacific Pigskins' },
  { id: '0002', name: 'Second Team' },
  { id: '0003', name: 'Third Team' },
];

describe('sign preservation', () => {
  it('carries a DEBT forward as a debt', () => {
    // -100 means the franchise owes $100. It must open the new year owing
    // $100, not credited $100.
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: ledger({ '0001': -100 }),
      franchises: FRANCHISES,
    });
    expect(plan.lines[0].amount).toBe(-100);
  });

  it('carries a CREDIT forward as a credit', () => {
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: ledger({ '0001': 300 }),
      franchises: FRANCHISES,
    });
    expect(plan.lines[0].amount).toBe(300);
  });

  it('keeps the league net identical across the carry', () => {
    // The books must net to the same number before and after. This is the
    // number that goes visibly wrong the moment a sign is flipped.
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: ledger({ '0001': -100, '0002': 300, '0003': -50 }),
      franchises: FRANCHISES,
    });
    expect(plan.totals.sourceNet).toBe(150);
    expect(plan.totals.carriedNet).toBe(150);
  });
});

describe('idempotency', () => {
  const source = ledger({ '0001': -100 });

  it('plans a balance that is not yet carried', () => {
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: source,
      franchises: FRANCHISES,
    });
    expect(plan.lines[0].status).toBe('payable');
    expect(plan.lines[0].description).toBe('Balance carried forward from 2025');
  });

  it('skips a balance already carried', () => {
    // The whole safety net for a second click.
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: source,
      targetRecords: [
        { franchiseId: '0001', amount: -100, description: carryDescription(2025) },
      ],
      franchises: FRANCHISES,
    });
    expect(plan.lines[0].status).toBe('already-migrated');
    expect(plan.totals.carryable).toBe(0);
  });

  it('flags a carry record at a different amount as a conflict', () => {
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: source,
      targetRecords: [
        { franchiseId: '0001', amount: -75, description: carryDescription(2025) },
      ],
      franchises: FRANCHISES,
    });
    expect(plan.lines[0].status).toBe('conflict');
    expect(plan.totals.conflicts).toBe(1);
  });

  it('carries every franchise even though they share one description', () => {
    // All carry records read "Balance carried forward from 2025" by design,
    // so the idempotency key must be (franchise, description). Keying on the
    // description alone would carry exactly one franchise and skip the rest.
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: ledger({ '0001': -100, '0002': -100, '0003': -100 }),
      targetRecords: [
        { franchiseId: '0001', amount: -100, description: carryDescription(2025) },
      ],
      franchises: FRANCHISES,
    });
    const byFranchise = Object.fromEntries(
      plan.lines.map((line: any) => [line.franchiseId, line.status])
    );
    expect(byFranchise['0001']).toBe('already-migrated');
    expect(byFranchise['0002']).toBe('payable');
    expect(byFranchise['0003']).toBe('payable');
  });

  it('year-stamps the description so two rollovers never collide', () => {
    expect(carryDescription(2025)).not.toBe(carryDescription(2026));
  });
});

describe('edge cases', () => {
  it('skips a franchise that closed the year square', () => {
    // Reported as skipped rather than omitted — a franchise missing from the
    // plan entirely reads as an oversight.
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: ledger({ '0001': 0, '0002': -50 }),
      franchises: FRANCHISES,
    });
    expect(plan.lines).toHaveLength(1);
    expect(plan.skipped[0].franchiseId).toBe('0001');
  });

  it('warns loudly about a balance whose franchise no longer exists', () => {
    // Real money with nowhere to go. Dropping it silently loses it from the
    // league's books.
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: ledger({ '0009': -250 }),
      franchises: FRANCHISES,
    });
    expect(plan.lines).toHaveLength(0);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].franchiseId).toBe('0009');
    expect(plan.warnings[0].balance).toBe(-250);
  });

  it('carries a balance for a franchise that changed hands', () => {
    // Both constitutions: a replacement owner takes the team over as-is,
    // financial obligations included. The debt follows the slot.
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: ledger({ '0002': -175 }),
      franchises: FRANCHISES,
    });
    expect(plan.lines[0].franchiseId).toBe('0002');
    expect(plan.lines[0].amount).toBe(-175);
  });

  it('pads a bare franchise id rather than treating it as a new team', () => {
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: { balances: { '1': -100 }, records: [] },
      franchises: FRANCHISES,
    });
    expect(plan.lines[0].franchiseId).toBe('0001');
  });

  it('carries every franchise when the target roster is unknown', () => {
    // No franchise list (a feed we don't hold yet) must not silently warn
    // every balance away.
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: ledger({ '0001': -100, '0009': -50 }),
      franchises: [],
    });
    expect(plan.lines).toHaveLength(2);
    expect(plan.warnings).toHaveLength(0);
  });

  it('rounds a summed balance to cents', () => {
    const plan = planYearMigration({
      fromYear: 2025,
      toYear: 2026,
      sourceLedger: { balances: { '0001': -0.1 - 0.2 }, records: [] },
      franchises: FRANCHISES,
    });
    expect(plan.lines[0].amount).toBe(-0.3);
  });
});

/* ── Unattended-carry gates ─────────────────────────────────────────────── */

describe('assessCarryReadiness', () => {
  const NOW = 1_800_000_000_000;
  const daysAgoTs = (days: number) => Math.floor((NOW - days * 86_400_000) / 1000);

  /** A settled source: one record, well outside the quiet window. */
  const settledSource = { records: [{ timestamp: daysAgoTs(60) }] };

  const cleanPlan = (over: Record<string, unknown> = {}) => ({
    lines: [{ status: 'payable' }],
    warnings: [],
    totals: { sourceNet: 100, carriedNet: 100, carryable: 100 },
    ...over,
  });

  const assess = (over: Record<string, unknown> = {}) =>
    assessCarryReadiness({
      sourceLedger: settledSource,
      plan: cleanPlan(),
      nowMs: NOW,
      settleAfterDays: 14,
      ...over,
    });

  it('allows a settled year with a clean plan', () => {
    expect(assess().ready).toBe(true);
  });

  it('refuses a source year with no records at all', () => {
    // Indistinguishable from a failed read, and the failure mode of guessing
    // is carrying nothing while reporting success.
    const result = assess({ sourceLedger: { records: [] } });
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/no accounting records/i);
  });

  it('refuses a year that is still being written to', () => {
    // A carry moves a CLOSING balance. Anything added to the old year after
    // the carry has to be moved by hand — a second run will not do it.
    const result = assess({ sourceLedger: { records: [{ timestamp: daysAgoTs(3) }] } });
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/still active/i);
  });

  it('allows it the moment the quiet window is met', () => {
    expect(assess({ sourceLedger: { records: [{ timestamp: daysAgoTs(15) }] } }).ready).toBe(true);
  });

  it('judges quiet by the NEWEST record, not the oldest', () => {
    // An old record alongside a fresh one must not make the year look settled.
    const result = assess({
      sourceLedger: { records: [{ timestamp: daysAgoTs(400) }, { timestamp: daysAgoTs(1) }] },
    });
    expect(result.ready).toBe(false);
  });

  it('refuses when any line conflicts', () => {
    const result = assess({
      plan: cleanPlan({ lines: [{ status: 'payable' }, { status: 'conflict' }] }),
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/different amount/i);
  });

  it('refuses when a balance has no franchise to land on', () => {
    // Real money with nowhere to go. Carrying "the rest" would drop it.
    const result = assess({
      plan: cleanPlan({ warnings: [{ franchiseId: '0009', balance: -250 }] }),
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/no longer exists/i);
  });

  it('refuses when the two nets disagree', () => {
    const result = assess({
      plan: cleanPlan({ totals: { sourceNet: 100, carriedNet: 60, carryable: 60 } }),
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/net mismatch/i);
  });

  it('reports nothing-to-do separately from a refusal', () => {
    // An already-carried year is a no-op, not a problem worth alarming about.
    const result = assess({ plan: cleanPlan({ lines: [{ status: 'already-migrated' }] }) });
    expect(result.ready).toBe(false);
    expect(result.nothingToDo).toBe(true);
  });

  it('refuses on the FIRST problem rather than carrying part of the league', () => {
    // Unsettled AND conflicted: either alone is disqualifying, and the whole
    // league is skipped either way.
    const result = assess({
      sourceLedger: { records: [{ timestamp: daysAgoTs(1) }] },
      plan: cleanPlan({ lines: [{ status: 'conflict' }] }),
    });
    expect(result.ready).toBe(false);
  });
});
