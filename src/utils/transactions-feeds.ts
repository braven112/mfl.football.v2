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
import {
  extractTransactionRows,
  normalizeTransactions,
  type TransactionRow,
} from './mfl-transactions';
import { getCachedRecentTransactions } from './mfl-transactions-cache';
import { buildPoolStructure } from './afl-conference-rosters.mjs';

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

/** One division, as the ledger labels it. */
export interface LedgerDivision {
  id: string;
  /** "Barry Sanders Division" — MFL's name, trimmed. */
  name: string;
  /** "Barry Sanders" — the row tag, where the full name would crowd the team. */
  abbrev: string;
}

/**
 * What a season's `league.json` says about how to READ its ledger — as
 * opposed to `loadLeagueMinimum`, which says how to PRICE it.
 */
export interface LedgerLeagueContext {
  /**
   * The season's blind-bid budget (MFL `bbidSeasonLimit`), or null. Non-null
   * makes this a FAAB league: its bids are the only price a move has, so the
   * amount column shows even though the league has no salary cap, and a
   * winning $0 bid is a real $0 rather than "not recorded".
   */
  faabBudget: number | null;
  /**
   * Decimal places a bid is shown with: 2 when MFL takes bids in cents
   * (`bbidIncrement` below a dollar — archies: 0.01), else 0. Formatting every
   * amount in the season the same way keeps a column of $5.00 / $5.01 from
   * reading as $5 / $5.01.
   */
  amountDecimals: 0 | 2;
  /**
   * The divisions, ONLY when each is its own player pool (MFL
   * `playerLimitUnit: DIVISION` — archies' nine). There a move means something
   * only inside its division: the same player can be added by nine teams, so
   * "who picked him up" is unanswerable without it. Null for every other
   * league — TheLeague's divisions share one pool and the AFL's pools are
   * conferences — so their ledgers carry no division markup at all.
   */
  divisions: LedgerDivision[] | null;
  /** franchise id → division id; empty when `divisions` is null. */
  divisionOfFranchise: Record<string, string>;
}

const NO_LEDGER_CONTEXT: LedgerLeagueContext = {
  faabBudget: null,
  amountDecimals: 0,
  divisions: null,
  divisionOfFranchise: {},
};

/** Pure half of `loadLedgerLeagueContext`, for tests. */
export function ledgerLeagueContextFrom(feed: unknown): LedgerLeagueContext {
  const league = (feed as { league?: Record<string, unknown> } | null)?.league;
  if (!league) return NO_LEDGER_CONTEXT;

  const budget = Number(league.bbidSeasonLimit);
  const increment = Number(league.bbidIncrement);

  let divisions: LedgerDivision[] | null = null;
  let divisionOfFranchise: Record<string, string> = {};
  if (String(league.playerLimitUnit ?? '').toUpperCase() === 'DIVISION') {
    const pools = buildPoolStructure(feed) as {
      ids: string[];
      names: Record<string, { name: string; abbrev: string }>;
      franchiseConferences: Record<string, string>;
    } | null;
    if (pools) {
      divisions = pools.ids.map((id) => ({ id, name: pools.names[id].name, abbrev: pools.names[id].abbrev }));
      divisionOfFranchise = pools.franchiseConferences;
    }
  }

  return {
    faabBudget: Number.isFinite(budget) && budget > 0 ? budget : null,
    amountDecimals: Number.isFinite(increment) && increment > 0 && increment < 1 ? 2 : 0,
    divisions,
    divisionOfFranchise,
  };
}

/** The season's ledger context — see `LedgerLeagueContext`. */
export async function loadLedgerLeagueContext(
  leagueFeeds: LazyFeedGlob,
  year: number
): Promise<LedgerLeagueContext> {
  return ledgerLeagueContextFrom(await loadSeasonFeed(leagueFeeds, year));
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
  /** MFL league id, for the live recent-transactions lookup. */
  leagueId: string;
  /**
   * True when `year` is the CURRENT league year. Only then is a live merge
   * worth doing — a past season cannot gain rows.
   */
  isCurrentSeason: boolean;
}

/**
 * One season's rows, newest first, with the last few days merged in live.
 *
 * WHY THE LIVE MERGE. The committed feed is read through `import.meta.glob`,
 * which means BUNDLED AT BUILD TIME: the page cannot see a move until the
 * roster-sync cron has committed it AND a deploy has shipped. GitHub throttles
 * that five-minute cron to a run every few hours in practice, so a ledger built
 * on the static feed alone is missing exactly the rows an owner opens the page
 * to check — today's waiver run and today's FCFS pickups. This is the same trap
 * `mfl-transactions-cache.ts` was written for on the contracts side, and its
 * header documents it; this page had it too.
 *
 * The live rows are CONCATENATED and handed to `normalizeTransactions` rather
 * than run through `mergeTransactionRows`. Not because that helper is wrong —
 * it keyed on `transaction` alone and lost AFL waiver rows, and that is fixed —
 * but because a second dedup pass would add nothing here: the normalizer's own
 * ids are content-addressed over the parsed players and amount, so it already
 * collapses genuine duplicates, keeps genuinely distinct rows, and sorts
 * newest-first on the way out.
 *
 * A null from the cache (no Redis, MFL erroring, past season) is not an error:
 * the page falls back to the static feed, which is stale but never wrong.
 */
export async function loadTransactionsSeason(input: LoadSeasonInput): Promise<TransactionRow[]> {
  const [feed, freeAgentPrice, live] = await Promise.all([
    loadSeasonFeed(input.transactionFeeds, input.year),
    input.hasSalaryCap ? loadLeagueMinimum(input.leagueFeeds, input.year) : Promise.resolve(null),
    input.isCurrentSeason
      ? getCachedRecentTransactions(String(input.year), input.leagueId).catch(() => null)
      : Promise.resolve(null),
  ]);

  const staticRows = feed === null ? [] : extractTransactionRows(feed);
  const liveRows = (live ?? []) as unknown as Record<string, unknown>[];
  if (staticRows.length === 0 && liveRows.length === 0) return [];

  return normalizeTransactions([...staticRows, ...liveRows], { freeAgentPrice });
}
