/**
 * Suggestion Box — Giphy GIF Search
 *
 * GET /api/suggestions/gif-search?q=touchdown
 *
 * Proxies search requests to the Giphy API so the API key stays server-side.
 * Free tier: 100 requests/hour (plenty for a 16-owner league).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

interface GiphyResult {
  id: string;
  title: string;
  images: {
    original: GiphyImage;
    fixed_width: GiphyImage;
    fixed_width_small: GiphyImage;
    preview_gif: GiphyImage;
  };
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    return json({ error: 'GIF search is not configured.' }, 503);
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim();

  if (!query || query.length < 1) {
    return json({ error: 'Search query required' }, 400);
  }

  try {
    const giphyUrl = new URL('https://api.giphy.com/v1/gifs/search');
    giphyUrl.searchParams.set('api_key', apiKey);
    giphyUrl.searchParams.set('q', query);
    giphyUrl.searchParams.set('limit', '20');
    giphyUrl.searchParams.set('rating', 'pg-13');
    giphyUrl.searchParams.set('lang', 'en');

    const res = await fetch(giphyUrl.toString());
    if (!res.ok) {
      console.error('[suggestions] Giphy API error:', res.status, await res.text());
      return json({ error: 'GIF search failed' }, 502);
    }

    const data = await res.json() as { data: GiphyResult[] };

    const results = data.data.map(g => ({
      id: g.id,
      url: g.images.original.url,
      preview: g.images.fixed_width_small?.url || g.images.fixed_width?.url || g.images.original.url,
      alt: g.title || '',
    }));

    return json({ results });
  } catch (err) {
    console.error('[suggestions] Giphy search error:', err);
    return json({ error: 'GIF search failed' }, 500);
  }
};
