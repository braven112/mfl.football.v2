/**
 * API Endpoint: POST /api/contracts/submit
 * Handles contract year submission, validation, MFL push, and transaction logging
 */

import type { APIRoute } from 'astro';
import type { ContractSubmissionRequest, ContractTransaction } from '../../../types/contracts';
import { validateContractSubmission, getContractWindow } from '@mfl/league-utils';
import { getAuthUser, requireAuth, isFranchiseOwner, isAuthorizedForLeague } from '@mfl/shared-utils';

/**
 * In-memory storage for contract transactions (replace with real database)
 * TODO: Replace with actual database (Postgres, MongoDB, etc.)
 */
const contractTransactions: Map<string, ContractTransaction> = new Map();

/**
 * Push contract update to MFL
 * Communicates with MFL API to update player contract years
 */
async function pushToMFL(transaction: ContractTransaction): Promise<boolean> {
  try {
    // Get current year from league (MFL uses year-based URLs)
    const year = new Date().getFullYear();
    const leagueId = transaction.leagueId;
    const playerId = transaction.playerId;
    const contractYears = transaction.newContractYears;

    // MFL API endpoint for updating player contract
    // Using the franchise endpoint which handles contract updates
    const mflUrl = `https://www${leagueId % 50}.myfantasyleague.com/${year}/export`;

    console.log('Pushing contract to MFL:', {
      playerId,
      contractYears,
      leagueId,
      year,
    });

    const mflResponse = await fetch(mflUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        TYPE: 'playerContract',
        L: leagueId,
        FRANCHISE_ID: transaction.franchiseId,
        PLAYER_ID: playerId,
        CONTRACT_YEARS: String(contractYears),
        JSON: '1',
      }).toString(),
    });

    if (!mflResponse.ok) {
      throw new Error(`MFL API error: ${mflResponse.status} ${mflResponse.statusText}`);
    }

    const responseText = await mflResponse.text();
    let data: any;

    // Try to parse as JSON, fallback to text if not JSON
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { response: responseText };
    }

    // Check for MFL-specific error responses
    if (data.error || (data.success === false)) {
      throw new Error(data.error || 'MFL API returned an error');
    }

    transaction.mflResponse = {
      success: true,
      mflTransactionId: data.transactionId || `MFL_${Date.now()}`,
      message: 'Contract updated on MFL',
    };
    transaction.status = 'success';

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error('MFL API Error:', {
      playerId: transaction.playerId,
      leagueId: transaction.leagueId,
      error: errorMessage,
    });

    transaction.mflResponse = {
      success: false,
      error: errorMessage,
      message: 'Failed to push contract to MFL',
    };
    transaction.status = 'failed';

    return false;
  }
}

/**
 * Generate unique transaction ID
 */
function generateTransactionId(): string {
  return `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // Check authentication
    const authUser = getAuthUser(request);
    if (!requireAuth(authUser)) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'You must be logged in to submit contracts',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const body: ContractSubmissionRequest = await request.json();

    // Verify user is authorized for this league
    if (!isAuthorizedForLeague(authUser, body.leagueId)) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'You are not authorized for this league',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Verify user owns the franchise they're modifying
    if (!isFranchiseOwner(authUser, body.franchiseId)) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'You can only modify contracts for your own franchise',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate contract submission
    const validation = validateContractSubmission(
      body.leagueId,
      body.oldContractYears,
      body.newContractYears,
      body.playerId,
      body.franchiseId
    );

    if (!validation.valid) {
      return new Response(
        JSON.stringify({
          error: 'Validation failed',
          errors: validation.errors,
          windowStatus: validation.windowStatus,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Create transaction record
    const transaction: ContractTransaction = {
      id: generateTransactionId(),
      leagueId: body.leagueId,
      playerId: body.playerId,
      playerName: body.playerName,
      franchiseId: body.franchiseId,
      oldContractYears: body.oldContractYears,
      newContractYears: body.newContractYears,
      submittedBy: body.submittedBy,
      submittedAt: new Date(),
      status: 'pending',
      retryCount: 0,
    };

    // Store transaction locally first (before MFL push)
    contractTransactions.set(transaction.id, transaction);

    // Attempt to push to MFL
    const mflSuccess = await pushToMFL(transaction);

    // Update transaction in storage with MFL response
    contractTransactions.set(transaction.id, transaction);

    // Return response (success or failure, both are recorded)
    return new Response(
      JSON.stringify({
        success: mflSuccess,
        transactionId: transaction.id,
        status: transaction.status,
        playerName: transaction.playerName,
        contractYears: transaction.newContractYears,
        mflResponse: transaction.mflResponse,
        message: mflSuccess
          ? 'Contract successfully updated on MFL'
          : 'Contract saved locally but failed to push to MFL. An admin will manually sync this later.',
      }),
      {
        status: mflSuccess ? 200 : 202,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return new Response(
      JSON.stringify({
        error: 'Server error',
        message: errorMessage,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

/**
 * GET /api/contracts/submit
 * Retrieve transaction history (for admin/viewing)
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const authUser = getAuthUser(request);
    if (!requireAuth(authUser)) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'You must be logged in',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Return transactions for user's league
    const userTransactions = Array.from(contractTransactions.values()).filter(
      (t) => t.leagueId === authUser.leagueId
    );

    return new Response(JSON.stringify({ transactions: userTransactions }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return new Response(
      JSON.stringify({
        error: 'Server error',
        message: errorMessage,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
