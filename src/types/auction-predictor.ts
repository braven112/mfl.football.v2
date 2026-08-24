/**
 * Auction Predictor / salary-cap domain types.
 *
 * These types were imported by the whole cap + auction stack
 * (`cap-space-calculator`, `league-cap`, `franchise-tag-predictor`,
 * `multi-contract-pricer`, `draft-pick-cap-impact`,
 * `championship-window-detector`, `csv-exporter`, `rankings-importer`,
 * `rankings-parser`) but the module itself was missing, so every one of
 * those files type-checked against `any`. Reconstructed from usage.
 */

/** Roster positions after normalization (K is normalized to PK, all DEF aliases to DEF). */
export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF';

/** How urgently a team needs bodies at a position. */
export type NeedPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * A player as seen by the auction/cap tooling: identity, contract state, and
 * whatever valuation signals have been layered on so far.
 */
export interface PlayerValuation {
  id: string;
  name: string;
  position: Position;
  /** NFL team abbreviation; absent/empty for free agents. */
  team?: string;
  age: number;
  /** Years of NFL experience. */
  experience: number;

  currentSalary: number;
  contractYearsRemaining: number;

  /** True when the contract lapses at the upcoming Feb 15 rollover. */
  isExpiring?: boolean;
  isFranchiseTagCandidate?: boolean;
  /** 0-1 likelihood the player draws a franchise tag. */
  franchiseTagProbability?: number;
  /** Positional tag salary, populated once tag math has run. */
  franchiseTagSalary?: number;

  /** Ranks are layered on from imports; absent until rankings are merged. */
  dynastyRank?: number;
  redraftRank?: number;
  compositeRank?: number;

  /** Valuation outputs, populated by the pricing pass. */
  auctionPrice?: number;
  estimatedFairValue?: number;
  positionalScarcity?: number;
}

/** One year of a multi-year contract. */
export interface ContractYear {
  year: number;
  salary: number;
  /** In this league cap hit always equals salary. */
  capHit: number;
}

/** A full escalation schedule for one contract (10% annual escalation). */
export interface ContractEscalation {
  playerId: string;
  /** First season of the contract. */
  baseYear: number;
  baseSalary: number;
  contractYears: number;
  yearlySchedule: ContractYear[];
  totalContractValue: number;
  averageAnnualValue: number;
}

/** A position a team needs to fill, and how badly. */
export interface PositionalNeed {
  position: string;
  priority: NeedPriority;
  currentDepth: number;
  targetAcquisitions: number;
}

/** A team's projected cap position going into the offseason. */
export interface TeamCapSituation {
  franchiseId: string;
  teamName: string;

  /** Current-season space; 0 when only projection data is loaded. */
  currentCapSpace: number;
  projectedCapSpace2026: number;
  committedSalaries: number;
  deadMoney: number;

  expiringContracts: PlayerValuation[];
  totalExpiringValue: number;

  franchiseTagCommitment: number;
  availableAfterTag: number;

  /** League minimum x roster spots still to fill. */
  estimatedMinimumRosterSpend: number;
  /** Cap space beyond the minimum roster spend. */
  discretionarySpending: number;

  positionalNeeds: PositionalNeed[];
}

/** One row of an imported rankings list, after MFL player matching. */
export interface RankingEntry {
  rank: number;
  /** MFL player id; absent when the row could not be matched. */
  playerId?: string;
  playerName: string;
  position: string;
  team?: string;
  tier?: number;
  notes?: string;
  matched: boolean;
}

/** A parsed rankings import from an external source. */
export interface PlayerRankingImport {
  source: 'fantasypros' | 'dynastyleaguefootball' | 'custom' | 'sleeper';
  rankingType: 'dynasty' | 'redraft';
  importDate: Date;
  rankings: RankingEntry[];
}

/** One expiring player considered for a team's franchise tag, with its score. */
export interface FranchiseTagCandidate {
  player: PlayerValuation;
  /** 0-100; the top candidate is tagged at >= 50. */
  score: number;
  reasons: string[];
}

/** A team's predicted franchise-tag decision for the offseason. */
export interface FranchiseTagPrediction {
  franchiseId: string;
  teamName: string;
  hasTag: boolean;
  /** null when no expiring player cleared the tag threshold. */
  taggedPlayer: PlayerValuation | null;
  /** Top candidates, highest score first. */
  tagCandidates: FranchiseTagCandidate[];
  /** True once a commissioner override replaces the computed pick. */
  isManualOverride: boolean;
}
