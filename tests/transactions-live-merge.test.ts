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

describe('both Schefter pick parsers read DP_ tokens', () => {
  it('the TS parser resolves a current-draft pick instead of calling it a player', async () => {
    // Two Schefter parsers exist — scripts/schefter-scan.mjs (the scanner) and
    // src/utils/schefter-transaction-parser.ts (SchefterPostCard). Both matched
    // FP_ only, so every DP_ token published as "Player DP_0_11". Fixing one
    // and not the other is the drift this pins.
    const { parseDraftPickId } = await import('../src/utils/schefter-transaction-parser');
    const teams = new Map([['0005', { name: 'Rebels' } as never]]);
    expect(parseDraftPickId('DP_2_10', teams)?.display).toBe('3rd round, pick 11');
    // "Rebels's", with the possessive appended verbatim, is the wording this
    // parser has always produced — most franchise names here end in s
    // ("Pigskins's 2026 3rd"). Asserted as-is to pin that the DP_ fix changed
    // nothing about the FP_ path; the awkward possessive predates this work.
    expect(parseDraftPickId('FP_0005_2026_3', teams)?.display).toBe("Rebels's 2026 3rd");
    expect(parseDraftPickId('13630', teams)).toBeNull();
  });

  it('its parseTradeAssets sorts a DP_ token into picks, not players', async () => {
    const { parseTradeAssets } = await import('../src/utils/schefter-transaction-parser');
    const out = parseTradeAssets('13630,DP_0_11,', new Map(), new Map());
    expect(out.picks).toHaveLength(1);
    expect(out.players.map((p) => p.playerId)).toEqual(['13630']);
  });
});

describe('round ordinals', () => {
  it.each([
    [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [9, '9th'],
    // The teens take "th" despite their last digit — the case a naive
    // last-digit rule gets wrong.
    [11, '11th'], [12, '12th'], [13, '13th'],
    // And the case the old five-entry table got wrong: "21th".
    [21, '21st'], [22, '22nd'], [23, '23rd'], [24, '24th'],
  ])('%i → %s', async (round, expected) => {
    const { roundOrdinal } = await import('../src/utils/mfl-pick-tokens.mjs');
    expect(roundOrdinal(round)).toBe(expected);
  });
});
