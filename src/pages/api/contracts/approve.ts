/**
 * POST /api/contracts/approve
 *
 * Approve a pending contract declaration.
 * Requires commissioner or admin authentication.
 * Updates declaration status to 'approved', then writes to MFL.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
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

    if (declaration.status !== 'pending') {
      return new Response(
        JSON.stringify({
          error: `Cannot approve a declaration with status '${declaration.status}'`,
        }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const updated = await updateDeclaration(declarationId, {
      status: 'approved',
      reviewedBy: user.name || user.id,
      reviewedAt: new Date().toISOString(),
    });

    if (!updated) {
      return new Response(
        JSON.stringify({ error: 'Failed to update declaration' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }

    // Write to MFL after approval
    const mflResult = await writeContractToMFL({
      playerId: declaration.playerId,
      salary: String(declaration.requestedSalary ?? declaration.currentSalary),
      contractYear: String(declaration.requestedYears),
      contractInfo: declaration.requestedContractInfo ?? declaration.currentContractInfo,
    });

    if (mflResult.success) {
      await updateDeclaration(declarationId, {
        status: 'applied',
        mflSynced: true,
        mflSyncedAt: new Date().toISOString(),
      });
    } else {
      // Approved but MFL write failed — mark the error but keep approved status
      await updateDeclaration(declarationId, {
        mflError: mflResult.error,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        declarationId: updated.id,
        status: mflResult.success ? 'applied' : 'approved',
        mflSynced: mflResult.success,
        mflError: mflResult.error || undefined,
        message: mflResult.success
          ? 'Declaration approved and synced to MFL'
          : 'Declaration approved but MFL sync failed — will need manual retry',
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('Approve declaration error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
