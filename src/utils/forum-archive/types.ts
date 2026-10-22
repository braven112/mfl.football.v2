/** Shapes of TheLeague's forum archive (built by build-archive.mjs). */

export interface ArchiveForum {
  id: number;
  name: string;
  parentId: number;
  /** Names from the root category down to this forum. */
  path: string[];
  topicCount: number;
  postCount: number;
}

export interface ArchiveTopic {
  id: number;
  forumId: number;
  title: string;
  author: string;
  /** Unix seconds. */
  startedAt: number;
  lastPostAt: number;
  postCount: number;
  /** Storage chunk holding this topic's posts. */
  chunk?: number;
}

export interface ArchivePost {
  id: number;
  topicId: number;
  author: string;
  /** Unix seconds. */
  time: number;
  subject: string;
  /** The archive's Markdown subset — see phpbb-markup.mjs. */
  body: string;
}
