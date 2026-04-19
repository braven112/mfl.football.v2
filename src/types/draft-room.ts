/**
 * Draft Room Types
 * Shared between Astro page, API route, and React components
 */

/** Position codes used for color-coding */
export type DraftPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF';

/** Position → CSS color token map, shared by BoardCell and DraftBoardPanel */
export const POSITION_COLORS: Record<string, string> = {
  QB: 'var(--dr-pos-qb, #dc2626)',
  RB: 'var(--dr-pos-rb, #16a34a)',
  WR: 'var(--dr-pos-wr, #2563eb)',
  TE: 'var(--dr-pos-te, #7c3aed)',
  PK: 'var(--dr-pos-pk, #d97706)',
  DEF: 'var(--dr-pos-def, #6b7280)',
};

/** Draft mode derived from league.json draft_kind */
export type DraftKind = 'email' | 'live';

/** A single pick slot in the draft */
export interface DraftRoomPick {
  round: number;
  pickInRound: number;
  overallPickNumber: number;
  /** Franchise ID that owns this pick */
  franchiseId: string;
  /** MFL player ID — empty string if pick not yet made */
  playerId: string;
  /** Unix epoch seconds — empty string if pick not yet made */
  timestamp: string;
  /** Trade comments from MFL (e.g., "[Pick traded from Team Name.]") */
  comments: string;
  isTraded: boolean;
  originalTeamName?: string;
}

/** Team identity for draft room display */
export interface DraftRoomTeam {
  franchiseId: string;
  name: string;
  nameMedium: string;
  nameShort: string;
  abbrev: string;
  icon: string;
}

/** RSP tier grades A (elite) → F (UDFA watch) */
export type RspTier = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Player in the draft pool */
export interface DraftRoomPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot: string;
  isRookie?: boolean;
  mflId?: string;
  espnId?: string;
  /** MFL draft_year (for rookies) */
  draftYear?: number;
  /** Player age in years */
  age?: number;
  /** College (for rookies) */
  college?: string;

  // ── RSP scouting (joined server-side from fantasy-expert/sources/rsp) ──
  rspTier?: RspTier;
  rspPositionRank?: string;
  rspScore?: number;
  rspGrade?: string;
  rspTypes?: string[];
  rspComparison?: string;
  rspFantasyAdvice?: string;
  rspNotes?: string;

  // ── MFL ADP (joined server-side from mfl-feeds/{year}/adp-dynasty.json) ──
  adpRank?: number;
  adpAveragePick?: number;
  adpMinPick?: number;
  adpMaxPick?: number;
  adpDraftSelPct?: number;
}

/** Data serialized from Astro frontmatter to React island */
export interface DraftRoomPageData {
  leagueYear: number;
  draftKind: DraftKind;
  draftLimitHours: string;
  draftTimerSusp: string;
  totalRounds: number;
  picksPerRound: number;
  teams: DraftRoomTeam[];
  picks: DraftRoomPick[];
  players: DraftRoomPlayer[];
  /** PartyKit host for chat WebSocket */
  partyHost: string;
  /** MFL league ID — used when polling /api/draft/status */
  leagueId: string;
}

/** Response from /api/draft/status */
export interface DraftStatusResponse {
  picks: DraftRoomPick[];
  /** Timestamp of the API response for staleness detection */
  serverTime: number;
}

// ── Queue Types ──────────────────────────────────────────────────────────────

/** A single item in the user's pre-draft queue */
export interface DraftQueueItem {
  /** Unique ID for dnd-kit key (stable across reorders) */
  id: string;
  playerId: string;
  addedAt: number;
}

// ── Chat Types ───────────────────────────────────────────────────────────────

/** Emoji reactions available in chat — the fantasy football essentials */
export type ReactionEmoji = '👍' | '🔥' | '😂' | '💀';

export const REACTION_EMOJIS: ReactionEmoji[] = ['👍', '🔥', '😂', '💀'];

/** A single chat message relayed through PartyKit */
export interface ChatMessage {
  id: string;
  type: 'chat' | 'pick' | 'system' | 'reaction';
  senderId: string;
  senderName: string;
  senderIcon: string;
  text: string;
  timestamp: number;
  gifUrl?: string;
  replyTo?: string;
  /** For type='reaction': the emoji code */
  emoji?: string;
  /** For type='reaction': the message being reacted to */
  targetId?: string;
  /** Emoji → list of senderIds (populated/updated by server) */
  reactions?: Record<string, string[]>;
}

/** GIF search result (provider-neutral — backed by Giphy via /api/suggestions/gif-search) */
export interface DraftGif {
  id: string;
  title: string;
  previewUrl: string;
  fullUrl: string;
}

// ── React State ──────────────────────────────────────────────────────────────

/** Draft context — determines default filter behavior in the player pool */
export type DraftContext = 'rookie' | 'general';

/** Operating mode for DraftRoom — 'live' polls MFL, 'mock' uses PartyKit session */
export type DraftRoomMode = 'live' | 'mock';

/** React useReducer state */
export interface DraftRoomState {
  picks: DraftRoomPick[];
  players: DraftRoomPlayer[];
  teams: DraftRoomTeam[];

  // Derived
  currentPickNumber: number;
  draftComplete: boolean;

  // UI state
  activeRound: number;
  activeMobileTab: 'board' | 'players' | 'queue' | 'chat';
  searchQuery: string;
  positionFilter: string | null;
  rookiesOnly: boolean;

  // Polling
  lastPollTimestamp: number;
  pollError: string | null;

  // Queue
  queue: DraftQueueItem[];
  autoSubmit: boolean;
  isSyncingQueue: boolean;
  isSubmittingPick: boolean;
  submitError: string | null;

  // Chat
  chatMessages: ChatMessage[];
  chatConnected: boolean;
  chatUnread: number;

  // Draft config
  draftKind: DraftKind;
  draftLimitHours: string;
  draftTimerSusp: string;
  totalRounds: number;
  picksPerRound: number;
  leagueYear: number;
  leagueId: string;

  // Mock draft state
  mockSession: MockDraftSession | null;
  mockClockSeconds: number;
}

/** React useReducer actions */
export type DraftRoomAction =
  | { type: 'POLL_SUCCESS'; picks: DraftRoomPick[] }
  | { type: 'POLL_ERROR'; error: string }
  | { type: 'SET_ACTIVE_ROUND'; round: number }
  | { type: 'SET_MOBILE_TAB'; tab: 'board' | 'players' | 'queue' | 'chat' }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'SET_POSITION_FILTER'; position: string | null }
  | { type: 'SET_ROOKIES_ONLY'; value: boolean }
  // Queue actions
  | { type: 'LOAD_QUEUE'; items: DraftQueueItem[] }
  | { type: 'ADD_TO_QUEUE'; playerId: string }
  | { type: 'REMOVE_FROM_QUEUE'; id: string }
  | { type: 'REORDER_QUEUE'; oldIndex: number; newIndex: number }
  | { type: 'TOGGLE_AUTO_SUBMIT' }
  | { type: 'SYNC_QUEUE_START' }
  | { type: 'SYNC_QUEUE_DONE' }
  | { type: 'SUBMIT_PICK_START' }
  | { type: 'SUBMIT_PICK_DONE' }
  | { type: 'SET_SUBMIT_ERROR'; error: string | null }
  // Chat actions
  | { type: 'CHAT_HISTORY'; messages: ChatMessage[] }
  | { type: 'CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'CHAT_REACTION'; messageId: string; emoji: string; reactions: Record<string, string[]> }
  | { type: 'CHAT_CONNECTED' }
  | { type: 'CHAT_DISCONNECTED' }
  | { type: 'CHAT_CLEAR_UNREAD' }
  // Mock draft actions
  | { type: 'MOCK_SESSION_SYNC'; session: MockDraftSession }
  | { type: 'MOCK_PICK_MADE'; pick: MockPick; session: MockDraftSession }
  | { type: 'MOCK_CLOCK_TICK'; secondsRemaining: number };

// ── Mock Draft Types ────────────────────────────────────────────────────────

export type MockDraftStatus = 'lobby' | 'active' | 'paused' | 'completed';

export type MockTimerPreset = 60 | 120 | 300;

/**
 * Ranking source keys the auto-pick engine recognizes. Each AI team may be
 * assigned a different source so mock drafts produce realistic board variance.
 *
 * NOTE: RSP (Matt Waldman's Rookie Scouting Portfolio) is intentionally absent
 * — it's licensed content gated to franchise 0001 and must never drive a CPU
 * team, even as a last-resort fallback.
 */
export type MockRankingSource =
  | 'mfl-rookie'
  | 'mfl-dynasty'
  | 'sleeper'
  | 'ktc'
  | 'fbg'
  | 'random';

/** Human-readable labels for the lobby dropdown */
export const MOCK_RANKING_LABELS: Record<MockRankingSource, string> = {
  'mfl-rookie': 'MFL Rookie ADP',
  'mfl-dynasty': 'MFL Dynasty ADP',
  sleeper: 'Sleeper',
  ktc: 'KeepTradeCut',
  fbg: 'FBG Rookies',
  random: 'Chaos (random)',
};

/** Full mock draft session state — stored in PartyKit Durable Object KV */
export interface MockDraftSession {
  id: string;
  leagueId: string;
  leagueYear: number;
  /** franchiseId of the owner who created the session */
  createdBy: string;
  createdAt: string;
  status: MockDraftStatus;
  /** franchiseIds in snake-order, all rounds flattened */
  draftOrder: string[];
  picksPerRound: number;
  totalRounds: number;
  /** 0-based index into draftOrder for the current pick */
  currentPickIndex: number;
  /** seconds per pick */
  timerSeconds: number;
  picks: MockPick[];
  participants: MockParticipant[];
  /** true = use real MFL futureDraftPicks order, false = randomized */
  useRealOrder: boolean;
  /**
   * Per-franchise ranking-source assignment. Auto-pick reads the source
   * assigned to the team currently on the clock. Missing entries default to
   * `defaultRankingSource` (or `'mfl-rookie'` if that's also missing).
   */
  rankingAssignments?: Record<string, MockRankingSource>;
  /** Source applied to any franchise not present in `rankingAssignments`. */
  defaultRankingSource?: MockRankingSource;
}

/** A single pick in a mock draft */
export interface MockPick {
  overallPickNumber: number;
  round: number;
  pickInRound: number;
  franchiseId: string;
  playerId?: string;
  pickedAt?: string;
  isAutoPick?: boolean;
}

/** A participant connected to a mock draft session */
export interface MockParticipant {
  franchiseId: string;
  connectedAt: string;
  isAutoPickEnabled: boolean;
  isConnected: boolean;
}

/** Lightweight summary used in lobby session cards */
export interface MockDraftSessionSummary {
  id: string;
  createdBy: string;
  createdAt: string;
  status: MockDraftStatus;
  participantCount: number;
  totalTeams: number;
  currentRound: number;
  currentPickInRound: number;
  timerSeconds: number;
  totalRounds: number;
}
