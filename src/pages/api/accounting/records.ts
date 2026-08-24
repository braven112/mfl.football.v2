/**
 * GET  /api/accounting/records?league=<slug>[&year=][&format=csv]
 *      Read the league ledger — every record plus per-franchise balances.
 *
 * POST /api/accounting/records?league=<slug>[&year=]
 *      Write ONE record. Body: { franchiseId, amount, description }.
 *
 * Commissioner-only, league-scoped — see accounting-request.ts for why the
 * `league` query param is a check rather than an input.
 *
 * The amount is in MFL's sign convention (positive credits the franchise) and
 * is passed through UNTOUCHED. This route deliberately does no sign guessing:
 * a caller that means "charge $100" sends -100. Inferring it from the
 * description ("dues" -> negative) is the kind of helpfulness that eventually
 * pays a prize backwards.
 */

import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { resolveAccountingContext } from '../../../utils/accounting-request';
import {
  fetchAccountingLedger,
  writeAccountingRecord,
  parseAmount,
  validateRecord,
} from '../../../utils/mfl-accounting';
import { toAccountingCsv } from '../../../utils/accounting-csv';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const ctx = resolveAccountingContext(context);
  if (ctx instanceof Response) return ctx;

  const result = await fetchAccountingLedger({
    leagueId: ctx.league.id,
    year: ctx.year,
    mflUserCookie: ctx.mflUserCookie,
    mflCommishCookie: ctx.mflCommishCookie,
  });

  if (!result.ok) {
    // 502, not 500: the failure is MFL's or the session's, and the message
    // says which. A 500 here would read as "our page is broken".
    return json({ error: result.error }, 502);
  }

  if (context.url.searchParams.get('format') === 'csv') {
    return new Response(toAccountingCsv(result.ledger.records), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${ctx.league.slug}-accounting-${ctx.year}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return json(
    {
      league: ctx.league.slug,
      year: ctx.year,
      records: result.ledger.records,
      balances: result.ledger.balances,
    },
    200,
    JSON_HEADERS_NO_STORE
  );
};

export const POST: APIRoute = async (context) => {
  const ctx = resolveAccountingContext(context);
  if (ctx instanceof Response) return ctx;

  // A single-record write is cheap but it is still a money write against a
  // shared external system. Cap it well above any human's real pace.
  const limit = await checkRateLimit('accounting-write', ctx.user.franchiseId, 120, 300);
  if (!limit.allowed) {
    return json({ error: 'Too many accounting writes. Wait a few minutes and try again.' }, 429);
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const record = {
    franchiseId: String(body?.franchiseId ?? ''),
    // Accept a number or a typed string ("-$25.00") — the form sends text.
    amount: parseAmount(body?.amount) ?? NaN,
    description: String(body?.description ?? ''),
  };

  const invalid = validateRecord(record);
  if (invalid) return json({ error: invalid }, 400);

  const result = await writeAccountingRecord(record, {
    league: ctx.league,
    year: ctx.year,
    mflUserCookie: ctx.mflUserCookie,
    mflCommishCookie: ctx.mflCommishCookie,
  });

  if (!result.ok) return json({ error: result.error }, 502);

  return json({ success: true, record }, 200, JSON_HEADERS_NO_STORE);
};
