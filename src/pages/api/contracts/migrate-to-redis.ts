/**
 * POST /api/contracts/migrate-to-redis
 *
 * One-time migration: reads all declarations from Vercel Blob
 * and writes them to Upstash Redis. Safe to run multiple times
 * (idempotent — overwrites existing Redis data with Blob data).
 *
 * Requires commissioner authentication.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import type { ContractDeclaration } from '../../../types/contracts';
import { bulkImportDeclarations } from '../../../utils/contract-storage';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readFromBlob(): Promise<ContractDeclaration[]> {
  try {
    const { list: listBlobs } = await import('@vercel/blob');
    const { blobs } = await listBlobs({ prefix: 'data/contract-declarations.json', limit: 1 });
    if (blobs.length === 0) return [];

    const fetchUrl = blobs[0].downloadUrl || blobs[0].url;
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json() as ContractDeclaration[];
  } catch (err) {
    console.error('[migrate] Blob read error:', err);
    return [];
  }
}

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isCommissionerOrAdmin(user)) {
    return new Response(
      JSON.stringify({ error: 'Commissioner access required' }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  try {
    const blobData = await readFromBlob();
    if (blobData.length === 0) {
      return new Response(
        JSON.stringify({ migrated: 0, message: 'No declarations found in Blob' }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    const ok = await bulkImportDeclarations(blobData);
    if (!ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to write to Redis' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }

    return new Response(
      JSON.stringify({
        migrated: blobData.length,
        declarations: blobData.map(d => ({ id: d.id, player: d.playerName, status: d.status })),
        message: `Migrated ${blobData.length} declarations from Blob to Redis`,
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('[migrate] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Migration failed' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
