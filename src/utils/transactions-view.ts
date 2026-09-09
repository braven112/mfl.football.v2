/**
 * Filtering and grouping the transactions ledger.
 *
 * Everything here is applied SERVER-SIDE so the first paint is already the
 * filtered view — a shared link to `?team=0007&week=3` must render that, not
 * flash the unfiltered ledger and then narrow.
 *
 * Pure: rows in, rows out, plus the small amount of URL parsing that decides
 * which. No fs, no cookies, no Astro.
 */

import { getCurrentNFLWeek } from './current-week';
import type { TransactionKind, TransactionRow } from './mfl-transactions';

export const ALL_KINDS: readonly TransactionKind[] = [
  'free-agent',
  'waiver',
  'blind-bid',
  'auction',
  'trade',
];

/**
 * What the page shows before anyone touches a filter: the signings.
 *
 * Trades are excluded by DEFAULT rather than by omission — they are in the
 * data and one checkbox away. The page is a roster-move ledger whose opening
 * view answers "who got picked up", which is the in-season question.
 */
export const DEFAULT_KINDS: readonly TransactionKind[] = [
  'free-agent',
  'waiver',
  'blind-bid',
  'auction',
];

export interface TransactionFilters {
  year: number;
  /** Franchise id, or null for the whole league. */
  team: string | null;
  /** Free-text player search, lowercased and trimmed. Empty means no search. */
  query: string;
  /** NFL week, or null. */
  week: number | null;
  /** Inclusive date bounds, epoch ms, or null. */
  from: number | null;
  to: number | null;
  kinds: Set<TransactionKind>;
  /**
   * True when `?types=` named the kinds, false when they are the defaults.
   *
   * The distinction matters for which checkboxes get OFFERED: the default set
   * includes auction and blind-bid, so treating it as an explicit choice would
   * re-add exactly the two dead controls `kindsPresentIn` exists to drop.
   */
  kindsExplicit: boolean;
  /** True when `?mine=1` resolved to a real franchise for the signed-in user. */
  mine: boolean;
}

const isKind = (v: string): v is TransactionKind =>
  (ALL_KINDS as readonly string[]).includes(v);

/** Parse `YYYY-MM-DD` as UTC midnight, or null. */
function parseDate(value: string | null, endOfDay = false): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = Date.parse(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isFinite(at) ? at : null;
}

export interface ParseFiltersInput {
  params: URLSearchParams;
  year: number;
  /**
   * The signed-in owner's franchise IN THIS LEAGUE, or null. Resolved by the
   * route via `franchiseIdForLeague` — a TheLeague owner browsing the AFL has
   * no franchise here, so `?mine=1` correctly resolves to nothing rather than
   * filtering the AFL by TheLeague's franchise 0001.
   */
  myFranchiseId: string | null;
}

/**
 * URL → filters. Every bad value degrades to "no filter" rather than erroring:
 * these are query params, so a hand-edited one is expected, not exceptional.
 */
export function parseFilters(input: ParseFiltersInput): TransactionFilters {
  const { params, year, myFranchiseId } = input;

  // BOTH shapes, because both occur. A checkbox group posts one `types=` param
  // PER BOX (`?types=free-agent&types=auction`), so `params.get` would read the
  // first and silently drop the rest — every box ticked would filter to free
  // agents alone. A hand-written or shortened link uses the comma form
  // (`?types=free-agent,auction`). Reading getAll and splitting each covers
  // them together.
  const requestedKinds = params
    .getAll('types')
    .flatMap((value) => value.split(','))
    .map((s) => s.trim())
    .filter(isKind);
  const kindsExplicit = requestedKinds.length > 0;
  const kinds = new Set<TransactionKind>(kindsExplicit ? requestedKinds : DEFAULT_KINDS);

  const weekRaw = Number(params.get('week'));
  const week = Number.isInteger(weekRaw) && weekRaw >= 1 && weekRaw <= 22 ? weekRaw : null;

  // `?mine=1` only means anything for someone with a franchise here. Resolving
  // it to the owner's id up front keeps `applyFilters` from needing the session.
  const mine = params.get('mine') === '1' && Boolean(myFranchiseId);
  const team = mine ? myFranchiseId : (params.get('team') || null);

  return {
    year,
    team,
    query: (params.get('q') ?? '').trim().toLowerCase(),
    week,
    from: parseDate(params.get('from')),
    to: parseDate(params.get('to'), true),
    kinds,
    kindsExplicit,
    mine,
  };
}

/**
 * Which kind filters are worth OFFERING for this season.
 *
 * The AFL has never run an auction or a blind bid — not once in 24 years of
 * archive — so rendering those two checkboxes on its page gives every AFL
 * owner two controls that can only ever return nothing. Deriving the list from
 * the season's own rows keeps each league (and each season) honest about what
 * it actually has.
 *
 * `keep` is unioned in so a shared link's active filter always has a visible
 * checkbox: land on `?types=trade` in a season with no trades and the box must
 * still render, checked, or there is no way to switch it back off.
 */
export function kindsPresentIn(
  rows: TransactionRow[],
  keep: Iterable<TransactionKind> = []
): TransactionKind[] {
  const present = new Set<TransactionKind>(keep);
  for (const row of rows) present.add(row.kind);
  return ALL_KINDS.filter((kind) => present.has(kind));
}

/** True when no filter is narrowing the ledger beyond the default kinds. */
export function isDefaultView(filters: TransactionFilters): boolean {
  return (
    !filters.team &&
    !filters.query &&
    filters.week === null &&
    filters.from === null &&
    filters.to === null &&
    filters.kinds.size === DEFAULT_KINDS.length &&
    DEFAULT_KINDS.every((k) => filters.kinds.has(k))
  );
}

/** Every franchise a row is attributable to — both sides, for a trade. */
export function franchisesInRow(row: TransactionRow): string[] {
  if (row.trade) return row.trade.sides.map((s) => s.franchiseId);
  return [row.franchiseId];
}

/** Every MFL player id a row touches. */
export function playersInRow(row: TransactionRow): string[] {
  if (row.trade) return row.trade.sides.flatMap((s) => s.players);
  return [...row.added, ...row.dropped];
}

/**
 * The NFL week a move falls in, or null outside the season.
 *
 * `getCurrentNFLWeek` takes an arbitrary date, so no new date math — but note
 * a league year outlives its NFL season (TheLeague's 2025 feed carries moves
 * into Feb 2026), and those late rows clamp to the last playoff week. That is
 * the correct answer for early February and a slight overstatement for the
 * handful of rows right at the league-year rollover.
 */
export function weekOf(row: TransactionRow, seasonYear: number): number | null {
  return getCurrentNFLWeek(new Date(row.at), seasonYear);
}

export interface ApplyFiltersInput {
  rows: TransactionRow[];
  filters: TransactionFilters;
  /** MFL player id → display name, for the search box. */
  nameOf: (playerId: string) => string | undefined;
}

export function applyFilters(input: ApplyFiltersInput): TransactionRow[] {
  const { rows, filters, nameOf } = input;
  return rows.filter((row) => {
    if (!filters.kinds.has(row.kind)) return false;
    if (filters.team && !franchisesInRow(row).includes(filters.team)) return false;
    if (filters.from !== null && row.at < filters.from) return false;
    if (filters.to !== null && row.at > filters.to) return false;
    if (filters.week !== null && weekOf(row, filters.year) !== filters.week) return false;
    if (filters.query) {
      const hit = playersInRow(row).some((id) =>
        (nameOf(id) ?? '').toLowerCase().includes(filters.query)
      );
      if (!hit) return false;
    }
    return true;
  });
}

/** Whether Intl will accept this string as a time zone. */
export function isUsableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface DayGroup {
  /** `YYYY-MM-DD` in the grouping zone — a stable key, not a display string. */
  key: string;
  /** "Sunday, September 7" in the grouping zone. */
  label: string;
  rows: TransactionRow[];
}

/**
 * Group rows into days IN A GIVEN ZONE.
 *
 * The zone is a parameter rather than UTC or the server's local time because
 * "what happened Sunday" has to mean the viewer's Sunday: a Sunday-evening
 * waiver claim in Pacific time is Monday in UTC, and grouping it under Monday
 * puts it on the wrong side of the week for the person reading.
 *
 * Rows must already be sorted newest-first; the normalizer guarantees that.
 */
export function groupByDay(rows: TransactionRow[], timeZone: string): DayGroup[] {
  // An unusable zone falls back to UTC rather than throwing. Intl rejects
  // anything that is not a real IANA id, and the zone reaching here comes from
  // a stored viewer preference — where "PT" is a zone ID, not a zone, and
  // handing it straight to Intl took the whole page down with "Invalid time
  // zone specified: PT". A ledger grouped in the wrong zone is a small bug; a
  // ledger that 500s is a broken page.
  const safeZone = isUsableTimeZone(timeZone) ? timeZone : 'UTC';
  const keyFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const labelFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const row of rows) {
    const at = new Date(row.at);
    const key = keyFmt.format(at);
    if (!current || current.key !== key) {
      current = { key, label: labelFmt.format(at), rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }
  return groups;
}

/**
 * Rebuild the querystring with one filter changed.
 *
 * Used for every filter control so a link is a real URL the server can render
 * — which is what makes the filtered view shareable and the back button work.
 * A null value REMOVES the param rather than writing an empty one.
 */
export function filterHref(
  basePath: string,
  params: URLSearchParams,
  changes: Record<string, string | null>
): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
