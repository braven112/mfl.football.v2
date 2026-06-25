/**
 * Scouting System Types
 *
 * Year-round per-franchise GM dossiers + event reports (rookie draft, season
 * start, trade deadline, playoffs, year-end) + a prediction ledger that
 * accumulates outcomes for accuracy tracking over time.
 *
 * Storage layout:
 *   data/fantasy-expert/scouting-system/
 *     franchises/<id>-<slug>.json          ← FranchiseDossier (living)
 *     reports/<year>-<event>/predictions.json  ← EventReport
 *     reports/<year>-<event>/meta.json     ← ReportMeta
 *     predictions-ledger.json              ← PredictionsLedger
 */

export type EventType =
  | 'rookie-draft'
  | 'season-start'
  | 'trade-deadline'
  | 'playoffs'
  | 'year-end';

/** Living per-franchise dossier — updated by every report run. */
export interface FranchiseDossier {
  franchiseId: string;
  franchiseSlug: string;
  franchiseName: string;
  abbrev: string;
  division: string;

  /** Most recent roster snapshot taken when the dossier was last updated. */
  rosterSnapshot: {
    season: number;
    capUsed: number;
    capSpace: number;
    deadCap: number;
    activeCount: number;
    taxiCount: number;
    irCount: number;
    contractsExpiring: number;
    capturedAt: string;
  };

  /** Compounding behavioral notes accumulated from each report run. */
  behavioralNotes: BehavioralNote[];

  /** RSP affinity computed from the rsp-league-ownership.json affinity panel. */
  rspAffinity: {
    score: 'high' | 'medium' | 'low';
    abCount: number;
    abPct: number;
  };

  /** Last-N rookie drafts: positional bias + reach tendency. */
  draftPatterns?: {
    sampleYears: number[];
    positionalBias: Record<string, number>;
    avgReachVsConsensus?: number;
  };

  lastUpdated: string;
}

export interface BehavioralNote {
  /** Auto-generated id so we can dedupe/replace identical notes. */
  id: string;
  /** ISO date this note was first added. */
  addedAt: string;
  /** Which report originated the note. */
  source: { eventType: EventType; year: number };
  /** Free-form intelligence: "Loves SEC WRs", "Always punts QB", etc. */
  text: string;
  /** Confidence 0-1; can be updated as the pattern is reinforced. */
  confidence: number;
}

/** A single GM's scouting brief for a specific event. */
export interface GMBrief {
  franchiseId: string;
  franchiseName: string;

  /** Top 3-5 players this owner is likely to target. */
  topTargets: TargetPlayer[];
  /** Positions this team is prioritizing (roster need + age curve). */
  positionalPriority: string[];
  /** "Cap-strapped, will reach for cheap projected starters" etc. */
  capPosture: string;
  /** Players likely to be taxi-stashed at 50%. */
  taxiCandidates: string[];
  /** A surprise pick — the lower-confidence wildcard. */
  wildcard?: TargetPlayer;
  /** Free-form 2-3 sentence narrative summary. */
  summary: string;
}

export interface TargetPlayer {
  name: string;
  position: string;
  /** Optional player id (MFL or RSP key) for cross-linking. */
  playerId?: string;
  /** Why this owner wants him (RSP fit, positional need, value, etc.). */
  reasoning: string;
  /** Likelihood the owner picks him IF he's available, 0-1. */
  desire: number;
  /**
   * Earliest round the owner is willing to spend on this player. Defaults
   * to 1 (i.e. willing to take in any round). Use 2+ to mark a "second-round
   * value" or "trade-up target" that shouldn't be reached in earlier rounds.
   * The mock-assembler skips the target if `currentRound < preferredRound`.
   */
  preferredRound?: number;
}

/** A single mock pick in the assembled draft. */
export interface MockPick {
  overallPick: number;
  round: number;
  pickInRound: number;
  franchiseId: string;
  franchiseName: string;
  player: TargetPlayer;
  /** "BPA per board", "Need pick", "Reach", etc. */
  pickType: string;
  /** Short narrative explaining why this player at this slot. */
  reasoning: string;
  /** Other owners who also wanted this player (lost the conflict). */
  alsoWantedBy?: string[];
}

/** The complete event report. */
export interface EventReport {
  eventType: EventType;
  year: number;
  briefs: GMBrief[];
  mock: MockPick[];
  /** Cross-cutting observations: who's most likely to trade up, etc. */
  marketNotes: string[];
}

export interface ReportMeta {
  eventType: EventType;
  year: number;
  generatedAt: string;
  generator: string;
  modelUsed: string;
  agentCallCount: number;
  durationMs: number;
  /** Hash of inputs so we can detect when re-gen is needed. */
  inputHash?: string;
}

/** Append-only ledger of every prediction we've ever made. */
export interface PredictionsLedger {
  predictions: PredictionEntry[];
}

export interface PredictionEntry {
  id: string;
  predictedAt: string;
  eventType: EventType;
  year: number;
  franchiseId: string;
  /** "rookie-draft.target", "rookie-draft.mock-pick", "year-end.extension", etc. */
  predictionKind: string;
  predicted: unknown;
  /** Filled in later by an outcome-scoring script. */
  outcome?: {
    resolvedAt: string;
    actual: unknown;
    correct: boolean;
    /** 0-1 partial credit score for fuzzy predictions. */
    score?: number;
    notes?: string;
  };
}
