/**
 * POST /api/accounting/import?league=<slug>[&year=]
 *
 * Bulk-import accounting records from CSV.
 *
 * Body: { csv: string, dryRun?: boolean }
 *
 * `dryRun: true` parses and validates WITHOUT writing — that is what the
 * page's preview calls, so the rows a commissioner approves are the exact rows
 * parsed by the exact same code that will write them. A preview computed
 * client-side and a write parsed server-side is how a bulk import ends up
 * applying something nobody reviewed.
 *
 * MFL's import takes one record per call, so this loops. It therefore reports
 * PER-ROW results and can legitimately land a partial batch: rows 1-40 written,
 * 41 rejected, 42-50 written. The response says exactly which, so a re-run can
 * carry only the failures. Never collapse this to a single ok/failed.
 */

import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { resolveAccountingContext } from '../../../utils/accounting-request';
import { writeAccountingRecords } from '../../../utils/mfl-accounting';
import { parseAccountingCsv } from '../../../utils/accounting-csv';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

/**
 * A ceiling on one batch. Not a performance guard — a blast radius one. These
 * are sequential authenticated writes to a live ledger; a pasted spreadsheet
 * with a runaway fill would otherwise write thousands of records that have to
 * be undone by hand, because MFL's import has no delete.
 */
const MAX_ROWS = 250;

export const POST: APIRoute = async (context) => {
  const ctx = resolveAccountingContext(context);
  if (ctx instanceof Response) return ctx;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const parsed = parseAccountingCsv(String(body?.csv ?? ''));
  if (parsed.fatal) return json({ error: parsed.fatal, rows: parsed.rows }, 400);

  if (parsed.rows.length > MAX_ROWS) {
    return json(
      {
        error: `That file has ${parsed.rows.length} rows; ${MAX_ROWS} is the most one import can write. Split it and run them in order.`,
        rows: parsed.rows.slice(0, MAX_ROWS),
      },
      400
    );
  }

  const dryRun = body?.dryRun !== false;

  if (dryRun) {
    return json(
      {
        dryRun: true,
        rows: parsed.rows,
        validCount: parsed.valid.length,
        invalidCount: parsed.rows.length - parsed.valid.length,
        total: parsed.valid.reduce((sum, row) => sum + row.amount, 0),
      },
      200,
      JSON_HEADERS_NO_STORE
    );
  }

  // Refuse a partially-invalid batch rather than writing the good half. The
  // commissioner has already seen the preview; if rows are still bad at write
  // time the file changed under them, and half-applying it is the worst
  // outcome available.
  if (parsed.valid.length !== parsed.rows.length) {
    return json(
      {
        error: 'Some rows are still invalid — nothing was written. Fix them and re-import.',
        rows: parsed.rows,
      },
      400
    );
  }

  const limit = await checkRateLimit('accounting-import', ctx.user.franchiseId, 6, 600);
  if (!limit.allowed) {
    return json({ error: 'Too many bulk imports. Wait a few minutes and try again.' }, 429);
  }

  const results = await writeAccountingRecords(
    parsed.valid.map((row, index) => ({ ...row, ref: `line ${parsed.rows[index].line}` })),
    {
      league: ctx.league,
      year: ctx.year,
      mflUserCookie: ctx.mflUserCookie,
      mflCommishCookie: ctx.mflCommishCookie,
    }
  );

  const written = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);

  return json(
    {
      dryRun: false,
      written,
      failedCount: failed.length,
      results,
      // 207-style semantics in the body rather than the status: the client
      // renders per-row outcomes either way, and a non-2xx here would hide
      // the rows that DID land behind a generic error banner.
      partial: failed.length > 0 && written > 0,
    },
    200,
    JSON_HEADERS_NO_STORE
  );
};
