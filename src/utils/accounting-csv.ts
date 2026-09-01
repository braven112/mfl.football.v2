/**
 * CSV in and out for the league accounting ledger.
 *
 * Pure string work — no network, no fs, no clock — so the import preview the
 * commissioner approves is exactly what the writer later sends. Parsing and
 * writing live together on purpose: a round trip through both must be lossless,
 * which is what stops an exported ledger from being un-importable.
 *
 * The sign convention is MFL's and is NOT restated here: positive credits the
 * franchise, negative charges it. See src/utils/mfl-accounting.ts.
 */

import {
  parseAmount,
  normalizeFranchiseId,
  validateRecord,
  formatAmount,
  type AccountingRecord,
  type WriteRecordInput,
} from './mfl-accounting';

/** One parsed CSV line, valid or not. Invalid rows are KEPT so the preview can show them. */
export interface ParsedCsvRow {
  /** 1-based line number in the source text, for error reporting. */
  line: number;
  record: Partial<WriteRecordInput>;
  /** Null when the row is importable. */
  error: string | null;
  /** The raw cells, for rendering a row we could not parse. */
  raw: string[];
}

export interface ParsedCsv {
  rows: ParsedCsvRow[];
  /** Rows with `error === null`, ready to write. */
  valid: WriteRecordInput[];
  /** A whole-file problem (no recognizable columns, nothing but a header). */
  fatal: string | null;
}

/**
 * Split one CSV line, honouring quoted fields and doubled quotes.
 *
 * Hand-rolled rather than pulled from a dependency because descriptions are
 * free text a commissioner types — they contain commas ("Week 3 high score,
 * 142.6") and apostrophes, and a naive `split(',')` silently truncates the
 * description at the first comma, writing a real but wrong ledger line.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        // "" inside a quoted field is a literal quote.
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/** Quote a cell only when it needs it, so a plain ledger stays readable. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Header aliases, so a commissioner's own spreadsheet imports without renaming columns. */
const HEADER_ALIASES: Record<string, 'franchiseId' | 'amount' | 'description'> = {
  franchise: 'franchiseId',
  franchiseid: 'franchiseId',
  'franchise id': 'franchiseId',
  team: 'franchiseId',
  id: 'franchiseId',
  amount: 'amount',
  value: 'amount',
  dollars: 'amount',
  description: 'description',
  desc: 'description',
  memo: 'description',
  note: 'description',
  notes: 'description',
  reason: 'description',
};

const looksLikeHeader = (cells: string[]): boolean =>
  cells.some((cell) => HEADER_ALIASES[cell.toLowerCase()] !== undefined) &&
  // A header row's amount column is not itself a number — "amount" is. This
  // stops a headerless file whose first row happens to read "id,25,dues" from
  // being eaten as a header, which would silently drop a real transaction.
  cells.every((cell) => parseAmount(cell) === null || HEADER_ALIASES[cell.toLowerCase()] !== undefined);

/**
 * Parse pasted or uploaded CSV into rows.
 *
 * With a header row, columns are matched by name in any order. Without one,
 * the positional default is franchise, amount, description — the same order
 * MFL's own import form asks for them in.
 *
 * Every row comes back, valid or not: a bulk import must show the
 * commissioner which lines are bad BEFORE any of them is written, and silently
 * dropping unparseable lines would apply a partial batch that looks complete.
 */
export function parseAccountingCsv(text: string): ParsedCsv {
  const lines = String(text ?? '')
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim());

  const rows: ParsedCsvRow[] = [];
  let order: Array<'franchiseId' | 'amount' | 'description' | null> = [
    'franchiseId',
    'amount',
    'description',
  ];
  let sawHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = splitCsvLine(line);
    if (cells.every((cell) => cell === '')) continue;

    if (!sawHeader && rows.length === 0 && looksLikeHeader(cells)) {
      order = cells.map((cell) => HEADER_ALIASES[cell.toLowerCase()] ?? null);
      sawHeader = true;
      continue;
    }

    const record: Partial<WriteRecordInput> = {};
    // Anything past the mapped columns is description overflow, not junk: an
    // unquoted comma in a description lands there, and joining it back is
    // closer to the commissioner's intent than truncating.
    const extras: string[] = [];
    for (let c = 0; c < cells.length; c++) {
      const field = order[c];
      const value = cells[c];
      if (field === 'franchiseId') record.franchiseId = normalizeFranchiseId(value);
      else if (field === 'amount') {
        const amount = parseAmount(value);
        if (amount !== null) record.amount = amount;
      } else if (field === 'description') record.description = value;
      // `field` is null for an unrecognized header column and UNDEFINED for a
      // cell past the end of the mapping — an unquoted comma in a description
      // produces exactly that. Both are overflow; checking only for null
      // silently truncated the description at its first comma.
      else if (!field && value) extras.push(value);
    }
    if (extras.length) {
      record.description = [record.description, ...extras].filter(Boolean).join(', ');
    }

    const error =
      record.amount === undefined && cells.length >= 2
        ? `Could not read an amount from "${cells[order.indexOf('amount')] ?? ''}"`
        : validateRecord(record);

    rows.push({ line: i + 1, record, error, raw: cells });
  }

  const valid = rows
    .filter((row) => row.error === null)
    .map((row) => row.record as WriteRecordInput);

  const fatal =
    rows.length === 0
      ? 'No rows found. Expected columns: franchise, amount, description.'
      : null;

  return { rows, valid, fatal };
}

/** The header every export writes and every import accepts. */
export const ACCOUNTING_CSV_HEADER = 'franchise,amount,description';

/**
 * Serialize a ledger to CSV.
 *
 * Amounts are written as PLAIN SIGNED DECIMALS ("-100.00"), not as the
 * "$100.00" the UI shows: the "$" is exactly what `parseAmount` has to strip
 * back off on re-import, and a currency-formatted export that only survives
 * its own parser is a trap for anyone opening it in a spreadsheet.
 */
export function toAccountingCsv(records: AccountingRecord[]): string {
  const lines = [ACCOUNTING_CSV_HEADER];
  for (const record of records) {
    lines.push(
      [
        csvCell(record.franchiseId),
        record.amount.toFixed(2),
        csvCell(record.description ?? ''),
      ].join(',')
    );
  }
  return lines.join('\n');
}

/** Display helper shared by the ledger table and the import preview. */
export { formatAmount };
