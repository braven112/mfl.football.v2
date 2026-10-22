/**
 * Turn TheLeague's phpBB database export into the forum archive: forums,
 * topics and posts, with each post body converted to the archive's Markdown
 * subset (see phpbb-markup.mjs).
 *
 * Only what the archive shows is kept. The export also carries every member's
 * email, password hash and IP address, their private messages, sessions and
 * logs — none of it is read here, so none of it can reach the archive, the
 * owners' download or the AI. The repo is public, so the archive itself is
 * never committed either: it lives in Redis (forum-archive-store.ts).
 *
 * Isomorphic: the commissioner's import panel runs this in the browser.
 */
import { readTables } from './sql-dump.mjs';
import { phpbbToMarkdown, decodeEntities } from './phpbb-markup.mjs';

export const FORUM_ARCHIVE_SCHEMA = 1;

/** Tables the archive reads. Nothing else in the dump is ever parsed. */
const TABLES = ['phpbb3_forums', 'phpbb3_topics', 'phpbb3_posts', 'phpbb3_users'];

/**
 * @typedef {{ id: number, name: string, parentId: number, path: string[], topicCount: number, postCount: number }} ArchiveForum
 * @typedef {{ id: number, forumId: number, title: string, author: string, startedAt: number, lastPostAt: number, postCount: number, chunk?: number }} ArchiveTopic
 * @typedef {{ id: number, topicId: number, author: string, time: number, subject: string, body: string }} ArchivePost
 * @typedef {{ schema: number, builtAt: string, forums: ArchiveForum[], topics: ArchiveTopic[], posts: ArchivePost[] }} ForumArchive
 */

/**
 * @param {string} sql  the full text of the `.sql` export
 * @param {{ now?: Date }} [opts]
 * @returns {ForumArchive}
 */
export function buildForumArchive(sql, { now = new Date() } = {}) {
  const t = readTables(sql, TABLES);
  if (!t.phpbb3_posts.length) {
    throw new Error('No phpbb3_posts rows found — is this the forum database export?');
  }

  /** @type {Map<number, string>} */
  const usernames = new Map();
  for (const u of t.phpbb3_users) usernames.set(Number(u.user_id), decodeEntities(String(u.username ?? '')));

  /** @type {Map<number, { id: number, name: string, parentId: number }>} */
  const forumRows = new Map();
  for (const f of t.phpbb3_forums) {
    forumRows.set(Number(f.forum_id), {
      id: Number(f.forum_id),
      name: decodeEntities(String(f.forum_name ?? '')).trim(),
      parentId: Number(f.parent_id) || 0,
    });
  }
  const pathOf = (id) => {
    const path = [];
    const seen = new Set();
    let cur = forumRows.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift(cur.name);
      cur = forumRows.get(cur.parentId);
    }
    return path;
  };

  const visibleTopics = t.phpbb3_topics.filter(
    (r) => Number(r.topic_visibility ?? 1) === 1 && !Number(r.topic_moved_id),
  );
  const topicIds = new Set(visibleTopics.map((r) => Number(r.topic_id)));

  /** @type {ArchivePost[]} */
  const posts = t.phpbb3_posts
    .filter((r) => Number(r.post_visibility ?? 1) === 1 && topicIds.has(Number(r.topic_id)))
    .map((r) => ({
      id: Number(r.post_id),
      topicId: Number(r.topic_id),
      author: usernames.get(Number(r.poster_id)) || decodeEntities(String(r.post_username || '')) || 'Guest',
      time: Number(r.post_time),
      subject: decodeEntities(String(r.post_subject ?? '')).trim(),
      body: phpbbToMarkdown(String(r.post_text ?? '')),
    }))
    .sort((a, b) => a.topicId - b.topicId || a.time - b.time || a.id - b.id);

  /** @type {Map<number, ArchivePost[]>} */
  const byTopic = new Map();
  for (const p of posts) {
    if (!byTopic.has(p.topicId)) byTopic.set(p.topicId, []);
    byTopic.get(p.topicId).push(p);
  }

  /** @type {ArchiveTopic[]} */
  const topics = visibleTopics
    .filter((r) => byTopic.has(Number(r.topic_id)))
    .map((r) => {
      const list = byTopic.get(Number(r.topic_id));
      return {
        id: Number(r.topic_id),
        forumId: Number(r.forum_id),
        title: decodeEntities(String(r.topic_title ?? '')).trim() || list[0].subject || 'Untitled',
        author: list[0].author,
        startedAt: list[0].time,
        lastPostAt: list[list.length - 1].time,
        postCount: list.length,
      };
    })
    .sort((a, b) => b.lastPostAt - a.lastPostAt || b.id - a.id);

  /** @type {Map<number, { topics: number, posts: number }>} */
  const counts = new Map();
  for (const tp of topics) {
    const c = counts.get(tp.forumId) ?? { topics: 0, posts: 0 };
    c.topics += 1;
    c.posts += tp.postCount;
    counts.set(tp.forumId, c);
  }

  // A forum with posts, plus every ancestor of one (so a section filter can
  // walk down from a category that holds no posts of its own).
  const keep = new Set();
  for (const id of counts.keys()) {
    let cur = forumRows.get(id);
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = forumRows.get(cur.parentId);
    }
  }

  /** @type {ArchiveForum[]} */
  const forums = [...forumRows.values()]
    .filter((f) => keep.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      path: pathOf(f.id),
      topicCount: counts.get(f.id)?.topics ?? 0,
      postCount: counts.get(f.id)?.posts ?? 0,
    }));

  return { schema: FORUM_ARCHIVE_SCHEMA, builtAt: now.toISOString(), forums, topics, posts };
}

/**
 * Split an archive for storage: posts grouped by topic (a topic never spans
 * two chunks) into chunks of at most ~`maxBytes` of JSON, and the forum/topic
 * index with each topic's chunk number. Redis requests are size-capped, so
 * neither half may be written as one value.
 *
 * @param {ForumArchive} archive
 * @param {number} [maxBytes]
 * @returns {{ index: { schema: number, builtAt: string, forums: ArchiveForum[], topics: ArchiveTopic[] }, chunks: ArchivePost[][] }}
 */
export function chunkForumArchive(archive, maxBytes = 300_000) {
  /** @type {Map<number, ArchivePost[]>} */
  const byTopic = new Map();
  for (const p of archive.posts) {
    if (!byTopic.has(p.topicId)) byTopic.set(p.topicId, []);
    byTopic.get(p.topicId).push(p);
  }
  /** @type {ArchivePost[][]} */
  const chunks = [];
  /** @type {Map<number, number>} */
  const chunkOf = new Map();
  let current = [];
  let size = 0;
  const topicIds = [...byTopic.keys()].sort((a, b) => a - b);
  for (const id of topicIds) {
    const list = byTopic.get(id);
    const bytes = JSON.stringify(list).length;
    if (current.length && size + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(...list);
    size += bytes;
    chunkOf.set(id, chunks.length);
  }
  if (current.length) chunks.push(current);
  return {
    index: {
      schema: archive.schema,
      builtAt: archive.builtAt,
      forums: archive.forums,
      topics: archive.topics
        .filter((tp) => chunkOf.has(tp.id))
        .map((tp) => ({ ...tp, chunk: chunkOf.get(tp.id) })),
    },
    chunks,
  };
}
