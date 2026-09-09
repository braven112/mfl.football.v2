/**
 * Loading one season of transactions, priced.
 *
 * Both Transactions routes glob their own league's feeds — a static import
 * specifier can't be a runtime variable, and a cron-generated feed must not be
 * a static import at all — but everything downstream of the glob is identical
 * for both leagues, so it lives here and the routes stay thin.
 */

import { loadSeasonFeed, seasonsFromGlob } from './mfl-feed-glob';
import type { LazyFeedGlob } from './mfl-feed-glob';
import { normalizeTransactions, type TransactionRow } from './mfl-transactions';

export type { LazyFeedGlob };
export { seasonsFromGlob };

/**
 * The league minimum for a season, from that season's `league.json`.
 *
 * MFL publishes it as `bbidMinimum`, and reading it per season is the whole
 * point: TheLeague signs every FCFS free agent at the minimum, so this is the
 * price of a third of the ledger's rows. Writing the figure into source would
 * freeze it at today's value AND trip `tests/league-literal-guard.test.ts`.
 *
 * Returns null for a league that has no cap (the AFL's export carries no
 * `bbidMinimum` at all) or a season whose feed predates the field — in which
 * case FCFS rows stay unpriced and the UI prints a dash rather than a zero.
 */
export async function loadLeagueMinimum(
  leagueFeeds: LazyFeedGlob,
  year: number
): Promise<number | null> {
  const feed = (await loadSeasonFeed(leagueFeeds, year)) as
    | { league?: { bbidMinimum?: unknown } }
    | null;
  const raw = feed?.league?.bbidMinimum;
  const n = Number(typeof raw === 'string' ? raw : raw ?? NaN);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export interface LoadSeasonInput {
  /** Lazy `import.meta.glob` over this league's per-season transactions feeds. */
  transactionFeeds: LazyFeedGlob;
  /** The same over the per-season league feeds, for the minimum salary. */
  leagueFeeds: LazyFeedGlob;
  year: number;
  /**
   * Whether the league prices anything at all — `leagueHasFeature(slug,
   * 'salaryCap')`. False skips the minimum lookup entirely rather than
   * relying on the AFL's export happening to omit the field.
   */
  hasSalaryCap: boolean;
}

/** One season's rows, newest first. An absent season yields an empty list. */
export async function loadTransactionsSeason(input: LoadSeasonInput): Promise<TransactionRow[]> {
  const [feed, freeAgentPrice] = await Promise.all([
    loadSeasonFeed(input.transactionFeeds, input.year),
    input.hasSalaryCap ? loadLeagueMinimum(input.leagueFeeds, input.year) : Promise.resolve(null),
  ]);
  if (feed === null) return [];
  return normalizeTransactions(feed, { freeAgentPrice });
}
