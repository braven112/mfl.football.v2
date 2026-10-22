/**
 * Load a new copy of the forum archive into Redis. Commissioner only.
 *
 * The archive page's import panel builds the archive in the browser from the
 * phpBB `.sql` export (or a prebuilt archive `.json`), then sends it in steps,
 * because a Redis request — and a function body — is size-capped:
 *
 *   POST { step: 'begin' }                                  → { version }
 *   POST { step: 'chunk', version, index, posts }           → { ok }
 *   POST { step: 'commit', version, chunkCount, index }     → { pointer }
 *
 * `current` flips only on commit, after every chunk is confirmed present, so
 * the live archive is never half-replaced.
 */
import type { APIRoute } from 'astro';
import { forumArchiveAccess } from '../../../utils/forum-archive/archive-access';
import {
  commitArchive,
  isValidVersion,
  newVersion,
  writeChunk,
  type ArchiveIndex,
} from '../../../utils/forum-archive/forum-archive-store';
import { sanitizeIndex, sanitizePosts } from '../../../utils/forum-archive/archive-validate';

const MAX_CHUNKS = 64;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const access = forumArchiveAccess(request);
  if (!access.commissioner) return json({ error: 'Commissioner only' }, access.user ? 403 : 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  try {
    if (body?.step === 'begin') return json({ version: newVersion() });

    if (!isValidVersion(body?.version)) return json({ error: 'Bad version' }, 400);

    if (body.step === 'chunk') {
      const n = Number(body.index);
      if (!Number.isInteger(n) || n < 0 || n >= MAX_CHUNKS) return json({ error: 'Bad chunk index' }, 400);
      const posts = sanitizePosts(body.posts);
      if (!posts) return json({ error: 'Chunk is not a list of posts' }, 400);
      await writeChunk(body.version, n, posts);
      return json({ ok: true, posts: posts.length });
    }

    if (body.step === 'commit') {
      const chunkCount = Number(body.chunkCount);
      if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS) {
        return json({ error: 'Bad chunk count' }, 400);
      }
      const index: ArchiveIndex | null = sanitizeIndex(body.index);
      if (!index) return json({ error: 'Index is malformed' }, 400);
      const pointer = await commitArchive(body.version, index, chunkCount);
      return json({ pointer });
    }

    return json({ error: 'Unknown step' }, 400);
  } catch (e) {
    console.error('[forum-archive/import] failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Import failed' }, 500);
  }
};
