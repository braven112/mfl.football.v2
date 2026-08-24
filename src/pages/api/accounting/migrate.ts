/**
 * GET  /api/accounting/migrate?league=<slug>&from=<year>[&to=<year>]
 *      Plan the year rollover — which closing balances carry into the new
 *      league year, which are already carried, which need a human.
 *
 * POST /api/accounting/migrate?league=<slug>&from=<year>[&to=<year>]
 *      Apply it. Body: { confirm: true }.
 *
 * MFL starts every new league year with an EMPTY ledger, so without this the
 * league's books reset to zero every February and every outstanding debt and
 * credit disappears. See docs/claude/rules/accounting.md.
 *
 * ── WHY AN EMPTY SOURCE LEDGER IS AN ERROR, NOT AN EMPTY RESULT ───────────
 * The dangerous failure here is quiet: a degraded read of last year's ledger
 * yields no balances, the plan comes back with nothing to carry, and the page
 * says "nothing to migrate" — which is exactly what a genuinely settled league
 * looks like. The commissioner ticks it off and every balance is lost.
 *
 * So a source ledger with NO RECORDS AT ALL refuses to plan. A league year that
 * really did end with an empty ledger has nothing to carry anyway, so refusing
 * costs nothing and catches the case that silently destroys the books.
 */

import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { resolveAccountingContext } from '../../../utils/accounting-request';
import { fetchAccountingLedger, writeAccountingRecords } from '../../../utils/mfl-accounting';
import { loadFranchises } from '../../../utils/accounting-season-data';
import { checkRateLimit } from '../../../utils/rate-limit';
import { planYearMigration } from '../../../utils/accounting-migration.mjs';

export const prerender = false;

const parseYear = (raw: string | null): number | null => {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : null;
};

type Ctx = Extract<ReturnType<typeof resolveAccountingContext>, { league: any }>;

async function buildMigration(ctx: Ctx, url: URL) {
  const from = parseYear(url.searchParams.get('from'));
  // `to` defaults to the ledger year the context already resolved — the live
  // MFL league year, which is exactly where a rollover lands.
  const to = parseYear(url.searchParams.get('to')) ?? ctx.year;

  if (from === null) {
    return { error: 'A four-digit `from` year is required.', status: 400 as const };
  }

  // Carrying a year into itself would write every balance a second time into
  // the ledger it came from, doubling the whole league in place.
  if (from === to) {
    return {
      error: `Source and destination are both ${from}. A rollover has to move between two different league years.`,
      status: 400 as const,
    };
  }

  // Backwards is never a rollover. It is either a typo or an attempt to
  // rewrite closed books, and both should stop here.
  if (from > to) {
    return {
      error: `Refusing to carry ${from} back into ${to} — a rollover only moves forward.`,
      status: 400 as const,
    };
  }

  const [source, target] = await Promise.all([
    fetchAccountingLedger({
      leagueId: ctx.league.id,
      year: from,
      mflUserCookie: ctx.mflUserCookie,
      mflCommishCookie: ctx.mflCommishCookie,
    }),
    fetchAccountingLedger({
      leagueId: ctx.league.id,
      year: to,
      mflUserCookie: ctx.mflUserCookie,
      mflCommishCookie: ctx.mflCommishCookie,
    }),
  ]);

  if (!source.ok) {
    return { error: `Could not read the ${from} ledger: ${source.error}`, status: 502 as const };
  }
  // Without the target ledger we cannot tell already-carried from carryable,
  // and the failure mode of guessing is carrying everything twice.
  if (!target.ok) {
    return {
      error: `Could not read the ${to} ledger, so already-carried balances can't be detected: ${target.error}`,
      status: 502 as const,
    };
  }

  // See the header — an empty source is indistinguishable from a bad read.
  if (source.ledger.records.length === 0 && Object.keys(source.ledger.balances).length === 0) {
    return {
      error: `MFL returned no ${from} accounting records at all. That is either a league year with no books or a bad read, and they look identical here — check ${from} in MFL before rolling anything forward.`,
      status: 409 as const,
    };
  }

  const plan = planYearMigration({
    fromYear: from,
    toYear: to,
    sourceLedger: source.ledger,
    targetRecords: target.ledger.records,
    franchises: loadFranchises(ctx.league, to),
  });

  return { plan, from, to };
}

export const GET: APIRoute = async (context) => {
  const ctx = resolveAccountingContext(context);
  if (ctx instanceof Response) return ctx;

  const built = await buildMigration(ctx, context.url);
  if ('error' in built) return json({ error: built.error }, built.status);

  return json(
    { league: ctx.league.slug, from: built.from, to: built.to, ...built.plan },
    200,
    JSON_HEADERS_NO_STORE
  );
};

export const POST: APIRoute = async (context) => {
  const ctx = resolveAccountingContext(context);
  if (ctx instanceof Response) return ctx;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  // Explicit confirm, so a retried fetch or an exploratory curl can never roll
  // a year over.
  if (body?.confirm !== true) {
    return json({ error: 'Refusing to migrate without { confirm: true }.' }, 400);
  }

  const limit = await checkRateLimit('accounting-migrate', ctx.user.franchiseId, 4, 900);
  if (!limit.allowed) {
    return json({ error: 'Too many migration runs. Wait a few minutes and try again.' }, 429);
  }

  // Recomputed from MFL, never taken from the client — the same rule the
  // payout apply path follows. A client-supplied plan would be an arbitrary
  // "credit this franchise" endpoint.
  const built = await buildMigration(ctx, context.url);
  if ('error' in built) return json({ error: built.error }, built.status);

  const { plan, from, to } = built;

  // A conflict is a carry record already present at a DIFFERENT amount: the
  // source ledger moved after a partial run, or someone edited by hand. Either
  // way the correct carried balance is now ambiguous, so nothing is written.
  const conflicts = plan.lines.filter((line: any) => line.status === 'conflict');
  if (conflicts.length) {
    return json(
      {
        error: `The ${to} ledger already carries balances from ${from} at different amounts. Nothing was written — reconcile those first.`,
        conflicts,
      },
      409
    );
  }

  const carryable = plan.lines.filter((line: any) => line.status === 'payable');
  if (!carryable.length) {
    return json(
      {
        written: 0,
        message: plan.lines.length
          ? `Every ${from} balance is already carried into ${to}. Nothing to do.`
          : `No ${from} balances need carrying — every franchise closed the year square.`,
        ...plan,
      },
      200,
      JSON_HEADERS_NO_STORE
    );
  }

  const results = await writeAccountingRecords(
    carryable.map((line: any) => ({
      franchiseId: line.franchiseId,
      amount: line.amount,
      description: line.description,
      ref: line.franchiseId,
    })),
    {
      league: ctx.league,
      year: to,
      mflUserCookie: ctx.mflUserCookie,
      mflCommishCookie: ctx.mflCommishCookie,
    }
  );

  const written = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);

  return json(
    {
      from,
      to,
      written,
      failedCount: failed.length,
      results,
      // A partial carry is safe to re-run: the rows that landed come back
      // `already-migrated` on the next plan.
      partial: failed.length > 0 && written > 0,
      warnings: plan.warnings,
      totals: plan.totals,
    },
    200,
    JSON_HEADERS_NO_STORE
  );
};
