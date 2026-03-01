/**
 * Contract Management Types
 * Defines types for contract year submission, tracking, and history
 */

import type { DeclarationType } from './contract-eligibility';

// --- Legacy types (kept for backward compat with existing contract-validation.ts) ---

export type ContractTransactionStatus = 'pending' | 'success' | 'failed' | 'retry_pending';

export interface ContractTransaction {
  id: string;
  leagueId: string;
  playerId: string;
  playerName: string;
  franchiseId: string;
  oldContractYears: number;
  newContractYears: number;
  submittedBy: string;
  submittedAt: Date;
  status: ContractTransactionStatus;
  mflResponse?: {
    success: boolean;
    message?: string;
    mflTransactionId?: string;
    error?: string;
  };
  retryCount: number;
  lastRetryAt?: Date;
}

export interface ContractSubmissionRequest {
  leagueId: string;
  playerId: string;
  playerName: string;
  franchiseId: string;
  oldContractYears: number;
  newContractYears: number;
  submittedBy: string;
}

export interface ContractValidationError {
  field: string;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationError[];
  windowStatus?: {
    inWindow: boolean;
    windowType?: 'offseason' | 'in-season';
    reason?: string;
  };
}

// --- New declaration system types ---

/** Status of a contract declaration through the approval workflow */
export type DeclarationStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'expired';

/** A contract declaration submitted by an owner for commissioner approval */
export interface ContractDeclaration {
  id: string;
  type: DeclarationType;
  playerId: string;
  playerName: string;
  franchiseId: string;
  franchiseName: string;
  leagueId: string;
  /** Current state before the change */
  currentYears: number;
  currentSalary: number;
  currentContractInfo: string;
  /** Requested change */
  requestedYears: number;
  requestedSalary?: number;
  requestedContractInfo?: string;
  /** Workflow status */
  status: DeclarationStatus;
  submittedBy: string;
  submittedAt: string; // ISO timestamp
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  /** MFL sync state */
  mflSynced: boolean;
  mflSyncedAt?: string;
  mflError?: string;
  /** Metadata */
  deadlineAt?: string;
  acquisitionTimestamp?: number;
}
