/**
 * API Endpoint: POST /api/contracts/retry
 * Handles retrying failed contract submissions
 */

import type { APIRoute } from 'astro';
import type { ContractTransaction } from '../../../types/contracts';
import { getAuthUser, requireAuth, isAuthorizedForLeague } from '@mfl/shared-utils';

/**
 * In-memory storage reference (shared with submit.ts)
 * TODO: Replace with actual database query
 */
const contractTransactions: Map<string, ContractTransaction> = new Map();

/**
 * Push contract update to MFL (duplicated from submit.ts)
 * TODO: Extract into shared utility module
 */
async function pushToMFL(transaction: ContractTransaction): Promise<boolean> {
  try {
    const year = new Date().getFullYear();
    const leagueId = transaction.leagueId;
    const playerId = transaction.playerId;
    const contractYears = transaction.newContractYears;

    const mflUrl = `https://www${leagueId % 50}.myfantasyleague.com/${year}/export`;

    console.log('Retrying contract push to MFL:', {
      playerId,
      contractYears,
      leagueId,
      attemptNumber: transaction.retryCount + 1,
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

    try {
      data = JSON.parse(responseText);
    } catch {
      data = { response: responseText };
    }

    if (data.error || data.success === false) {
      throw new Error(data.error || 'MFL API returned an error');
    }

    transaction.mflResponse = {
      success: true,
      mflTransactionId: data.transactionId || `MFL_${Date.now()}`,
      message: 'Contract updated on MFL (retry)',
    };
    transaction.status = 'success';

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error('MFL Retry Error:', {
      playerId: transaction.playerId,
      leagueId: transaction.leagueId,
      attemptNumber: transaction.retryCount + 1,
      error: errorMessage,
    });

    transaction.mflResponse = {
      success: false,
      error: errorMessage,
      message: 'Failed to push contract to MFL on retry',
    };
    transaction.status = 'failed';

    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // Check authentication
    const authUser = getAuthUser(request);
    if (!requireAuth(authUser)) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'You must be logged in to retry contracts',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const body = await request.json();
    const { transactionId } = body;

    if (!transactionId) {
      return new Response(
        JSON.stringify({
          error: 'Bad request',
          message: 'Transaction ID is required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Retrieve transaction from storage
    // TODO: Replace with actual database query
    const transaction = contractTransactions.get(transactionId);

    if (!transaction) {
      return new Response(
        JSON.stringify({
          error: 'Not found',
          message: 'Transaction not found',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Verify user is authorized for this league
    if (!isAuthorizedForLeague(authUser, transaction.leagueId)) {
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

    // Check if transaction is eligible for retry
    if (transaction.status !== 'failed' && transaction.status !== 'retry_pending') {
      return new Response(
        JSON.stringify({
          error: 'Invalid state',
          message: `Cannot retry transaction with status: ${transaction.status}`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check retry limit (max 3 attempts)
    const MAX_RETRIES = 3;
    if (transaction.retryCount >= MAX_RETRIES) {
      return new Response(
        JSON.stringify({
          error: 'Retry limit exceeded',
          message: `Maximum retry attempts (${MAX_RETRIES}) exceeded. Please contact support.`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Increment retry counter and update timestamp
    transaction.retryCount += 1;
    transaction.lastRetryAt = new Date();
    transaction.status = 'retry_pending';

    // Update transaction in storage
    contractTransactions.set(transactionId, transaction);

    // Attempt to push to MFL
    const mflSuccess = await pushToMFL(transaction);

    // Update transaction in storage with result
    contractTransactions.set(transactionId, transaction);

    // Return response
    return new Response(
      JSON.stringify({
        success: mflSuccess,
        transactionId: transaction.id,
        status: transaction.status,
        retryCount: transaction.retryCount,
        playerName: transaction.playerName,
        mflResponse: transaction.mflResponse,
        message: mflSuccess
          ? 'Contract successfully updated on MFL'
          : `Contract push failed on retry attempt #${transaction.retryCount}. Please try again or contact support.`,
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
 * GET /api/contracts/retry
 * Get list of failed transactions eligible for retry
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

    // Return failed/retry_pending transactions for user's league
    const failedTransactions = Array.from(contractTransactions.values()).filter(
      (t) =>
        t.leagueId === authUser.leagueId &&
        (t.status === 'failed' || t.status === 'retry_pending') &&
        t.retryCount < 3
    );

    return new Response(JSON.stringify({ transactions: failedTransactions }), {
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
