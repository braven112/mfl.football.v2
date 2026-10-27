/**
 * One league's transactions feed for the MFL Football app (package O),
 * for ANY MFL league the signed-in account is in.
 *
 * The site's `/transactions` page reads TheLeague's and the AFL's committed
 * feeds. An outside league has none, so this reads MFL live with the owner's
 * own cookie (a private league's export needs it), caches the PARSED rows for
 * a minute per league-year, and hands them to the app as names.
 *
 * ONE PARSER. Every MFL row goes through `normalizeTransactions`
 * (`src/utils/mfl-transactions.ts`), the same normalizer the site's ledger
 * uses. Nothing here reads a pipe string. The push thread's trade and waiver
 * alerts call `readLeagueTransactionRows` for the same reason
 * (docs/claude/rules/schefter.md, "A parity test is only as strong as its
 * corpus").
 *
 * The route (`src/pages/api/mfl-live/transactions.ts`) owns auth and the
 * league check through F2's `requireOwnerLeague`; everything after that is
 * here and takes its reader as an input, so it tests without Redis or MFL.
 */

import type {
  MflLiveAppTransaction,
  MflLiveAppTransactionKind,
  MflLiveAppTransactionsFeed,
  MflLiveAppTxPlayer,
  MflLiveAppTxTeam,
} from '../../../packages/shared-types/src/mfl-live-app-o';
import { mflFetch } from '../mfl-fetch';
import { buildMflExportUrl } from '../mfl-url';
import { formatMflName } from '../player-name-matching';
import { getRedis } from '../redis-client';
import { readLeagueFranchiseNames } from '../broadcast-live-source';
import { appJson } from './owner-league';
import {
  extractTransactionRows,
  normalizeTransactions,
  playerIdsInRow,
  type DraftPickRef,
  type TransactionKind,
  type TransactionRow,
} from '../mfl-transactions';

/**
 * The league the account was verified to be in: the `league` half of F2's
 * `requireOwnerLeague` (src/utils/live/owner-league.ts). Restated as the
 * fields this file reads so it stays testable on its own.
 */
export interface OwnerLeagueRef {
  leagueId: string;
  leagueName: string;
  year: number;
  host: string | null;
  franchiseId: string;
  franchiseName: string;
}

interface PlayerInfo {
  name: string;
  position: string;
  nflTeam: string;
}

/** Everything one league-year's feed needs, as cached. */
export interface LeagueTransactionsSnapshot {
  rows: TransactionRow[];
  franchises: Record<string, string>;
  players: Record<string, PlayerInfo>;
  fetchedAt: number;
}

/** Re-read MFL at most once a minute per league, like the site's roster and transaction caches. */
const FRESH_MS = 60_000;
/** Kept this long so a failed refresh can still serve the last good read. */
const KEEP_SECONDS = 60 * 60;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/** MFL's players export takes a comma list; keep each URL short. */
const PLAYER_CHUNK = 150;

function cacheKey(league: OwnerLeagueRef): string {
  // Host in the key: MFL validates neither half of host + L, and a server
  // asked for a league it does not host answers with its OWN league
  // (see readLeagueFranchiseMarks).
  return `mfl-live:transactions:${league.leagueId}:${league.host ?? 'api'}:${league.year}`;
}

/** MFL's error-as-200 shape: `{ error: { $t: '…' } }` or `{ error: '…' }`. */
function mflError(body: unknown): string | null {
  const err = (body as { error?: unknown } | null)?.error;
  if (!err) return null;
  if (typeof err === 'string') return err;
  const text = (err as { $t?: unknown }).$t;
  return typeof text === 'string' ? text : 'MFL returned an error';
}

async function readJson(url: string, mflUserCookie: string): Promise<unknown> {
  const response = await mflFetch({ url, method: 'GET', mflUserCookie });
  if (!response.ok) throw new Error(`MFL ${response.status}`);
  // A throttled MFL answers with HTML, and an error with a 200: read the body.
  const body = await response.json().catch(() => null);
  if (body === null) throw new Error('MFL sent no JSON');
  const error = mflError(body);
  if (error) throw new Error(error);
  return body;
}

async function readPlayers(
  ids: string[],
  year: number,
  mflUserCookie: string,
): Promise<Record<string, PlayerInfo>> {
  const players: Record<string, PlayerInfo> = {};
  for (let i = 0; i < ids.length; i += PLAYER_CHUNK) {
    const chunk = ids.slice(i, i + PLAYER_CHUNK);
    try {
      // Players are league-independent; the api host serves every league's.
      const body = await readJson(
        `https://api.myfantasyleague.com/${year}/export?TYPE=players&PLAYERS=${chunk.join(',')}&JSON=1`,
        mflUserCookie,
      );
      const raw = (body as { players?: { player?: unknown } }).players?.player;
      for (const p of Array.isArray(raw) ? raw : raw ? [raw] : []) {
        const row = p as { id?: unknown; name?: unknown; position?: unknown; team?: unknown };
        const id = `${row.id ?? ''}`.trim();
        if (!id) continue;
        players[id] = {
          name: formatMflName(`${row.name ?? ''}`.trim()),
          position: `${row.position ?? ''}`.trim(),
          nflTeam: `${row.team ?? ''}`.trim(),
        };
      }
    } catch {
      // A missing name degrades to its id in the view; it never costs the feed.
    }
  }
  return players;
}

/** Read one league-year from MFL, parsed and named. Throws when the transactions themselves can't be read. */
export async function fetchLeagueTransactions(
  league: OwnerLeagueRef,
  mflUserCookie: string,
): Promise<LeagueTransactionsSnapshot> {
  const url = buildMflExportUrl({
    type: 'transactions',
    leagueId: league.leagueId,
    year: league.year,
    ...(league.host ? { host: league.host } : {}),
  });
  const [body, franchises] = await Promise.all([
    readJson(url, mflUserCookie),
    readLeagueFranchiseNames(
      {
        id: league.leagueId,
        name: league.leagueName,
        franchiseId: league.franchiseId,
        franchiseName: league.franchiseName,
        registered: null,
        host: league.host,
        isSession: false,
      },
      league.year,
      mflUserCookie,
    ).catch(() => ({}) as Record<string, string>),
  ]);

  // No free-agent price: what an FCFS pickup costs is a league convention
  // (TheLeague signs at its minimum) that an outside league does not share.
  const rows = normalizeTransactions(extractTransactionRows(body));
  const ids = [...new Set(rows.flatMap(playerIdsInRow))].sort();
  const players = await readPlayers(ids, league.year, mflUserCookie);
  return { rows, franchises, players, fetchedAt: Date.now() };
}

/**
 * The league-year's parsed rows, from cache when under a minute old, else
 * from MFL. A failed refresh serves the last good read rather than nothing;
 * with no cache at all, the error propagates.
 */
export async function readLeagueTransactions(
  league: OwnerLeagueRef,
  mflUserCookie: string,
  deps: { fetch?: typeof fetchLeagueTransactions; now?: () => number } = {},
): Promise<LeagueTransactionsSnapshot> {
  const load = deps.fetch ?? fetchLeagueTransactions;
  const now = deps.now ?? Date.now;
  const redis = await getRedis().catch(() => null);
  const key = cacheKey(league);

  let cached: LeagueTransactionsSnapshot | null = null;
  if (redis) {
    try {
      cached = await redis.get<LeagueTransactionsSnapshot>(key);
    } catch {
      cached = null;
    }
    if (cached && now() - cached.fetchedAt < FRESH_MS) return cached;
  }

  try {
    const fresh = await load(league, mflUserCookie);
    if (redis) {
      await redis.set(key, fresh, { ex: KEEP_SECONDS }).catch(() => undefined);
    }
    return fresh;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

/** Just the parsed rows, newest first — the entry point for the push alerts. */
export async function readLeagueTransactionRows(
  league: OwnerLeagueRef,
  mflUserCookie: string,
): Promise<TransactionRow[]> {
  return (await readLeagueTransactions(league, mflUserCookie)).rows;
}

// ---------------------------------------------------------------------------
// The view

/** The app's filter chips. `adds` is every signing; `trades` is trades. */
export type MflLiveTxFilter = 'all' | 'adds' | 'trades' | 'mine';

const ADD_KINDS: ReadonlySet<TransactionKind> = new Set(['free-agent', 'waiver', 'blind-bid', 'auction']);

function teamRef(id: string, snapshot: LeagueTransactionsSnapshot, mine: string): MflLiveAppTxTeam {
  return { franchiseId: id, name: snapshot.franchises[id] || `Team ${id}`, mine: id === mine };
}

function playerRef(id: string, snapshot: LeagueTransactionsSnapshot): MflLiveAppTxPlayer {
  const p = snapshot.players[id];
  return {
    id,
    name: p?.name || `Player ${id}`,
    position: p?.position ?? '',
    nflTeam: p?.nflTeam ?? '',
  };
}

/** "2027 Round 1 (Bring The Pain)" for a future pick, "Round 2, Pick 4" for a current one. */
export function pickLabel(pick: DraftPickRef, franchises: Record<string, string>): string {
  if (pick.scope === 'current') {
    return pick.pick ? `Round ${pick.round}, Pick ${pick.pick}` : `Round ${pick.round}`;
  }
  const owner = pick.franchiseId ? franchises[pick.franchiseId] : '';
  const year = pick.year ? `${pick.year} ` : '';
  return `${year}Round ${pick.round}${owner ? ` (${owner})` : ''}`;
}

export function toAppTransaction(
  row: TransactionRow,
  snapshot: LeagueTransactionsSnapshot,
  myFranchiseId: string,
): MflLiveAppTransaction {
  const view: MflLiveAppTransaction = {
    id: row.id,
    at: row.at,
    kind: row.kind as MflLiveAppTransactionKind,
    team: teamRef(row.franchiseId, snapshot, myFranchiseId),
    added: row.added.map((id) => playerRef(id, snapshot)),
    dropped: row.dropped.map((id) => playerRef(id, snapshot)),
    amount: row.amount,
    byCommish: row.byCommish,
  };
  if (row.trade) {
    const [a, b] = row.trade.sides.map((side) => ({
      team: teamRef(side.franchiseId, snapshot, myFranchiseId),
      players: side.players.map((id) => playerRef(id, snapshot)),
      picks: side.picks.map((pick) => pickLabel(pick, snapshot.franchises)),
    }));
    view.trade = { sides: [a, b], comments: row.trade.comments };
  }
  return view;
}

function involves(row: TransactionRow, franchiseId: string): boolean {
  if (row.trade) return row.trade.sides.some((side) => side.franchiseId === franchiseId);
  return row.franchiseId === franchiseId;
}

function matchesFilter(row: TransactionRow, filter: MflLiveTxFilter, mine: string): boolean {
  if (filter === 'adds') return ADD_KINDS.has(row.kind);
  if (filter === 'trades') return row.kind === 'trade';
  if (filter === 'mine') return involves(row, mine);
  return true;
}

/**
 * The cursor is the last row's `at` and `id`. The normalizer's order is total
 * (newest first, ties by id ascending), and a blind-bid run stamps every claim
 * with ONE timestamp, so a time alone would skip or repeat rows across pages.
 */
function cursorOf(row: TransactionRow): string {
  return `${row.at}_${row.id}`;
}

function isOlderThan(row: TransactionRow, before: string): boolean {
  const cut = before.indexOf('_');
  const at = Number(before.slice(0, cut));
  const id = before.slice(cut + 1);
  if (cut < 0 || !Number.isFinite(at)) return true;
  return row.at < at || (row.at === at && row.id > id);
}

export interface FeedQuery {
  filter: MflLiveTxFilter;
  limit: number;
  before: string | null;
}

export function buildTransactionsFeed(
  league: OwnerLeagueRef,
  snapshot: LeagueTransactionsSnapshot,
  query: FeedQuery,
): MflLiveAppTransactionsFeed {
  const matching = snapshot.rows.filter(
    (row) =>
      matchesFilter(row, query.filter, league.franchiseId) &&
      (query.before === null || isOlderThan(row, query.before)),
  );
  const page = matching.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    leagueId: league.leagueId,
    leagueName: league.leagueName,
    year: league.year,
    myFranchiseId: league.franchiseId,
    transactions: page.map((row) => toAppTransaction(row, snapshot, league.franchiseId)),
    nextBefore: matching.length > page.length && last ? cursorOf(last) : null,
    fetchedAt: snapshot.fetchedAt,
  };
}

const FILTERS: readonly MflLiveTxFilter[] = ['all', 'adds', 'trades', 'mine'];

export function parseFeedQuery(params: URLSearchParams): FeedQuery {
  const rawFilter = params.get('filter') ?? 'all';
  const filter = (FILTERS as readonly string[]).includes(rawFilter) ? (rawFilter as MflLiveTxFilter) : 'all';
  const rawLimit = Number(params.get('limit'));
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const before = params.get('before');
  return { filter, limit, before: before && /^\d+_.+$/.test(before) ? before : null };
}

// ---------------------------------------------------------------------------
// The response

/**
 * The 200 for `GET /api/mfl-live/transactions?league=&filter=&limit=&before=`,
 * once the route's `requireOwnerLeague` has answered every refusal (signed
 * out, no league, not your league). A 502 when MFL can't be read and nothing
 * is cached.
 */
export async function transactionsResponse(
  league: OwnerLeagueRef,
  mflUserCookie: string,
  params: URLSearchParams,
  read: (league: OwnerLeagueRef, mflUserCookie: string) => Promise<LeagueTransactionsSnapshot> = readLeagueTransactions,
): Promise<Response> {
  let snapshot: LeagueTransactionsSnapshot;
  try {
    snapshot = await read(league, mflUserCookie);
  } catch {
    return appJson({ ok: false, message: 'MFL did not answer. Pull down to try again.' }, 502);
  }
  return appJson(buildTransactionsFeed(league, snapshot, parseFeedQuery(params)));
}
