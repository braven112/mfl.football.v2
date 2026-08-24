/**
 * MFL league accounting — read the ledger, write records to it.
 *
 * Two MFL endpoints back this, and they do NOT have the same access model:
 *
 *   READ   export?TYPE=accounting&L=<id>&JSON=1   any league OWNER's cookie
 *   WRITE  import?TYPE=accounting&L=<id>          the COMMISSIONER's cookie
 *
 * The write takes ONE record per call (FRANCHISE, AMOUNT, DESCRIPTION) — there
 * is no batch form — so anything bulk (a CSV import, a season payout run) is a
 * loop, and a loop can fail halfway. Every bulk caller must report per-row
 * results rather than one success/failure for the batch; `writeAccountingRecords`
 * below is the shared implementation of that.
 *
 * ── SIGN CONVENTION ────────────────────────────────────────────────────────
 * MFL's two docs agree, and the direction is the opposite of what "amount owed"
 * intuition suggests, so it is stated once here and never re-derived:
 *
 *   POSITIVE  credits the franchise — a prize, a payout, money it has paid in
 *   NEGATIVE  charges the franchise — dues, fees, a fine
 *
 * A prize is therefore a POSITIVE amount. Writing a payout as a negative is the
 * bug this comment exists to prevent: it silently doubles the owner's bill
 * instead of paying them, and nothing in MFL's response distinguishes the two.
 * Callers holding a "prize of $300" should go through `creditAmount(300)`
 * rather than writing the sign by hand. Pinned by tests/mfl-accounting.test.ts.
 *
 * ── HOSTS ──────────────────────────────────────────────────────────────────
 * Commissioner imports are REJECTED on api.myfantasyleague.com — they must go
 * to the league's own MFL web host (www49 for TheLeague, www44 for the AFL).
 * That is why the write path takes the host from the registry entry and the
 * read path is free to use the api gateway. Same rule as mfl-contract-writer.
 */

import { mflFetch } from './mfl-fetch';
import { buildMflExportUrl } from './mfl-url';
import type { LeagueDefinition } from '../config/leagues';

/** MFL's api gateway is fine for reads; see the HOSTS note for writes. */
const READ_HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';

/** One line of the league ledger. */
export interface AccountingRecord {
  /** Zero-padded franchise id, e.g. "0001". */
  franchiseId: string;
  /** Dollars, in MFL's sign convention: positive credits the franchise. */
  amount: number;
  description: string;
  /** Unix seconds, when MFL reports one. */
  timestamp?: number;
  /** MFL's own record id, when it reports one. Absent on records we just built. */
  id?: string;
}

export interface AccountingLedger {
  records: AccountingRecord[];
  /** franchiseId -> summed amount, in the same sign convention as a record. */
  balances: Record<string, number>;
}

/** A prize of $300 credits the franchise. See the SIGN CONVENTION note. */
export const creditAmount = (dollars: number): number => Math.abs(dollars);

/** Dues of $100 charge the franchise. See the SIGN CONVENTION note. */
export const chargeAmount = (dollars: number): number => -Math.abs(dollars);

/** "$1,234.56", "(50)", "-25" -> a number. Returns null when unparseable. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (!text) return null;
  // Accounting parentheses mean negative: "(50.00)" is a $50 charge.
  let negate = false;
  if (/^\(.*\)$/.test(text)) {
    negate = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[$,\s]/g, '');
  if (!/^[+-]?\d*\.?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negate ? -value : value;
}

/** MFL pads franchise ids to four digits; a bare "1" must not be a new team. */
export function normalizeFranchiseId(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return /^\d+$/.test(text) ? text.padStart(4, '0') : text;
}

/** MFL collapses a one-element list to a bare object — the classic trap. */
const asArray = <T,>(value: T | T[] | undefined | null): T[] => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

/** Money formatted the way the ledger and every CSV export show it. */
export function formatAmount(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

/**
 * Flatten MFL's accounting export into records.
 *
 * MFL has shipped this payload in more than one shape and the docs describe
 * none of them precisely, so this accepts all the ones seen in the wild rather
 * than pinning one and breaking on the others:
 *
 *   { accounting: { franchise: [ { id, transaction: [...] } ] } }   nested
 *   { accounting: { transaction: [ { franchise_id, ... } ] } }      flat
 *   { accounting: { franchise: [ { id, balance } ] } }              summary only
 *
 * A summary-only payload yields balances with no records, which is a legitimate
 * state — NOT an error, and not an empty ledger either. Callers must not read
 * "no records" as "nothing has ever been charged".
 */
export function normalizeAccountingExport(raw: unknown): AccountingLedger {
  const root = (raw as any)?.accounting ?? raw;
  const records: AccountingRecord[] = [];
  const balances: Record<string, number> = {};

  const pushRecord = (franchiseId: string, entry: any) => {
    const amount = parseAmount(entry?.amount ?? entry?.AMOUNT);
    if (amount === null) return;
    const description = String(
      entry?.description ?? entry?.DESCRIPTION ?? entry?.comments ?? ''
    ).trim();
    const rawTimestamp = entry?.timestamp ?? entry?.time ?? entry?.date;
    const timestamp = Number(rawTimestamp);
    records.push({
      franchiseId,
      amount,
      description,
      ...(Number.isFinite(timestamp) && timestamp > 0 ? { timestamp } : {}),
      ...(entry?.id != null ? { id: String(entry.id) } : {}),
    });
  };

  for (const franchise of asArray<any>(root?.franchise)) {
    const franchiseId = normalizeFranchiseId(franchise?.id ?? franchise?.franchise_id);
    if (!franchiseId) continue;
    // A franchise node may carry its own running balance. Prefer MFL's when it
    // states one — it is authoritative over anything we re-add ourselves.
    const stated = parseAmount(franchise?.balance ?? franchise?.amount);
    const entries = asArray<any>(franchise?.transaction ?? franchise?.record);
    for (const entry of entries) pushRecord(franchiseId, entry);
    if (stated !== null && entries.length === 0) balances[franchiseId] = stated;
  }

  // Flat shape: transactions hang off the root and name their own franchise.
  for (const entry of asArray<any>(root?.transaction)) {
    const franchiseId = normalizeFranchiseId(entry?.franchise_id ?? entry?.franchise ?? entry?.id);
    if (!franchiseId) continue;
    pushRecord(franchiseId, entry);
  }

  for (const record of records) {
    balances[record.franchiseId] = (balances[record.franchiseId] ?? 0) + record.amount;
  }

  // Newest first — the order a commissioner reads a ledger in. Records with no
  // timestamp keep their source order at the end rather than sorting to 1970.
  records.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  return { records, balances };
}

export interface FetchLedgerOptions {
  leagueId: string;
  year: string | number;
  /** An owner's MFL_USER_ID cookie. The export is owner-gated. */
  mflUserCookie: string;
  mflCommishCookie?: string;
}

export type FetchLedgerResult =
  | { ok: true; ledger: AccountingLedger }
  | { ok: false; error: string };

/**
 * Read the league ledger.
 *
 * MFL answers an unauthenticated request to this endpoint with HTTP 200 and an
 * EMPTY BODY rather than a 401 (verified against league 13522). An empty body
 * is therefore an auth failure, never an empty ledger, and must not be reported
 * as "no records" — that would render a page saying every owner is square.
 */
export async function fetchAccountingLedger(
  opts: FetchLedgerOptions
): Promise<FetchLedgerResult> {
  const url = buildMflExportUrl({
    type: 'accounting',
    leagueId: opts.leagueId,
    year: opts.year,
    host: READ_HOST,
  });

  let response: Response;
  try {
    response = await mflFetch({
      url,
      method: 'GET',
      mflUserCookie: opts.mflUserCookie,
      mflCommishCookie: opts.mflCommishCookie,
    });
  } catch (error) {
    return { ok: false, error: `Could not reach MFL: ${(error as Error).message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `MFL returned HTTP ${response.status}` };
  }

  const text = (await response.text()).trim();
  if (!text) {
    return {
      ok: false,
      error: 'MFL returned an empty accounting response — the session is not authorized to read this league’s ledger.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `MFL returned a non-JSON accounting response: ${text.slice(0, 120)}` };
  }

  const mflError = (parsed as any)?.error;
  if (mflError) {
    const message = typeof mflError === 'string' ? mflError : mflError?.message ?? 'unknown error';
    return { ok: false, error: `MFL error: ${message}` };
  }

  return { ok: true, ledger: normalizeAccountingExport(parsed) };
}

export interface WriteRecordInput {
  franchiseId: string;
  /** MFL sign convention — positive credits. Use creditAmount/chargeAmount. */
  amount: number;
  description: string;
}

export interface WriteRecordOptions {
  league: Pick<LeagueDefinition, 'id' | 'mflHost'>;
  year: string | number;
  /** The commissioner's MFL_USER_ID cookie. */
  mflUserCookie: string;
  /** The MFL_IS_COMMISH cookie. MFL rejects the import without commissioner rights. */
  mflCommishCookie?: string;
}

export interface WriteRecordResult {
  ok: boolean;
  error?: string;
}

/** MFL rejects an empty DESCRIPTION, and a ledger of blank lines is useless anyway. */
export const MAX_DESCRIPTION_LENGTH = 200;

/**
 * Validate one record before it costs an MFL round trip. Returns null when the
 * record is fine, or the reason it isn't.
 *
 * A zero amount is rejected on purpose: MFL accepts it, and it writes a ledger
 * line that moves no money, which is how a mis-parsed CSV column ("$—", "n/a")
 * gets silently recorded as a real transaction.
 */
export function validateRecord(record: Partial<WriteRecordInput>): string | null {
  const franchiseId = normalizeFranchiseId(record.franchiseId);
  if (!/^\d{4}$/.test(franchiseId)) return 'Franchise must be a numeric id, e.g. 0001';
  if (typeof record.amount !== 'number' || !Number.isFinite(record.amount)) {
    return 'Amount must be a number';
  }
  if (record.amount === 0) return 'Amount must not be zero';
  const description = (record.description ?? '').trim();
  if (!description) return 'Description is required';
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`;
  }
  return null;
}

/**
 * Write ONE accounting record. MFL's import takes no batch form.
 *
 * MFL answers imports with XML, and answers a REJECTED import with HTTP 200
 * carrying an <error> element — `response.ok` is not "the write landed". The
 * body is what decides.
 */
export async function writeAccountingRecord(
  record: WriteRecordInput,
  opts: WriteRecordOptions
): Promise<WriteRecordResult> {
  const invalid = validateRecord(record);
  if (invalid) return { ok: false, error: invalid };

  // Commissioner imports must NOT go to the api subdomain — see HOSTS.
  const host = opts.league.mflHost.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const url = `https://${host}/${opts.year}/import?TYPE=accounting&L=${encodeURIComponent(opts.league.id)}`;
  const body = new URLSearchParams({
    L: opts.league.id,
    FRANCHISE: normalizeFranchiseId(record.franchiseId),
    // MFL parses AMOUNT as a plain decimal — a "$" or a thousands comma is a
    // parse failure on their side, reported as a generic rejection.
    AMOUNT: record.amount.toFixed(2),
    DESCRIPTION: record.description.trim(),
  }).toString();

  let response: Response;
  try {
    response = await mflFetch({
      url,
      method: 'POST',
      mflUserCookie: opts.mflUserCookie,
      mflCommishCookie: opts.mflCommishCookie,
      body,
    });
  } catch (error) {
    return { ok: false, error: `Could not reach MFL: ${(error as Error).message}` };
  }

  if (!response.ok) return { ok: false, error: `MFL returned HTTP ${response.status}` };

  const text = (await response.text()).trim();
  const errorMatch = text.match(/<error[^>]*>(.*?)<\/error>/s);
  if (errorMatch) {
    return { ok: false, error: errorMatch[1].trim() || 'MFL rejected the record' };
  }
  // An empty body from the import endpoint means the commissioner cookie was
  // not accepted — same 200-with-nothing shape the export uses for auth
  // failure. Treating it as success would report phantom writes.
  if (!text) {
    return {
      ok: false,
      error: 'MFL returned an empty response — the session is not authorized to write this league’s ledger.',
    };
  }
  return { ok: true };
}

export interface BulkWriteRow extends WriteRecordInput {
  /** Row's position in the caller's source (CSV line, payout key) for reporting. */
  ref?: string;
}

export interface BulkWriteResult {
  row: BulkWriteRow;
  ok: boolean;
  error?: string;
}

/**
 * Write many records, one MFL call each, reporting each row's own outcome.
 *
 * Sequential on purpose. These are commissioner-authenticated writes against a
 * single league ledger; firing them concurrently gains a second or two and
 * risks MFL throttling a partial batch, which is the worst outcome here —
 * money half-applied with no clean retry point.
 *
 * Never throws: a row that fails is a failed row, not an aborted batch, so the
 * caller can show exactly which lines landed and re-run only the rest.
 */
export async function writeAccountingRecords(
  rows: BulkWriteRow[],
  opts: WriteRecordOptions
): Promise<BulkWriteResult[]> {
  const results: BulkWriteResult[] = [];
  for (const row of rows) {
    try {
      const result = await writeAccountingRecord(row, opts);
      results.push({ row, ok: result.ok, ...(result.error ? { error: result.error } : {}) });
    } catch (error) {
      results.push({ row, ok: false, error: (error as Error).message });
    }
  }
  return results;
}
