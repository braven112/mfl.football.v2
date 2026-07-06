/**
 * Per-post Open Graph image — /api/og/schefter/<postId>.png
 *
 * The unfurl image for Schefter feed deep-links dropped in GroupMe. Renders
 * the featured player composite (or the branded text-only card) for a feed
 * post; see src/utils/schefter-og.ts for the rendering rules.
 *
 * postId must resolve against the committed feed JSON — unknown ids 404, so
 * the endpoint can't be used to render arbitrary content or proxy images.
 * Posts never change after publish, so successful renders are cached hard
 * (Vercel's edge cache resets on deploy, which is the escape hatch if the
 * renderer itself needs a fix).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { findSchefterPost, isValidPostId, renderSchefterOgPng } from '../../../../utils/schefter-og';

export const GET: APIRoute = async ({ params }) => {
  const postId = params.postId ?? '';
  if (!isValidPostId(postId)) {
    return new Response('Not found', { status: 404 });
  }

  const found = findSchefterPost(postId);
  if (!found) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const png = await renderSchefterOgPng(found.post, found.league);
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        // Client 1 day, CDN 1 year — post content is immutable after publish.
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
      },
    });
  } catch (err) {
    console.error(`[og] Failed to render ${postId}:`, err);
    return new Response('Render failed', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
};
