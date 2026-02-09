/**
 * Contract Management Types
 * Defines types for contract year submission, tracking, and history
 */

export type ContractTransactionStatus = 'pending' | 'success' | 'failed' | 'retry_pending';

export interface ContractTransaction {
  id: string;
  leagueId: string;
  playerId: string;
  playerName: string;
  franchiseId: string;
  oldContractYears: number;
  newContractYears: number;
  submittedBy: string; // Owner name/ID
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
