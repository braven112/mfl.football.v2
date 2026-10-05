/**
 * POST /api/admin/branding-upload?league=<slug>
 *
 * One team mark (icon, dark icon or banner) into Vercel Blob, for the branding
 * editor. Returns the public URL; nothing is published until the commissioner
 * saves the team, which goes through /api/admin/branding and the publish
 * workflow like any other edit. Same gate as that route.
 *
 * JSON body: `{ franchiseId, kind, contentType, data }` with `data` the image as
 * base64 (PNG, JPEG or WebP, 2 MB max). JSON rather than multipart because
 * Astro's origin check rejects a form-typed POST from a browser that omits
 * Origin.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { resolveAdministeredLeague } from '../../../utils/league-admin';
import { getLeagueTeamConfigs } from '../../../utils/league-team-brands';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { IMAGE_FIELDS } from '../../../utils/branding-edit.mjs';

export const prerender = false;

const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_BYTES = 2 * 1024 * 1024;

export const POST: APIRoute = async ({ request, url }) => {
  const fail = (status: number, error: string) => json({ ok: false, error }, status, JSON_HEADERS_NO_STORE);

  const resolved = resolveAdministeredLeague(getAuthUser(request), url.searchParams.get('league'));
  if (!resolved.ok) return fail(resolved.status, resolved.error);
  const league = resolved.league;
  if (!league.features.brandingEditor) return fail(403, 'The branding editor is not turned on for this league.');
  if (!process.env.BLOB_READ_WRITE_TOKEN) return fail(503, 'Image uploads are not configured.');

  let body: { franchiseId?: unknown; kind?: unknown; contentType?: unknown; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Expected a JSON upload.');
  }
  const franchiseId = String(body.franchiseId ?? '');
  const kind = String(body.kind ?? '');
  const contentType = String(body.contentType ?? '');
  if (typeof body.data !== 'string' || body.data === '') return fail(400, 'No file.');
  if (!IMAGE_FIELDS.includes(kind)) return fail(400, 'Unknown image kind.');
  if (!getLeagueTeamConfigs(league.slug).some((t: { franchiseId?: string }) => t.franchiseId === franchiseId)) {
    return fail(400, 'Unknown team.');
  }
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return fail(400, 'Use a PNG, JPEG or WebP image.');
  // Size is checked on the ENCODED length first, so an oversized body is
  // refused before it is decoded into memory.
  if (body.data.length > Math.ceil((MAX_BYTES * 4) / 3) + 4) return fail(400, 'Images must be 2 MB or smaller.');
  const bytes = Buffer.from(body.data, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return fail(400, 'Images must be 2 MB or smaller.');

  try {
    const { put } = await import('@vercel/blob');
    // League + team + kind in the path, and a timestamp so a replaced mark
    // gets a new URL (a CDN-cached old one can never shadow it).
    const pathname = `branding/${league.slug}/${franchiseId}/${kind}-${Date.now()}.${ext}`;
    const blob = await put(pathname, bytes, { access: 'public', contentType });
    return json({ ok: true, url: blob.url }, 200, JSON_HEADERS_NO_STORE);
  } catch (err) {
    console.error('[branding-upload] failed:', err instanceof Error ? err.message : err);
    return fail(502, 'Upload failed — try again.');
  }
};
