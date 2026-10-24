/**
 * TheLeague's old InMotion `/images/*` files, at their old mfl.football URLs.
 *
 * Some of TheLeague's MFL seasons load franchise art from
 * mfl.football/images/team_banners/… rather than theleague.us/images/…; both
 * hosts served the same InMotion folder. The files were already copied to
 * Blob for theleague.us (scripts/inmotion-migration/theleague-report.json,
 * served by src/pages/theleague/images/[...path].ts), so this route answers
 * the same paths on mfl.football from that same copy. theleague.us never
 * reaches this route: the middleware rewrites its /images/* to /theleague/.
 *
 * Anything else is a file the migrations never saw: it is counted
 * (src/utils/missed-file-log.ts) and sent on to InMotion's copy, or gets the
 * real 404 once that fallback is off.
 */
import type { APIRoute } from 'astro';
import report from '../../../scripts/inmotion-migration/theleague-report.json';
import {
  inMotionFallbackResponse,
  inMotionFallbackUrl,
  recordMissedFile,
} from '../../utils/missed-file-log';

export const prerender = false;

const BLOB_PATHS = new Set(
  report.files.filter((file) => file.status === 'blob').map((file) => file.path),
);

export const GET: APIRoute = async ({ params, url, request, rewrite }) => {
  const filePath = `/images/${params.path ?? ''}`;
  if (report.blobHost && BLOB_PATHS.has(filePath)) {
    return new Response(null, {
      status: 308,
      headers: {
        Location: `${report.blobHost}/${report.blobPrefix}${encodeURI(filePath)}`,
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000',
      },
    });
  }
  await recordMissedFile(url, request.headers.get('referer'));
  const fallback = inMotionFallbackUrl(url);
  if (fallback) return inMotionFallbackResponse(fallback);
  return rewrite(new URL('/_not-found', url));
};
