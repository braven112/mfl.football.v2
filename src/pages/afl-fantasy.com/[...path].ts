/**
 * The old InMotion `/afl-fantasy.com/*` files, at their old URLs.
 *
 * The AFL's 2016–2024 franchise art on MFL, and the current AFL skin's league
 * logos, still point at mfl.football/afl-fantasy.com/…. The images were copied
 * to Vercel Blob (scripts/inmotion-migration/report.json); the skin's CSS and
 * JS live under public/afl-fantasy.com/ and are served before this route.
 *
 * A copied file redirects to its Blob URL, and the redirect is CDN-cached, so
 * this function runs about once per file per region. Anything else is a file
 * the migration never saw: it is counted (src/utils/missed-file-log.ts) and
 * sent on to InMotion's copy, or gets the real 404 once that fallback is off.
 * A blanket rewrite to Blob would answer those with Blob's own 404, which
 * nothing can count.
 */
import type { APIRoute } from 'astro';
import report from '../../../scripts/inmotion-migration/report.json';
import {
  inMotionFallbackResponse,
  inMotionFallbackUrl,
  recordMissedFile,
} from '../../utils/missed-file-log';

export const prerender = false;

const BLOB_PATHS = new Set(
  report.files.filter((file) => file.status === 'blob').map((file) => file.path),
);

function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export const GET: APIRoute = async ({ url, request, rewrite }) => {
  if (BLOB_PATHS.has(decodedPath(url.pathname))) {
    return new Response(null, {
      status: 308,
      headers: {
        Location: `${report.blobHost}${url.pathname}`,
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000',
      },
    });
  }
  await recordMissedFile(url, request.headers.get('referer'));
  const fallback = inMotionFallbackUrl(url);
  if (fallback) return inMotionFallbackResponse(fallback);
  return rewrite(new URL('/_not-found', url));
};
