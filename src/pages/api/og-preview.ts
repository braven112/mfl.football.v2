import type { APIRoute } from 'astro';
import { getOgPreview } from '../../utils/og-preview';
import { validatePublicUrl } from '../../utils/url-guard';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url).searchParams.get('url');
  if (!url || !/^https?:\/\//i.test(url)) {
    return new Response(JSON.stringify({ error: 'Invalid or missing url param' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SSRF guard — refuse URLs that point at internal/private address space
  const blocked = await validatePublicUrl(url);
  if (blocked) {
    return new Response(JSON.stringify({ error: blocked }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const preview = await getOgPreview(url);
    if (!preview) {
      return new Response(JSON.stringify({ preview: null }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }
    return new Response(JSON.stringify({ preview }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Browser/CDN cache for 1 hour; Redis caches for 7 days underneath
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('[api/og-preview] Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch preview' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
