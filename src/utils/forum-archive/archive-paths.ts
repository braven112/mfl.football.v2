/**
 * Routes of the forum archive. The Tag History page links into threads with
 * these, so a move of the archive is a change here only.
 */
export const FORUM_ARCHIVE_PATH = '/theleague/contracts/forum-archive';

export function forumArchiveTopicPath(topicId: number, postId?: number): string {
  return `${FORUM_ARCHIVE_PATH}/t/${topicId}${postId ? `#p${postId}` : ''}`;
}

export function forumArchiveSectionPath(forumId: number): string {
  return `${FORUM_ARCHIVE_PATH}?f=${forumId}`;
}
