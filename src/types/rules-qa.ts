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

export interface RulesQAListResponse {
  items: RulesQA[];
}
