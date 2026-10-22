/**
 * Redis storage for TheLeague's forum archive.
 *
 * The archive is the old phpBB board's posts, and the repo is public, so it is
 * never committed — the commissioner imports it through the archive page and
 * it lives here. Layout (one immutable version per import):
 *
 *   forum-archive:current            → { version, builtAt, importedAt, chunkCount, topicCount, postCount }
 *   forum-archive:v:<version>:index  → { forums, topics (each with its chunk) }
 *   forum-archive:v:<version>:chunk:<n> → posts of a run of whole topics
 *
 * Chunks are written first and `current` flips last, so a reader never sees
 * half an import. `forum-archive:tags` belongs to the Tag History page.
 *
 * A warm function keeps the assembled archive in memory and re-checks only the
 * small `current` pointer per request.
 */
import { getRedis } from '../redis-client';
import type {
  ArchiveForum,
  ArchivePost,
  ArchiveTopic,
} from './types';

export const FORUM_ARCHIVE_PREFIX = 'forum-archive';
export const CURRENT_KEY = `${FORUM_ARCHIVE_PREFIX}:current`;
export const indexKey = (version: string) => `${FORUM_ARCHIVE_PREFIX}:v:${version}:index`;
export const chunkKey = (version: string, n: number) => `${FORUM_ARCHIVE_PREFIX}:v:${version}:chunk:${n}`;

export interface ArchivePointer {
  version: string;
  builtAt: string;
  importedAt: string;
  chunkCount: number;
  topicCount: number;
  postCount: number;
}

export interface ArchiveIndex {
  schema: number;
  builtAt: string;
  forums: ArchiveForum[];
  topics: ArchiveTopic[];
}

export interface LoadedArchive {
  pointer: ArchivePointer;
  forums: ArchiveForum[];
  topics: ArchiveTopic[];
  posts: ArchivePost[];
  forumById: Map<number, ArchiveForum>;
  topicById: Map<number, ArchiveTopic>;
  postsByTopic: Map<number, ArchivePost[]>;
}

/** 'empty' = nothing imported yet; 'unavailable' = could not read storage. */
export type ArchiveLoad =
  | { status: 'ok'; archive: LoadedArchive }
  | { status: 'empty' }
  | { status: 'unavailable' };

let memo: LoadedArchive | null = null;

export async function getArchivePointer(): Promise<ArchivePointer | null | 'unavailable'> {
  const redis = await getRedis();
  if (!redis) return 'unavailable';
  try {
    return (await redis.get<ArchivePointer>(CURRENT_KEY)) ?? null;
  } catch (e) {
    console.warn('[forum-archive] pointer read failed:', e);
    return 'unavailable';
  }
}

export async function loadForumArchive(): Promise<ArchiveLoad> {
  const pointer = await getArchivePointer();
  if (pointer === 'unavailable') return { status: 'unavailable' };
  if (!pointer) return { status: 'empty' };
  if (memo && memo.pointer.version === pointer.version) return { status: 'ok', archive: memo };

  const redis = await getRedis();
  if (!redis) return { status: 'unavailable' };
  try {
    const [index, ...chunks] = await Promise.all([
      redis.get<ArchiveIndex>(indexKey(pointer.version)),
      ...Array.from({ length: pointer.chunkCount }, (_, n) =>
        redis.get<ArchivePost[]>(chunkKey(pointer.version, n)),
      ),
    ]);
    if (!index || chunks.some((c) => !Array.isArray(c))) {
      console.warn(`[forum-archive] version ${pointer.version} is incomplete`);
      return { status: 'unavailable' };
    }
    memo = assemble(pointer, index, (chunks as ArchivePost[][]).flat());
    return { status: 'ok', archive: memo };
  } catch (e) {
    console.warn('[forum-archive] load failed:', e);
    return { status: 'unavailable' };
  }
}

export function assemble(pointer: ArchivePointer, index: ArchiveIndex, posts: ArchivePost[]): LoadedArchive {
  const postsByTopic = new Map<number, ArchivePost[]>();
  for (const p of posts) {
    const list = postsByTopic.get(p.topicId);
    if (list) list.push(p);
    else postsByTopic.set(p.topicId, [p]);
  }
  for (const list of postsByTopic.values()) list.sort((a, b) => a.time - b.time || a.id - b.id);
  return {
    pointer,
    forums: index.forums,
    topics: index.topics,
    posts,
    forumById: new Map(index.forums.map((f) => [f.id, f])),
    topicById: new Map(index.topics.map((t) => [t.id, t])),
    postsByTopic,
  };
}

// ── Import (commissioner) ────────────────────────────────────────────────

/** Versions are server-minted at the first chunk; a client may only echo one. */
export function isValidVersion(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-z]{6,32}$/.test(v);
}

export function newVersion(now = Date.now()): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function writeChunk(version: string, n: number, posts: ArchivePost[]): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error('Storage unavailable');
  await redis.set(chunkKey(version, n), posts);
}

/**
 * Write the index, flip `current` to this version, then delete the version it
 * replaced. Refuses if any chunk the index points at is missing.
 */
export async function commitArchive(version: string, index: ArchiveIndex, chunkCount: number): Promise<ArchivePointer> {
  const redis = await getRedis();
  if (!redis) throw new Error('Storage unavailable');

  const needed = new Set(index.topics.map((t) => t.chunk));
  for (const n of needed) {
    if (typeof n !== 'number' || n < 0 || n >= chunkCount) throw new Error(`Topic points at chunk ${n} of ${chunkCount}`);
  }
  const present = await Promise.all(
    Array.from({ length: chunkCount }, (_, n) => redis.get<unknown[]>(chunkKey(version, n))),
  );
  const missing = present.findIndex((c) => !Array.isArray(c));
  if (missing >= 0) throw new Error(`Chunk ${missing} was never uploaded`);

  const postCount = (present as unknown[][]).reduce((sum, c) => sum + c.length, 0);
  await redis.set(indexKey(version), index);

  const previous = await redis.get<ArchivePointer>(CURRENT_KEY);
  const pointer: ArchivePointer = {
    version,
    builtAt: index.builtAt,
    importedAt: new Date().toISOString(),
    chunkCount,
    topicCount: index.topics.length,
    postCount,
  };
  await redis.set(CURRENT_KEY, pointer);

  if (previous && previous.version !== version) {
    await Promise.all([
      redis.del(indexKey(previous.version)),
      ...Array.from({ length: previous.chunkCount }, (_, n) => redis.del(chunkKey(previous.version, n))),
    ]).catch((e) => console.warn('[forum-archive] old version cleanup failed:', e));
  }
  memo = null;
  return pointer;
}
