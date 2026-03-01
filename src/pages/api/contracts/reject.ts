/**
 * POST /api/contracts/reject
 *
 * Reject a pending contract declaration.
 * Requires commissioner or admin authentication.
 * Optionally includes a rejection reason.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getDeclarationById, updateDeclaration } from '../../../utils/contract-storage';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface RejectRequestBody {
  declarationId: string;
  reason?: string;
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

    if (user.role !== 'commissioner' && user.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Commissioner access required' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    const body: RejectRequestBody = await request.json();
    const { declarationId, reason } = body;

    if (!declarationId) {
      return new Response(
        JSON.stringify({ error: 'declarationId is required' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const declaration = getDeclarationById(declarationId);
    if (!declaration) {
      return new Response(
        JSON.stringify({ error: 'Declaration not found' }),
        { status: 404, headers: JSON_HEADERS },
      );
    }

    if (declaration.status !== 'pending') {
      return new Response(
        JSON.stringify({
          error: `Cannot reject a declaration with status '${declaration.status}'`,
        }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const updated = updateDeclaration(declarationId, {
      status: 'rejected',
      reviewedBy: user.name || user.id,
      reviewedAt: new Date().toISOString(),
      rejectionReason: reason || undefined,
    });

    if (!updated) {
      return new Response(
        JSON.stringify({ error: 'Failed to update declaration' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        declarationId: updated.id,
        status: updated.status,
        message: 'Declaration rejected',
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('Reject declaration error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
