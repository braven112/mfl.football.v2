/**
 * API endpoint for moving players to IR
 * Handles one-click IR moves through MFL API
 */

import type { APIRoute } from 'astro';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { playerId, franchiseId } = await request.json();

    if (!playerId || !franchiseId) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing required parameters: playerId and franchiseId' 
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Create MFL API client with authentication
    const mflClient = createMFLApiClient({
      leagueId: process.env.MFL_LEAGUE_ID || '13522',
      year: new Date().getFullYear().toString(),
      mflUserId: process.env.MFL_USER_ID,
      mflApiKey: process.env.MFL_APIKEY,
    });

    // Attempt to move player to IR
    const success = await mflClient.movePlayerToIR(playerId, franchiseId);

    if (success) {
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Player successfully moved to IR'
        }),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      return new Response(
        JSON.stringify({ 
          error: 'Failed to move player to IR. Please check authentication or try manually.' 
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

  } catch (error) {
    console.error('IR move API error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error. Please try again or use manual IR move.' 
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};