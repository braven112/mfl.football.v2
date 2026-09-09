/**
 * MFL transactions → one normalized row shape.
 *
 * The `TYPE=transactions` export is the least uniform feed MFL publishes: the
 * same concept is encoded differently per league, per era, and sometimes per
 * row. Everything below is a shape observed in the committed archive
 * (TheLeague 2007→, the AFL 2003→ — 22 types, ~37k rows), not a guess.
 *
 * PURE ON PURPOSE. No fs, no player lookup, no league registry. Callers hand
 * it a parsed feed and get ids back; names, crests and salaries are resolved
 * upstream in the view layer. That is what lets the whole surface be tested
 * against real archived feeds without a build.
 *
 * The traps, each of which is a row count in the archive:
 *
 * 1. TWO WAIVER ENCODINGS, BOTH LEAGUES. `BBID_WAIVER` (TheLeague, 1,297
 *    rows) packs everything into one pipe string; plain `WAIVER` (1,477 in
 *    TheLeague, 7,083 in the AFL) uses discrete `added`/`dropped` FIELDS. It
 *    is tempting to read the 2026 feed and conclude the string form is
 *    TheLeague's and the field form is the AFL's — that is wrong in both
 *    directions and drops thousands of rows.
 *
 * 2. `added` AND `dropped` ARE BOTH LISTS. 926 waiver rows drop more than one
 *    player and 97 add more than one; drop-only `FREE_AGENT` rows carry up to
 *    seven (`"|16342,14823,13299,13595,7836,10413,16757,"`). Anything that
 *    reads `split(',')[0]` silently swallows the rest.
 *
 * 3. THE PIPE COUNT VARIES WITHIN A TYPE. `AUCTION_WON` appears as both
 *    `"12140|425000|"` (3 segments) and `"12140|425000"` (2) — 1,190 and
 *    1,770 rows respectively. Read segments by INDEX, never by length.
 *
 * 4. THE COMMA IS NOT CONSISTENT ACROSS TYPES. `FREE_AGENT` and the waiver
 *    types terminate every id with a comma; the auction types do not. Split
 *    and filter empties rather than trusting either.
 *
 * 5. SYSTEM ROWS CARRY AN EMPTY `franchise`. So do 26 real `AUCTION_WON` rows
 *    and 22 `IR` rows — an empty franchise is not by itself proof a row is
 *    system-generated, so both checks have to exist independently.
 */

import {
  parsePickToken as parsePickTokenImpl,
  splitTradeAssets as splitTradeAssetsImpl,
} from './mfl-pick-tokens.mjs';

/** The move classes this ledger reports. */
export type TransactionKind = 'free-agent' | 'waiver' | 'blind-bid' | 'auction' | 'trade';

/**
 * MFL raw type → our kind. Anything absent from this map is excluded, which is
 * the deliberate half of the design:
 *
 *   IR, TAXI                      roster mechanics, not signings
 *   AUCTION_BID, AUCTION_INIT     the bidding war behind an AUCTION_WON
 *                                 (7,309 + 947 rows — they would bury the feed)
 *   LOCK_ALL_PLAYERS,
 *   UNLOCK_ALL_PLAYERS,
 *   AUTO_PROCESS_WAIVERS,
 *   BBID_AUTO_PROCESS_WAIVERS,
 *   PROCESS_WAIVERS, LOAD_ROSTERS the system or a bulk commissioner import
 */
const KIND_BY_MFL_TYPE: Readonly<Record<string, TransactionKind>> = {
  FREE_AGENT: 'free-agent',
  WAIVER: 'waiver',
  BBID_WAIVER: 'blind-bid',
  AUCTION_WON: 'auction',
  TRADE: 'trade',
};

/** A draft pick traded as an asset. MFL writes two different notations. */
export interface DraftPickRef {
  /** The token exactly as the feed wrote it, for debugging and signatures. */
  raw: string;
  /**
   * `future` is `FP_<franchise>_<year>_<round>` — a pick in a draft that has
   * not been held. `current` is `DP_<round>_<pick>`, a slot in the draft
   * being conducted now, and BOTH of its numbers are ZERO-BASED
   * (`DP_0_11` is round 1, pick 12).
   */
  scope: 'future' | 'current';
  /** Originating franchise. Only `FP_` encodes it; `DP_` does not. */
  franchiseId: string | null;
  /** Draft year. Only `FP_` encodes it. */
  year: number | null;
  /** 1-based round, normalized from whichever notation was used. */
  round: number;
  /** 1-based pick within the round. Only `DP_` encodes it. */
  pick: number | null;
}

/** One franchise's outgoing half of a trade. */
export interface TradeSide {
  franchiseId: string;
  /** MFL player ids given up. */
  players: string[];
  picks: DraftPickRef[];
}

export interface TransactionRow {
  /**
   * Stable across re-fetches and content-addressed, because MFL gives rows no
   * id of their own and `type+timestamp+franchise` genuinely collides: a
   * blind-bid batch processes every claim in a league on one timestamp.
   */
  id: string;
  /** Epoch MILLISECONDS. MFL sends epoch seconds in a string. */
  at: number;
  kind: TransactionKind;
  /** The original MFL type, kept so the UI can label a waiver flavour exactly. */
  rawType: string;
  franchiseId: string;
  /** MFL player ids joining the roster. */
  added: string[];
  /** MFL player ids leaving it. Frequently longer than `added`. */
  dropped: string[];
  /** Populated only when `kind === 'trade'`. */
  trade: { sides: [TradeSide, TradeSide]; comments: string } | null;
  /**
   * What the move cost, in whole dollars, or null when unknowable. Bids come
   * from the feed; free agents are priced at `freeAgentPrice` (see options).
   */
  amount: number | null;
  /** MFL sets `by_commish` when the commissioner acted for the franchise. */
  byCommish: boolean;
}

export interface NormalizeOptions {
  /**
   * What a first-come-first-served pickup costs. TheLeague signs every FCFS
   * free agent at the league minimum, which lives in the `league.json` export
   * as `bbidMinimum` — pass it through rather than writing the number here, so
   * the figure stays per-season and `tests/league-literal-guard.test.ts` has
   * nothing to catch. Leagues without a salary cap pass null.
   */
  freeAgentPrice?: number | null;
}

/** MFL returns one row as an object, many as an array, none as undefined. */
function toArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === 'object') return [raw as Record<string, unknown>];
  return [];
}

/**
 * Unwrap whichever level of MFL's envelope the caller happened to have:
 * the whole export, the inner `transactions` object, or the bare array.
 */
export function extractTransactionRows(feed: unknown): Record<string, unknown>[] {
  if (Array.isArray(feed)) return feed as Record<string, unknown>[];
  const f = feed as { transactions?: { transaction?: unknown }; transaction?: unknown } | null;
  return toArray(f?.transactions?.transaction ?? f?.transaction);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * Split a comma-delimited id list. Handles both the comma-TERMINATED form the
 * roster types use (`"17048,"`) and the bare form the auction types use
 * (`"12140"`) — see trap 4.
 */
function splitIds(value: unknown): string[] {
  return str(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Epoch seconds (as a string) → epoch ms, or null when unusable. */
function toMillis(value: unknown): number | null {
  const seconds = Number(str(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

/** A dollar figure from the feed, or null. Zero is a real "no bid", not a price. */
function toAmount(value: unknown): number | null {
  const n = Number(str(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * `by_commish` is `"1"` when set and absent otherwise. Anything truthy and
 * not `"0"` counts, so a future `"Y"` still trips it.
 */
function isCommishExecuted(value: unknown): boolean {
  const flag = str(value).trim();
  return flag !== '' && flag !== '0';
}

/**
 * Parse a traded asset token into a draft pick, or null if it is a player id.
 *
 * The implementation lives in `mfl-pick-tokens.mjs` because
 * `scripts/schefter-scan.mjs` runs as bare node and cannot import TypeScript;
 * this wrapper is the typed door onto it. Both notations are live in the
 * archive and `DP_` is the MORE common of the two (683 tokens against 543
 * `FP_`), spanning 2007–2026 in both leagues — so a parser that only matches
 * `FP_` renders the majority of traded picks as a player id resolving to
 * nobody, which is precisely the bug the sharing fixes.
 */
export const parsePickToken = parsePickTokenImpl as (token: string) => DraftPickRef | null;

/** Split one side of a trade into the players and the picks it gave up. */
export function parseTradeSide(franchiseId: string, raw: unknown): TradeSide {
  const { players, picks } = splitTradeAssetsImpl(raw) as {
    players: string[];
    picks: DraftPickRef[];
  };
  return { franchiseId, players, picks };
}

/**
 * Content-addressed row id.
 *
 * MFL rows have no identifier, and the obvious composite key collides for
 * real: a blind-bid run stamps every claim in the league with the deadline's
 * single timestamp, so `BBID_WAIVER-1788400800-0008` is not unique across a
 * franchise's two claims. Folding the payload in makes the id both unique and
 * stable across re-fetches, which is what the UI needs for a filter anchor.
 */
function rowId(type: string, at: number, franchiseId: string, payload: string): string {
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) | 0;
  }
  return `${type}-${at}-${franchiseId || 'none'}-${(hash >>> 0).toString(36)}`;
}

/**
 * Normalize one raw MFL row, or null if it is not a signing we report.
 *
 * Returns null rather than throwing for every rejection — an unknown type, a
 * system row, a corrupt timestamp — because one malformed row in a 20-year
 * archive should cost that row, not the page.
 */
export function normalizeTransaction(
  raw: Record<string, unknown>,
  options: NormalizeOptions = {}
): TransactionRow | null {
  const rawType = str(raw.type).trim().toUpperCase();
  const kind = KIND_BY_MFL_TYPE[rawType];
  if (!kind) return null;

  const at = toMillis(raw.timestamp);
  if (at === null) return null;

  const franchiseId = str(raw.franchise).trim();
  // Trap 5: a row with no franchise cannot be attributed, filtered by team or
  // rendered with a crest. 26 AUCTION_WON rows in the archive are like this.
  if (!franchiseId) return null;

  const byCommish = isCommishExecuted(raw.by_commish);

  if (kind === 'trade') {
    const franchiseId2 = str(raw.franchise2).trim();
    if (!franchiseId2) return null;
    const sides: [TradeSide, TradeSide] = [
      parseTradeSide(franchiseId, raw.franchise1_gave_up),
      parseTradeSide(franchiseId2, raw.franchise2_gave_up),
    ];
    return {
      id: rowId(rawType, at, franchiseId, `${franchiseId2}|${str(raw.franchise1_gave_up)}|${str(raw.franchise2_gave_up)}`),
      at,
      kind,
      rawType,
      franchiseId,
      // A trade's movement is per-side; added/dropped would have to pick a
      // point of view, so they stay empty and `trade` carries the detail.
      added: [],
      dropped: [],
      trade: { sides, comments: str(raw.comments) },
      amount: null,
      byCommish,
    };
  }

  let added: string[] = [];
  let dropped: string[] = [];
  let amount: number | null = null;

  if (rawType === 'WAIVER') {
    // Trap 1: the field form. Trap 2: both sides are lists.
    added = splitIds(raw.added);
    dropped = splitIds(raw.dropped);
  } else {
    // Trap 3: index the segments, never count them.
    const segments = str(raw.transaction).split('|');
    if (rawType === 'BBID_WAIVER') {
      added = splitIds(segments[0]);
      amount = toAmount(segments[1]);
      dropped = splitIds(segments[2]);
    } else if (rawType === 'AUCTION_WON') {
      added = splitIds(segments[0]);
      amount = toAmount(segments[1]);
    } else {
      // FREE_AGENT: "added,|dropped,"
      added = splitIds(segments[0]);
      dropped = splitIds(segments[1]);
    }
  }

  if (added.length === 0 && dropped.length === 0) return null;

  // FCFS pickups sign at the league minimum. Only price an actual arrival —
  // a drop-only row costs nothing, and stamping it with the minimum would
  // read as though the franchise had paid to release someone.
  if (amount === null && rawType === 'FREE_AGENT' && added.length > 0) {
    const price = options.freeAgentPrice;
    amount = typeof price === 'number' && price > 0 ? price : null;
  }

  return {
    id: rowId(rawType, at, franchiseId, `${added.join('.')}|${dropped.join('.')}|${amount ?? ''}`),
    at,
    kind,
    rawType,
    franchiseId,
    added,
    dropped,
    trade: null,
    amount,
    byCommish,
  };
}

/**
 * Normalize a whole feed, newest first, with exact duplicates collapsed.
 *
 * SORTED HERE rather than left to the caller because MFL's array order is
 * nondeterministic (docs/claude/rules/storage-and-build.md) — a ledger that
 * inherited it would reshuffle itself on every sync. Ties break on `id` so the
 * order is total and two renders of the same data agree.
 *
 * DEDUPED because MFL sometimes writes the same event twice. TheLeague's
 * archive carries two such pairs, both `AUCTION_WON` (2012-07-10 and
 * 2017-05-27): identical franchise, timestamp, player and price, emitted as
 * two records. They are one signing, and rendering the row twice reads as a
 * bug to anyone looking at the page. Since `id` is content-addressed, an id
 * collision IS the statement that two rows describe the same event — a
 * uniquifying counter would defeat the check rather than pass it.
 */
export function normalizeTransactions(
  feed: unknown,
  options: NormalizeOptions = {}
): TransactionRow[] {
  const byId = new Map<string, TransactionRow>();
  for (const raw of extractTransactionRows(feed)) {
    const row = normalizeTransaction(raw, options);
    if (row && !byId.has(row.id)) byId.set(row.id, row);
  }
  const rows = [...byId.values()];
  rows.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/** Every MFL player id a row touches — the join key for name resolution. */
export function playerIdsInRow(row: TransactionRow): string[] {
  if (row.trade) return row.trade.sides.flatMap((side) => side.players);
  return [...row.added, ...row.dropped];
}
