/**
 * The live merge.
 *
 * The committed feed is bundled at build time, so a page built on it alone
 * cannot show today's waiver run or today's FCFS pickups — the rows an owner
 * actually opens the page to check. These pin the merge that closes that gap,
 * and the reason it does NOT go through `mergeTransactionRows`.
 */
import { describe, it, expect } from 'vitest';
import { normalizeTransactions } from '../src/utils/mfl-transactions';
import { mergeTransactionRows } from '../src/utils/mfl-transactions-cache';

/** An AFL-shaped waiver row: players live in fields, not in `transaction`. */
const aflWaiver = (franchise: string, timestamp: string, added: string, dropped: string) =>
  ({ type: 'WAIVER', franchise, timestamp, added, dropped }) as never;

describe('the shared merge helper and this page', () => {
  it('mergeTransactionRows now keeps two DISTINCT AFL waiver rows', () => {
    // It used to collapse them: its key was type|franchise|timestamp|transaction
    // and an AFL WAIVER row has no `transaction`, so a franchise winning two
    // claims in one batch keyed identically. Fixed to key on the whole row.
    const a = aflWaiver('0019', '1198731601', '1757', '8252');
    const b = aflWaiver('0019', '1198731601', '6786', '5429');
    expect(mergeTransactionRows([a], [b])).toHaveLength(2);
  });

  it('the normalizer reaches the same answer independently', () => {
    // This page concatenates and lets the normalizer dedupe rather than
    // running a second pass through the helper — its ids are content-addressed
    // over the parsed players and amount, so the extra pass would add nothing.
    const rows = normalizeTransactions([
      { type: 'WAIVER', franchise: '0019', timestamp: '1198731601', added: '1757,', dropped: '8252,' },
      { type: 'WAIVER', franchise: '0019', timestamp: '1198731601', added: '6786,', dropped: '5429,' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.added.join())).toEqual(expect.arrayContaining(['1757', '6786']));
  });
});

describe('merging live rows over the static feed', () => {
  const staticFeed = {
    transactions: {
      transaction: [
        { type: 'BBID_WAIVER', franchise: '0008', timestamp: '1788703200', transaction: '14063,|425000|15777,' },
      ],
    },
  };

  it('surfaces a live FCFS pickup the static feed has not caught up to', () => {
    // The real case: an FCFS add lands at 02:59, the cron has not committed,
    // and the ledger shows nothing for today.
    const live = [{ type: 'FREE_AGENT', franchise: '0015', timestamp: '1788944340', transaction: '16195,|' }];
    const rows = normalizeTransactions([
      ...(staticFeed.transactions.transaction as unknown[]),
      ...live,
    ] as never, { freeAgentPrice: 425000 });

    expect(rows).toHaveLength(2);
    // Newest first, so the live pickup leads.
    expect(rows[0]).toMatchObject({ kind: 'free-agent', added: ['16195'], dropped: [], amount: 425000 });
  });

  it('collapses a row present in BOTH the static feed and the live window', () => {
    // The overlap is the normal case — the live window is the last 3 days, and
    // the static feed covers some of it. The row must not render twice.
    const dupe = { type: 'BBID_WAIVER', franchise: '0008', timestamp: '1788703200', transaction: '14063,|425000|15777,' };
    const rows = normalizeTransactions([
      ...(staticFeed.transactions.transaction as unknown[]),
      dupe,
    ] as never);
    expect(rows).toHaveLength(1);
  });

  it('is a no-op when the live lookup returns nothing', () => {
    const rows = normalizeTransactions([...(staticFeed.transactions.transaction as unknown[])] as never);
    expect(rows).toHaveLength(1);
  });
});
