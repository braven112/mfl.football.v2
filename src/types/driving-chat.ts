/** Types for the Driving Coach Billy chatbot */

export interface DrivingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface DrivingSession {
  id: string;
  messages: DrivingMessage[];
  mode: 'chat' | 'quiz';
  createdAt: string;
}

export interface QuizQuestion {
  id: string;
  topic: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  /** Which WA guide section this comes from */
  source: string;
}

export interface QuizState {
  currentQuestion: QuizQuestion | null;
  selectedAnswer: number | null;
  isRevealed: boolean;
  score: { correct: number; total: number };
  topicFilter: string | null;
}

export type DrivingTopic = {
  id: string;
  label: string;
  icon: string;
  description: string;
};

export interface DrivingChatRequest {
  message: string;
  mode: 'chat' | 'quiz';
  /** For quiz mode: topic filter */
  topic?: string;
  /** For quiz: request next question */
  requestQuiz?: boolean;
}

export interface DrivingChatResponse {
  message: string;
  quiz?: QuizQuestion;
  error?: string;
}
