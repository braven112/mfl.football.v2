/**
 * The owners' copy of the forum archive, for their own AI tools.
 *
 * GET /api/forum-archive/download            → Markdown (best for uploading to an AI)
 * GET /api/forum-archive/download?format=json → the raw archive JSON
 *
 * Signed-in TheLeague owners only.
 */
import type { APIRoute } from 'astro';
import { forumArchiveAccess } from '../../../utils/forum-archive/archive-access';
import { loadForumArchive } from '../../../utils/forum-archive/forum-archive-store';
import { buildArchiveMarkdown } from '../../../utils/forum-archive/archive-download';
import { leagueClock, leagueUrl } from '../../../config/leagues';

export const GET: APIRoute = async ({ request, url }) => {
  const access = forumArchiveAccess(request);
  if (!access.member) {
    return new Response('Sign in as a TheLeague owner to download the archive.', { status: access.user ? 403 : 401 });
  }
  const load = await loadForumArchive();
  if (load.status === 'empty') return new Response('The archive has not been loaded yet.', { status: 404 });
  if (load.status !== 'ok') return new Response('Could not read the archive right now.', { status: 503 });

  const { archive } = load;
  const stamp = archive.pointer.builtAt.slice(0, 10);
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store' };

  if (url.searchParams.get('format') === 'json') {
    const body = JSON.stringify({
      builtAt: archive.pointer.builtAt,
      forums: archive.forums,
      topics: archive.topics.map(({ chunk: _chunk, ...t }) => t),
      posts: archive.posts,
    });
    return new Response(body, {
      headers: {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="theleague-forum-archive-${stamp}.json"`,
      },
    });
  }

  const markdown = buildArchiveMarkdown(archive, {
    absoluteUrl: (path) => leagueUrl(access.league, path),
    timeZone: leagueClock(access.league.slug).zone,
    leagueName: access.league.name,
  });
  return new Response(markdown, {
    headers: {
      ...headers,
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="theleague-forum-archive-${stamp}.md"`,
    },
  });
};
