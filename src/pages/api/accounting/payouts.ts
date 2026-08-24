/**
 * GET  /api/accounting/payouts?league=<slug>[&season=][&year=]
 *      Compute the season's payout plan — who won what, what is already paid.
 *
 * POST /api/accounting/payouts?league=<slug>[&season=][&year=]
 *      Apply the plan. Body: { confirm: true }.
 *
 * Winners are DERIVED from the league's own results (playoff brackets, award
 * history, all-play tier tables, weekly scores) — nothing here is hand-entered.
 * See accounting-payouts.mjs for the derivation and accounting-request.ts for
 * why `season` and `year` are two different clocks.
 *
 * ── WHY THE PLAN IS RECOMPUTED ON POST ────────────────────────────────────
 * The apply path does NOT take a plan from the client. It recomputes from the
 * same feeds and pays what IT derives. A client-supplied plan would be an
 * arbitrary "pay this franchise this much" endpoint wearing a payout costume —
 * the commissioner gate is not the only thing standing between a typo and the
 * books.
 *
 * ── WHY A RE-RUN IS SAFE ──────────────────────────────────────────────────
 * Every planned line carries a deterministic description, and the planner
 * checks it against the live ledger first: lines already present come back
 * `already-paid` and are not rewritten. MFL's import has no upsert and no
 * delete, so this check is the only thing preventing a second click from
 * paying the season twice.
 */

import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { resolveAccountingContext } from '../../../utils/accounting-request';
import { fetchAccountingLedger, writeAccountingRecords } from '../../../utils/mfl-accounting';
import { loadPayoutSeasonData } from '../../../utils/accounting-season-data';
import { checkRateLimit } from '../../../utils/rate-limit';
// .mjs planner, shared with node scripts (see its header). No ts-expect-error
// here: its JSDoc types resolve, so the directive would itself be unused.
import { planPayouts } from '../../../utils/accounting-payouts.mjs';

export const prerender = false;

/**
 * Build the plan against the LIVE ledger.
 *
 * The ledger read is not optional and its failure is not recoverable here: a
 * plan built against an unreadable ledger cannot tell already-paid from
 * payable, and "pay everything" is its failure mode. So a ledger error fails
 * the whole request rather than degrading to an unchecked plan.
 */
async function buildPlan(ctx: Extract<ReturnType<typeof resolveAccountingContext>, { league: any }>) {
  const payouts = ctx.league.payouts;
  if (!payouts) {
    return { error: `${ctx.league.name} has no prize table configured.`, status: 400 as const };
  }

  const ledger = await fetchAccountingLedger({
    leagueId: ctx.league.id,
    year: ctx.year,
    mflUserCookie: ctx.mflUserCookie,
    mflCommishCookie: ctx.mflCommishCookie,
  });
  if (!ledger.ok) {
    return {
      error: `Could not read the current ledger, so already-paid prizes can't be detected: ${ledger.error}`,
      status: 502 as const,
    };
  }

  const data = loadPayoutSeasonData(ctx.league, ctx.season);
  const plan = planPayouts({
    year: ctx.season,
    payouts,
    data,
    existingRecords: ledger.ledger.records,
  });

  return { plan, ledger: ledger.ledger };
}

export const GET: APIRoute = async (context) => {
  const ctx = resolveAccountingContext(context);
  if (ctx instanceof Response) return ctx;

  const built = await buildPlan(ctx);
  if ('error' in built) return json({ error: built.error }, built.status);

  return json(
    {
      league: ctx.league.slug,
      season: ctx.season,
      year: ctx.year,
      ...built.plan,
    },
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

  // An explicit confirm flag, so a bare POST — a retried fetch, a curl while
  // exploring — can never pay a season.
  if (body?.confirm !== true) {
    return json({ error: 'Refusing to apply payouts without { confirm: true }.' }, 400);
  }

  const limit = await checkRateLimit('accounting-payout', ctx.user.franchiseId, 4, 900);
  if (!limit.allowed) {
    return json({ error: 'Too many payout runs. Wait a few minutes and try again.' }, 429);
  }

  const built = await buildPlan(ctx);
  if ('error' in built) return json({ error: built.error }, built.status);

  const { plan } = built;

  // A conflict is a ledger line with this prize's description but a different
  // amount — a hand edit, or a prize table that changed after a partial run.
  // Paying alongside it would leave the franchise credited twice at two
  // different amounts, so the whole run stops for a human.
  const conflicts = plan.lines.filter((line: any) => line.status === 'conflict');
  if (conflicts.length) {
    return json(
      {
        error:
          'The ledger already has records matching some prizes at different amounts. Nothing was paid — review them first.',
        conflicts,
      },
      409
    );
  }

  const payable = plan.lines.filter((line: any) => line.status === 'payable');
  if (!payable.length) {
    return json(
      {
        written: 0,
        message:
          plan.lines.length > 0
            ? 'Every derivable prize for this season is already in the ledger. Nothing to pay.'
            : 'No prizes could be derived for this season yet.',
        ...plan,
      },
      200,
      JSON_HEADERS_NO_STORE
    );
  }

  const results = await writeAccountingRecords(
    payable.map((line: any) => ({
      franchiseId: line.franchiseId,
      amount: line.amount,
      description: line.description,
      ref: line.key,
    })),
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
      written,
      failedCount: failed.length,
      results,
      // Reported so the page can say "12 of 17 paid — re-run to finish the
      // rest", which is safe precisely because of the already-paid check.
      partial: failed.length > 0 && written > 0,
      unresolved: plan.unresolved,
      totals: plan.totals,
    },
    200,
    JSON_HEADERS_NO_STORE
  );
};
