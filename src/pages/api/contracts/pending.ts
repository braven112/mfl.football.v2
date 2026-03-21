/**
 * GET /api/contracts/pending
 *
 * Get pending contract declarations for commissioner review.
 * Requires commissioner authentication.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getPendingDeclarations } from '../../../utils/contract-storage';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const GET: APIRoute = async ({ request }) => {
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

    const pending = await getPendingDeclarations();

    return new Response(
      JSON.stringify({ declarations: pending }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('Pending declarations error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
