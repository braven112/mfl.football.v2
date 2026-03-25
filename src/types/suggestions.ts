// ── Suggestion Box Types ──

/** Author info attached to ideas and comments */
export interface SuggestionAuthor {
  franchiseId: string;
  teamName: string;
}

/** Emoji → array of franchiseIds who reacted */
export interface ReactionMap {
  [emoji: string]: string[];
}

/** Idea categories */
export type IdeaCategory = 'rule-change' | 'website' | 'general';

/** Website suggestion type (bug vs feature) */
export type WebsiteSuggestionType = 'bug' | 'feature';

/** Structured fields for website suggestions */
export interface WebsiteFields {
  type: WebsiteSuggestionType;
  pageOrFeature: string;
  problem: string;
  desiredBehavior: string;
}

/** Commissioner-set status labels */
export type IdeaStatus = 'open' | 'under-review' | 'approved' | 'rejected' | 'implemented' | 'tabled';

/** Image uploaded to Vercel Blob */
export interface ImageAttachment {
  url: string;
  alt?: string;
}

/** Poll option */
export interface PollOption {
  id: string;
  label: string;
}

/** Individual poll vote */
export interface PollVote {
  franchiseId: string;
  optionId: string;
  votedAt: string;
}

/** Custom poll attached to an idea */
export interface Poll {
  id: string;
  options: PollOption[];
  anonymous: boolean;
  votes: PollVote[];
  createdAt: string;
  closedAt?: string;
}

/** Top-level idea (post) */
export interface Idea {
  id: string;
  title: string;
  body: string;
  category: IdeaCategory;
  websiteFields?: WebsiteFields;
  author: SuggestionAuthor;
  images: ImageAttachment[];
  reactions: ReactionMap;
  status: IdeaStatus;
  pinned: boolean;
  locked: boolean;
  archived: boolean;
  poll?: Poll;
  commentCount: number;
  lastActivityAt: string;
  createdAt: string;
  editedAt?: string;
}

/** Comment on an idea (supports threading via parentId) */
export interface Comment {
  id: string;
  ideaId: string;
  parentId: string | null;
  body: string;
  author: SuggestionAuthor;
  images: ImageAttachment[];
  reactions: ReactionMap;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
}

// ── API Request/Response types ──

export interface CreateIdeaRequest {
  title: string;
  body: string;
  category: IdeaCategory;
  websiteFields?: WebsiteFields;
  imageUrls?: string[];
}

export interface UpdateIdeaRequest {
  title?: string;
  body?: string;
  imageUrls?: string[];
}

export interface CreateCommentRequest {
  ideaId: string;
  parentId?: string;
  body: string;
  imageUrls?: string[];
}

export interface UpdateCommentRequest {
  body: string;
  imageUrls?: string[];
}

export interface ToggleReactionRequest {
  emoji: string;
}

export interface CreatePollRequest {
  options: string[];
  anonymous: boolean;
}

export interface CastVoteRequest {
  optionId: string;
}

export interface SetIdeaStatusRequest {
  status: IdeaStatus;
}

export interface IdeasListResponse {
  ideas: Idea[];
}

export interface IdeaDetailResponse {
  idea: Idea;
  comments: Comment[];
}
