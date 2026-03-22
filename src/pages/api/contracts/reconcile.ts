/**
 * POST /api/contracts/reconcile
 *
 * Reconcile stuck pending declarations against MFL data.
 * If a pending declaration's requested years already match MFL,
 * auto-marks it as 'applied' (the MFL write succeeded but our
 * storage update was lost due to the old Blob race condition).
 *
 * Requires commissioner authentication.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { getPendingDeclarations, updateDeclaration } from '../../../utils/contract-storage';
import { fetchMFLSalaries } from '../../../utils/mfl-contract-writer';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isCommissionerOrAdmin(user)) {
    return new Response(
      JSON.stringify({ error: 'Commissioner access required' }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  try {
    const pending = await getPendingDeclarations();
    if (pending.length === 0) {
      return new Response(
        JSON.stringify({ reconciled: 0, message: 'No pending declarations' }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    // Fetch current MFL salary/contract data
    const salaries = await fetchMFLSalaries();
    if (!salaries) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch MFL salary data' }),
        { status: 502, headers: JSON_HEADERS },
      );
    }

    const reconciled: string[] = [];

    for (const decl of pending) {
      const mflData = salaries[decl.playerId];
      if (!mflData) continue;

      const mflYears = parseInt(mflData.contractYear, 10);
      if (mflYears === decl.requestedYears) {
        // MFL already has the requested years — mark as applied
        await updateDeclaration(decl.id, {
          status: 'applied',
          mflSynced: true,
          mflSyncedAt: new Date().toISOString(),
          reviewedBy: 'auto-reconcile',
          reviewedAt: new Date().toISOString(),
        });
        reconciled.push(`${decl.playerName} (${decl.id})`);
        console.log('[reconcile] Auto-applied:', decl.playerName, decl.id);
      }
    }

    return new Response(
      JSON.stringify({
        reconciled: reconciled.length,
        players: reconciled,
        message: reconciled.length > 0
          ? `Reconciled ${reconciled.length} declaration(s)`
          : 'No stuck declarations found — all pending declarations have different years than MFL',
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('[reconcile] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
