/**
 * MFL league accounting — read the ledger, write records to it.
 *
 * Two MFL endpoints back this, and they do NOT have the same access model:
 *
 *   READ   export?TYPE=accounting&L=<id>&JSON=1   no cookie needed in practice
 *   WRITE  import?TYPE=accounting&L=<id>          the COMMISSIONER's cookie
 *
 * MFL's docs call the read "private league access restricted to league
 * owners". Verified Aug 2026 against leagues 19621 and 13522, it is NOT: an
 * unauthenticated request returns the full ledger. It answers on the api host
 * with a 302 to the league's own host, so a client that does not follow
 * redirects sees an empty body and looks exactly like a permission failure —
 * that is what made it look gated. `mflFetch` follows the redirect and keeps
 * the Cookie header across it, so the cookie is passed when we have one and
 * simply is not required.
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
 * THE REAL SHAPE, verified against live MFL (leagues 19621 and 13522,
 * Aug 2026) — a flat list under `entry`, every field a STRING:
 *
 *   { version: "1.0", accounting: { entry: [
 *       { id, franchise_id, amount, description, timestamp } ] } }
 *
 * This was originally written against three GUESSED shapes (`franchise` with
 * nested `transaction`, a flat `transaction` list, a summary-only form), none
 * of which MFL actually returns. Every one of them parsed the real payload to
 * an EMPTY ledger — no error, no warning, just a page reporting that a league
 * with 26 transactions had none. Guessing a response shape from prose docs is
 * what produced that; `entry` is now the documented-and-tested path.
 *
 * The guessed shapes are still accepted below, purely because they cost
 * nothing and MFL's other exports genuinely do vary in form. `entry` is the
 * one with a real-payload test behind it.
 *
 * MFL also collapses a one-element list to a bare object, so a league with a
 * single transaction arrives unwrapped.
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

  // THE REAL SHAPE: a flat `entry` list, each naming its own franchise.
  for (const entry of asArray<any>(root?.entry)) {
    const franchiseId = normalizeFranchiseId(entry?.franchise_id ?? entry?.franchise);
    if (!franchiseId) continue;
    pushRecord(franchiseId, entry);
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
 * The empty-body guard below is a safety net, not an auth check: this endpoint
 * reads fine without a cookie (see the header). What it catches is MFL
 * answering with nothing usable — a maintenance page, a throttle, a redirect
 * that went nowhere. Reporting any of those as "no records" would render a
 * page saying every owner is square, which is the one wrong answer that looks
 * completely normal.
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
      error: 'MFL returned an empty accounting response. That is not an empty ledger — it usually means MFL is throttling or serving a maintenance page. Try again in a moment.',
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
  // MFL answers imports with XML. An HTML body is a LOGIN PAGE, a permission
  // notice, or a league home page — all of which are HTTP 200, all non-empty,
  // and none containing an <error> element. Without this check every one of
  // them reads as a successful write.
  //
  // This is not hypothetical: it is exactly how a 15-record carry reported
  // "carried into 2026" while the 2026 ledger stayed at 5 entries. Verified
  // 2026-08-31 against the real AFL.
  if (/^\s*(<!doctype html|<html|<head|<body)/i.test(text)) {
    return {
      ok: false,
      error:
        'MFL returned an HTML page instead of an import response — the session is not authorized to write this league’s ledger (sign in again as commissioner).',
    };
  }
  return { ok: true };
}

/**
 * Which of the records we just wrote are NOT in the ledger.
 *
 * MFL's import can answer 200 with a body that parses fine and still apply
 * nothing, so a response body cannot confirm a write — only re-reading can.
 * The same rule the roster writer follows (see cut-player.ts, which verifies a
 * drop by re-reading the roster rather than parsing the response).
 *
 * Matched on (franchise, description, amount), the same triple the idempotency
 * check uses, so a record that verifies here is one a re-run will correctly
 * skip.
 */
export function findMissingRecords(
  ledger: AccountingLedger,
  written: WriteRecordInput[]
): WriteRecordInput[] {
  const present = new Set(
    ledger.records.map(
      (record) =>
        `${normalizeFranchiseId(record.franchiseId)}|${String(record.description ?? '').trim().toLowerCase()}|${record.amount.toFixed(2)}`
    )
  );
  return written.filter(
    (row) =>
      !present.has(
        `${normalizeFranchiseId(row.franchiseId)}|${row.description.trim().toLowerCase()}|${row.amount.toFixed(2)}`
      )
  );
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

export interface VerifyWritesResult {
  /** False when the confirming read itself failed — NOT a pass. */
  verified: boolean;
  /** Rows MFL accepted that are absent from the ledger afterwards. */
  unverified: WriteRecordInput[];
}

/**
 * Confirm a batch of writes by re-reading the ledger.
 *
 * MFL's import can answer 200 with a body that parses fine and apply nothing,
 * so the response is never proof — only the ledger is. Every write path goes
 * through this, because the one that did not is how a 15-record carry reported
 * "carried into 2026" against a ledger that never changed (2026-08-31).
 *
 * One read for the whole batch, after the writes, so the cost does not scale
 * with the number of records.
 *
 * A failed read returns `verified: false` with NO rows listed as unverified:
 * we genuinely do not know which landed, and guessing in either direction is
 * worse than saying so. Callers must surface that rather than treating an
 * empty `unverified` as success.
 */
export async function verifyWrites(
  written: WriteRecordInput[],
  opts: { leagueId: string; year: string | number; mflUserCookie: string; mflCommishCookie?: string }
): Promise<VerifyWritesResult> {
  if (written.length === 0) return { verified: true, unverified: [] };

  const after = await fetchAccountingLedger({
    leagueId: opts.leagueId,
    year: opts.year,
    mflUserCookie: opts.mflUserCookie,
    mflCommishCookie: opts.mflCommishCookie,
  });
  if (!after.ok) return { verified: false, unverified: [] };

  return { verified: true, unverified: findMissingRecords(after.ledger, written) };
}
