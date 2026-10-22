/**
 * Shape checks for what the import panel uploads. The commissioner is
 * trusted, but the browser is not a type system: anything stored here is
 * later rendered and handed to the model, so each field is coerced to the
 * type the readers expect and anything else is dropped.
 */
import type { ArchiveIndex } from './forum-archive-store';
import type { ArchiveForum, ArchivePost, ArchiveTopic } from './types';

const MAX_BODY = 60_000;
const MAX_TEXT = 300;

const int = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);
const str = (v: unknown, max = MAX_TEXT): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

export function sanitizePosts(value: unknown): ArchivePost[] | null {
  if (!Array.isArray(value)) return null;
  const out: ArchivePost[] = [];
  for (const p of value) {
    const id = int(p?.id);
    const topicId = int(p?.topicId);
    const time = int(p?.time);
    const author = str(p?.author);
    const subject = str(p?.subject);
    const body = str(p?.body, MAX_BODY);
    if (id === null || topicId === null || time === null || author === null || subject === null || body === null) {
      return null;
    }
    out.push({ id, topicId, time, author, subject, body });
  }
  return out;
}

function sanitizeForum(f: any): ArchiveForum | null {
  const id = int(f?.id);
  const parentId = int(f?.parentId);
  const topicCount = int(f?.topicCount);
  const postCount = int(f?.postCount);
  const name = str(f?.name);
  const path = Array.isArray(f?.path) ? f.path.map((p: unknown) => str(p)) : null;
  if (id === null || parentId === null || topicCount === null || postCount === null || name === null) return null;
  if (!path || path.some((p: string | null) => p === null)) return null;
  return { id, name, parentId, path, topicCount, postCount };
}

function sanitizeTopic(t: any): ArchiveTopic | null {
  const fields = {
    id: int(t?.id),
    forumId: int(t?.forumId),
    startedAt: int(t?.startedAt),
    lastPostAt: int(t?.lastPostAt),
    postCount: int(t?.postCount),
    chunk: int(t?.chunk),
    title: str(t?.title),
    author: str(t?.author),
  };
  if (Object.values(fields).some((v) => v === null)) return null;
  return fields as ArchiveTopic;
}

export function sanitizeIndex(value: any): ArchiveIndex | null {
  if (!value || !Array.isArray(value.forums) || !Array.isArray(value.topics)) return null;
  const forums = value.forums.map(sanitizeForum);
  const topics = value.topics.map(sanitizeTopic);
  if (forums.some((f: unknown) => !f) || topics.some((t: unknown) => !t) || !topics.length) return null;
  return {
    schema: int(value.schema) ?? 1,
    builtAt: str(value.builtAt, 40) ?? new Date().toISOString(),
    forums,
    topics,
  };
}
