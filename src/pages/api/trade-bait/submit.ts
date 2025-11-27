/**
 * API Endpoint: POST /api/trade-bait/submit
 * Handles trade bait submission to MFL
 * Only allows users to place players from their own franchise on trade bait
 */

import type { APIRoute } from 'astro';
import { getAuthUser, requireAuth, isFranchiseOwner, isAuthorizedForLeague } from '../../../utils/auth';

interface TradeBaitSubmissionRequest {
  leagueId: string;
  playerId: string;
  playerName: string;
  status: 'on_trade_bait' | 'off_trade_bait';
  // franchiseId is optional - if not provided, we use the user's franchiseId from session
  franchiseId?: string;
}

interface TradeBaitTransaction {
  id: string;
  leagueId: string;
  franchiseId: string;
  playerId: string;
  playerName: string;
  status: 'on_trade_bait' | 'off_trade_bait';
  submittedBy: string;
  submittedAt: Date;
  mflStatus: 'pending' | 'success' | 'failed';
  mflResponse?: any;
}

/**
 * In-memory storage for trade bait transactions (replace with real database)
 * TODO: Replace with actual database (Postgres, MongoDB, etc.)
 */
const tradeBaitTransactions: Map<string, TradeBaitTransaction> = new Map();

/**
 * Push trade bait status to MFL
 * Communicates with MFL API to update player trade bait status
 */
async function pushToMFL(transaction: TradeBaitTransaction): Promise<boolean> {
  try {
    const year = new Date().getFullYear();
    const leagueId = transaction.leagueId;
    const playerId = transaction.playerId;
    const status = transaction.status;

    // MFL API endpoint for updating player trade bait status
    const mflUrl = `https://www${leagueId % 50}.myfantasyleague.com/${year}/export`;

    const params = {
      TYPE: 'playerTradeBait',
      L: leagueId,
      FRANCHISE_ID: transaction.franchiseId,
      PLAYER_ID: playerId,
      STATUS: status === 'on_trade_bait' ? '1' : '0',
      JSON: '1',
    };

    const mflResponse = await fetch(mflUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
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
    if (data.error || data.success === false) {
      throw new Error(data.error || 'MFL API returned an error');
    }

    transaction.mflResponse = {
      success: true,
      message: `Player ${status === 'on_trade_bait' ? 'placed on' : 'removed from'} trade bait on MFL`,
    };
    transaction.mflStatus = 'success';

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    transaction.mflResponse = {
      success: false,
      error: errorMessage,
      message: 'Failed to update trade bait status on MFL',
    };
    transaction.mflStatus = 'failed';

    return false;
  }
}

/**
 * Generate unique transaction ID
 */
function generateTransactionId(): string {
  return `TRADEBAIT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // Check authentication
    const authUser = getAuthUser(request);
    if (!requireAuth(authUser)) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'You must be logged in to manage trade bait',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const body: TradeBaitSubmissionRequest = await request.json();

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

    // CRITICAL: Use the user's franchiseId from session, not from request
    // This ensures users can only manage trade bait for their own franchise
    // The franchiseId in the body is only used if provided, but we always use the session's franchiseId
    const franchiseId = authUser.franchiseId;


    // Create transaction record
    const transaction: TradeBaitTransaction = {
      id: generateTransactionId(),
      leagueId: body.leagueId,
      franchiseId, // Use user's franchiseId from session
      playerId: body.playerId,
      playerName: body.playerName,
      status: body.status,
      submittedBy: authUser.name,
      submittedAt: new Date(),
      mflStatus: 'pending',
    };

    // Store transaction locally first (before MFL push)
    tradeBaitTransactions.set(transaction.id, transaction);

    // Attempt to push to MFL
    const mflSuccess = await pushToMFL(transaction);

    // Update transaction in storage with MFL response
    tradeBaitTransactions.set(transaction.id, transaction);

    // Return response (success or failure, both are recorded)
    return new Response(
      JSON.stringify({
        success: mflSuccess,
        transactionId: transaction.id,
        status: transaction.mflStatus,
        playerName: transaction.playerName,
        tradeBaitStatus: transaction.status,
        mflResponse: transaction.mflResponse,
        message: mflSuccess
          ? `Player successfully ${transaction.status === 'on_trade_bait' ? 'placed on' : 'removed from'} trade bait on MFL`
          : 'Trade bait status saved locally but failed to push to MFL. An admin will manually sync this later.',
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
