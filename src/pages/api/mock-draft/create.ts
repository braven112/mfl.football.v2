/**
 * POST /api/mock-draft/create
 *
 * Creates a new mock draft session in the PartyKit mock-draft party.
 * Seeds the session with draft order (from draftResults or randomized)
 * and a ranked player list (by dynasty ADP) for auto-pick fallback.
 *
 * Body: { timerSeconds: number, totalRounds: number, useRealOrder: boolean }
 * Returns: { success: true, sessionId: string }
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

/** Generate a short unique ID (no external deps) */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Shuffle array in place (Fisher-Yates) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build snake-order draft sequence from a list of franchise IDs.
 * Odd rounds go forward (1→N), even rounds go reverse (N→1).
 */
function buildSnakeOrder(franchiseIds: string[], totalRounds: number): string[] {
  const order: string[] = [];
  for (let round = 1; round <= totalRounds; round++) {
    if (round % 2 === 1) {
      order.push(...franchiseIds);
    } else {
      order.push(...[...franchiseIds].reverse());
    }
  }
  return order;
}

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required. Please sign in.' }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  if (!user.franchiseId) {
    return new Response(
      JSON.stringify({ success: false, message: 'No franchise associated with your account.' }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  try {
    const body = await request.json();
    const timerSeconds = body.timerSeconds ?? 120;
    const totalRounds = body.totalRounds ?? 3;
    const useRealOrder = body.useRealOrder ?? true;

    // Validate timer presets
    if (![60, 120, 300].includes(timerSeconds)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid timer. Use 60, 120, or 300 seconds.' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    if (totalRounds < 1 || totalRounds > 5) {
      return new Response(
        JSON.stringify({ success: false, message: 'Rounds must be between 1 and 5.' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const leagueId = user.leagueId || '13522';
    const leagueYear = getCurrentLeagueYear();
    const leagueYearStr = String(leagueYear);

    // ── Load draft order from draftResults ──
    // Dynamic import of the MFL feed data for this year
    let franchiseOrder: string[] = [];
    try {
      const draftResultsFeeds = import.meta.glob(
        '../../../../data/theleague/mfl-feeds/*/draftResults.json',
        { eager: true },
      );
      const draftResultsKey = Object.keys(draftResultsFeeds).find(
        (path) => path.includes(`/${leagueYearStr}/`),
      );
      if (draftResultsKey) {
        const mod = draftResultsFeeds[draftResultsKey] as any;
        const data = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
        const picks = data?.draftResults?.draftUnit?.draftPick;
        const pickArray: any[] = picks ? (Array.isArray(picks) ? picks : [picks]) : [];

        // Round 1 picks give us the base draft order
        const round1Picks = pickArray
          .filter((p: any) => parseInt(p.round || '0') === 1)
          .sort((a: any, b: any) => parseInt(a.pick || '0') - parseInt(b.pick || '0'));

        franchiseOrder = round1Picks.map((p: any) => p.franchise as string).filter(Boolean);
      }
    } catch (e) {
      console.warn('[mock-draft/create] Could not load draft results, using config fallback');
    }

    // Fallback: load team IDs from league config
    if (franchiseOrder.length === 0) {
      try {
        const configMod = await import('../../../data/theleague.config.json');
        const config = configMod.default || configMod;
        franchiseOrder = (config.teams || []).map((t: any) => t.franchiseId as string);
      } catch {
        return new Response(
          JSON.stringify({ success: false, message: 'Could not determine draft order.' }),
          { status: 500, headers: JSON_HEADERS },
        );
      }
    }

    // Randomize if requested
    if (!useRealOrder) {
      shuffle(franchiseOrder);
    }

    const picksPerRound = franchiseOrder.length;
    const draftOrder = buildSnakeOrder(franchiseOrder, totalRounds);

    // ── Build ranked player list for auto-pick (by dynasty ADP) ──
    let rankedPlayerIds: string[] = [];
    try {
      const adpFeeds = import.meta.glob(
        '../../../../data/theleague/mfl-feeds/*/adp-dynasty.json',
        { eager: true },
      );
      const adpKey = Object.keys(adpFeeds).find(
        (path) => path.includes(`/${leagueYearStr}/`),
      );
      if (adpKey) {
        const adpMod = adpFeeds[adpKey] as any;
        const adpData = adpMod && typeof adpMod === 'object' && 'default' in adpMod ? adpMod.default : adpMod;
        const adpPlayers = adpData?.adp?.player;
        const adpArray: any[] = adpPlayers ? (Array.isArray(adpPlayers) ? adpPlayers : [adpPlayers]) : [];

        // Sort by ADP (lowest = best) and extract IDs
        rankedPlayerIds = adpArray
          .sort((a: any, b: any) => parseFloat(a.averagePick || '999') - parseFloat(b.averagePick || '999'))
          .map((p: any) => p.id as string)
          .filter(Boolean);
      }
    } catch {
      console.warn('[mock-draft/create] Could not load ADP data for auto-pick ranking');
    }

    // ── Build pre-populated pick slots ──
    const totalPicks = totalRounds * picksPerRound;
    const picks = Array.from({ length: totalPicks }, (_, i) => {
      const overallPickNumber = i + 1;
      const round = Math.ceil(overallPickNumber / picksPerRound);
      const pickInRound = overallPickNumber - (round - 1) * picksPerRound;
      return {
        overallPickNumber,
        round,
        pickInRound,
        franchiseId: draftOrder[i],
      };
    });

    // ── Create session ──
    const sessionId = generateId();
    const session = {
      id: sessionId,
      leagueId,
      leagueYear,
      createdBy: user.franchiseId,
      createdAt: new Date().toISOString(),
      status: 'lobby' as const,
      draftOrder,
      picksPerRound,
      totalRounds,
      currentPickIndex: 0,
      timerSeconds,
      picks,
      participants: [],
      useRealOrder,
    };

    // ── Write session to PartyKit storage via HTTP ──
    const partyHost = import.meta.env.PUBLIC_PARTYKIT_HOST;
    if (!partyHost) {
      return new Response(
        JSON.stringify({ success: false, message: 'PartyKit host not configured.' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }

    // PartyKit multi-party HTTP: POST to /parties/mock-draft/{roomId}
    const partyUrl = `${partyHost}/parties/mock-draft/${sessionId}`;

    // Use PartyKit's storage API — POST the session as the room's initial state
    const partyRes = await fetch(partyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, rankedPlayerIds }),
    });

    if (!partyRes.ok) {
      console.error('[mock-draft/create] PartyKit init failed:', partyRes.status);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to initialize draft session.' }),
        { status: 502, headers: JSON_HEADERS },
      );
    }

    // ── Track active session ──
    // Store in a lightweight KV so the list endpoint can find active sessions
    // We'll use a second PartyKit room keyed by leagueId as a session registry
    const registryUrl = `${partyHost}/parties/mock-draft/${leagueId}-registry`;
    try {
      await fetch(registryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          sessionId,
          summary: {
            id: sessionId,
            createdBy: user.franchiseId,
            createdAt: session.createdAt,
            status: 'lobby',
            participantCount: 0,
            totalTeams: picksPerRound,
            currentRound: 1,
            currentPickInRound: 1,
            timerSeconds,
            totalRounds,
          },
        }),
      });
    } catch {
      // Non-fatal — list might not work but the session is created
      console.warn('[mock-draft/create] Could not register session in registry');
    }

    return new Response(
      JSON.stringify({ success: true, sessionId }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('[mock-draft/create] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
