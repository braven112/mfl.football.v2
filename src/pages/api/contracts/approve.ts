/**
 * POST /api/contracts/approve
 *
 * Apply a pending contract declaration to MFL.
 * Requires commissioner or admin authentication.
 * Writes directly to MFL and sets status to 'applied'.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { getMFLCookiesFromRequest } from '../../../utils/session';
import { getDeclarationById, updateDeclaration } from '../../../utils/contract-storage';
import { writeContractToMFL } from '../../../utils/mfl-contract-writer';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface ApproveRequestBody {
  declarationId: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: JSON_HEADERS },
      );
    }

    if (!isCommissionerOrAdmin(user)) {
      return new Response(
        JSON.stringify({ error: 'Commissioner access required' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    const body: ApproveRequestBody = await request.json();
    const { declarationId } = body;

    if (!declarationId) {
      return new Response(
        JSON.stringify({ error: 'declarationId is required' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const declaration = await getDeclarationById(declarationId);
    if (!declaration) {
      return new Response(
        JSON.stringify({ error: 'Declaration not found' }),
        { status: 404, headers: JSON_HEADERS },
      );
    }

    if (declaration.status !== 'pending' && declaration.status !== 'applied') {
      return new Response(
        JSON.stringify({
          error: `Cannot apply a declaration with status '${declaration.status}'`,
        }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    // Get MFL credentials from the commissioner's session cookies
    const { mflUserId, mflIsCommish } = getMFLCookiesFromRequest(request);
    console.log('[approve] credentials:', { mflUserId: !!mflUserId, mflIsCommish: !!mflIsCommish });

    // Write to MFL directly (skip intermediate "approved" status)
    const mflResult = await writeContractToMFL(
      {
        playerId: declaration.playerId,
        salary: String(declaration.requestedSalary ?? declaration.currentSalary),
        contractYear: String(declaration.requestedYears),
        contractInfo: declaration.requestedContractInfo ?? declaration.currentContractInfo,
      },
      mflUserId ? { mflUserId, mflIsCommish: mflIsCommish || undefined } : undefined,
    );

    console.log('[approve] MFL write result:', {
      success: mflResult.success,
      error: mflResult.error,
      attempts: mflResult.attempts,
    });

    if (mflResult.success) {
      const updated = await updateDeclaration(declarationId, {
        status: 'applied',
        mflSynced: true,
        mflSyncedAt: new Date().toISOString(),
        reviewedBy: user.name || user.id,
        reviewedAt: new Date().toISOString(),
      });

      if (!updated) {
        console.error('[approve] updateDeclaration returned null — storage write failed for', declarationId);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'MFL write succeeded but declaration storage update failed. The contract was applied on MFL but our records were not updated.',
            declarationId,
          }),
          { status: 500, headers: JSON_HEADERS },
        );
      }

      console.log('[approve] declaration updated to applied:', declarationId);

      return new Response(
        JSON.stringify({
          success: true,
          declarationId,
          status: 'applied',
          mflSynced: true,
          message: 'Contract applied to MFL',
        }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    // MFL write failed — keep as pending
    await updateDeclaration(declarationId, {
      mflError: mflResult.error,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: `MFL sync failed: ${mflResult.error}`,
        declarationId,
        status: 'pending',
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('Apply declaration error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
