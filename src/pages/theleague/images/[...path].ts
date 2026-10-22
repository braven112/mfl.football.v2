/**
 * TheLeague's old InMotion `/images/*` files, at their old URLs.
 *
 * TheLeague's 2011–2024 MFL seasons load every franchise icon and banner from
 * theleague.us/images/team_banners/…, which InMotion served until theleague.us
 * moved to Vercel. The images were copied to Vercel Blob under `theleague.us/`
 * (scripts/inmotion-migration/theleague-report.json). On a league host the
 * middleware rewrites /images/* here.
 *
 * A copied file redirects to its Blob URL, and the redirect is CDN-cached, so
 * this function runs about once per file per region. Anything else is a 404.
 */
import type { APIRoute } from 'astro';
import report from '../../../../scripts/inmotion-migration/theleague-report.json';

export const prerender = false;

const BLOB_PATHS = new Set(
  report.files.filter((file) => file.status === 'blob').map((file) => file.path),
);

export const GET: APIRoute = async ({ params, rewrite, url }) => {
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
  return rewrite(new URL('/_not-found', url));
};
