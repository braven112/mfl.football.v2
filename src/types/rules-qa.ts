export interface RulesQA {
  id: string;
  question: string;
  answer: string;
  askedBy: {
    franchiseId: string;
    teamName: string;
  } | null;
  createdAt: string;
  isPreSeeded: boolean;
}

export interface AskQuestionRequest {
  question: string;
}

export interface AskQuestionResponse {
  qa: RulesQA;
  wasDuplicate: boolean;
}

/**
 * Owner-reported "this answer looks wrong" state, attached to a Q&A by the
 * list endpoint. Never persisted on the RulesQA record itself — see
 * src/utils/rules-qa-flags.ts for why the flags live in their own keys.
 */
export interface RulesQAFlags {
  count: number;
  flaggedByMe: boolean;
  /** Admin-only. Absent for regular owners, who see only the count. */
  flaggers?: Array<{
    franchiseId: string;
    teamName: string;
    reason: string | null;
    at: string;
  }>;
}

/** A Q&A as the list endpoint returns it: the stored record plus view state. */
export interface RulesQAWithFlags extends RulesQA {
  flags?: RulesQAFlags;
}

export interface RulesQAListResponse {
  items: RulesQAWithFlags[];
}

export interface FlagAnswerRequest {
  id: string;
  /** true = report this answer, false = withdraw my report. */
  flagged: boolean;
  reason?: string;
}

export interface FlagAnswerResponse {
  id: string;
  flags: RulesQAFlags;
}
