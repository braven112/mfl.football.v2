/**
 * POST /api/contracts/delete
 *
 * Delete an applied contract declaration (for testing/cleanup).
 * Requires commissioner or admin authentication.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { getDeclarationById, deleteDeclaration } from '../../../utils/contract-storage';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

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

    const { declarationId } = await request.json();

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

    const deleted = await deleteDeclaration(declarationId);
    if (!deleted) {
      return new Response(
        JSON.stringify({ error: 'Failed to delete declaration' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: declarationId }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (err) {
    console.error('[contracts/delete] Error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
