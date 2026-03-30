// ── Schefter Reply Types ──

/** A reply to a Schefter feed post */
export interface SchefterReply {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  author: SchefterReplyAuthor;
  createdAt: string;
}

export type SchefterReplyAuthorType = 'owner' | 'ai';

export interface SchefterReplyAuthor {
  type: SchefterReplyAuthorType;
  /** Franchise ID for owner replies */
  franchiseId?: string;
  /** Display name — team name for owners, character name for AI */
  name: string;
  /** Avatar URL — team icon for owners, character avatar for AI */
  avatar: string;
  /** AI character handle (e.g. @schefter) */
  handle?: string;
  /** Which AI character for AI replies */
  aiCharacter?: 'claude' | 'roger';
}

/** Request body for creating a reply */
export interface CreateReplyRequest {
  body: string;
  parentId?: string;
}

/** Response from the reply API */
export interface ReplyListResponse {
  replies: SchefterReply[];
}

/** Request body for AI reply generation */
export interface AiReplyRequest {
  userReplyId: string;
}
