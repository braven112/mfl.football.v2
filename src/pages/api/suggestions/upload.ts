/**
 * Suggestion Box — Image Upload (Client Upload Pattern)
 *
 * PUT /api/suggestions/upload?filename=photo.jpg
 *
 * Uses Vercel Blob's client upload pattern to bypass the 4.5MB
 * serverless function body limit. This endpoint generates a presigned
 * upload token; the client sends the file directly to Blob storage.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const PUT: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[suggestions] BLOB_READ_WRITE_TOKEN not set');
    return json({ error: 'Image uploads are not configured.' }, 503);
  }

  try {
    const { handleUpload } = await import('@vercel/blob/client');

    const body = await request.json();

    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Validate the upload
        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          maximumSizeInBytes: 2 * 1024 * 1024, // 5MB
          tokenPayload: JSON.stringify({ franchiseId: user.franchiseId }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('[suggestions] Upload completed:', blob.url, 'by', user.franchiseId);
      },
    });

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[suggestions] Upload failed:', message);
    return json({ error: `Upload failed: ${message}` }, 500);
  }
};

// Keep POST as a simple fallback for smaller files
export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json({ error: 'Image uploads are not configured.' }, 503);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Invalid form data' }, 400);
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return json({ error: 'No file provided' }, 400);
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' }, 400);
  }

  if (file.size > 2 * 1024 * 1024) {
    return json({ error: 'File too large. Maximum 5MB.' }, 400);
  }

  try {
    const { put } = await import('@vercel/blob');
    const ext = file.name.split('.').pop() || 'jpg';
    const filename = `suggestions/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const blob = await put(filename, file, {
      access: 'public',
      contentType: file.type,
    });

    return json({ url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[suggestions] Upload failed:', message);
    return json({ error: `Upload failed: ${message}` }, 500);
  }
};
