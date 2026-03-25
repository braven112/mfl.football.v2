/**
 * Suggestion Box — Image Upload
 *
 * POST /api/suggestions/upload — Upload image to Vercel Blob
 *
 * Accepts multipart/form-data with a "file" field.
 * Returns the public blob URL.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

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

  if (!ALLOWED_TYPES.includes(file.type)) {
    return json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' }, 400);
  }

  if (file.size > MAX_SIZE) {
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
    console.error('[suggestions] Upload failed:', err);
    return json({ error: 'Upload failed' }, 500);
  }
};
