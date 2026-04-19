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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import {
  buildMflNameLookup,
  resolveMflId,
  formatMflName,
} from '../../../utils/player-name-matching';

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

    // ── Load MFL player catalog (needed by every ranking source below) ──
    // We ship the players feed with the build; third-party sources (Sleeper,
    // KTC, FBG) give us names, so we match them back to MFL IDs here.
    const playersFeeds = import.meta.glob(
      '../../../../data/theleague/mfl-feeds/*/players.json',
      { eager: true },
    );
    const playersKey = Object.keys(playersFeeds).find(
      (p) => p.includes(`/${leagueYearStr}/`),
    );
    const playersMod = playersKey ? (playersFeeds[playersKey] as any) : null;
    const playersData = playersMod && typeof playersMod === 'object' && 'default' in playersMod
      ? playersMod.default
      : playersMod;
    const allPlayersRaw = playersData?.players?.player;
    const allPlayers: any[] = allPlayersRaw
      ? (Array.isArray(allPlayersRaw) ? allPlayersRaw : [allPlayersRaw])
      : [];
    const rookiePool = allPlayers.filter(
      (p: any) => p.status === 'R' || p.draft_year === leagueYearStr,
    );
    const rookieIdSet = new Set(rookiePool.map((p: any) => p.id));

    // Normalized "first last" → MFL id for fuzzy matching (rookies only;
    // the auto-pick list should never include veterans).
    const rookieNameLookup = buildMflNameLookup(
      rookiePool.map((p: any) => ({
        id: p.id,
        name: p.name, // MFL "Last, First"
        position: p.position,
        team: p.team,
      })),
      { includePosition: true },
    );

    /** Convert a list of MFL IDs into the fallback-safe ranked list. */
    const dedupe = (ids: string[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const id of ids) {
        if (!id || seen.has(id)) continue;
        if (!rookieIdSet.has(id)) continue; // only keep confirmed rookies
        seen.add(id);
        out.push(id);
      }
      return out;
    };

    // ── Build ranked rookie player list — cascading fallback ──
    // Never falls back to RSP (licensed content, owner-only).
    //
    //   1. MFL rookie ADP    (live, with CUTOFF=3)
    //   2. MFL dynasty ADP   (local, filtered to rookies)
    //   3. Sleeper           (cached: data/adp/sleeper-rookies-<year>.json)
    //   4. KTC               (cached: data/adp/ktc-rookies-<year>.json)
    //   5. FBG rookies       (data/fantasy-expert/sources/fbg/<year>-rookies.json)
    let rankedPlayerIds: string[] = [];
    let rankingSource = 'none';

    const loadJsonFile = (relPath: string): any => {
      try {
        const abs = join(process.cwd(), relPath);
        if (!existsSync(abs)) return null;
        return JSON.parse(readFileSync(abs, 'utf-8'));
      } catch (err) {
        console.warn(`[mock-draft/create] Could not read ${relPath}:`, (err as Error).message);
        return null;
      }
    };

    // 1. MFL rookie ADP (live)
    try {
      const mflHost = `https://www55.myfantasyleague.com/${leagueYearStr}`;
      const adpUrl = `${mflHost}/export?TYPE=adp&L=${leagueId}&FCOUNT=12&IS_PPR=3&IS_KEEPER=3&IS_MOCK=0&CUTOFF=3&ROOKIES=1&JSON=1`;
      const adpRes = await fetch(adpUrl, { signal: AbortSignal.timeout(5000) });
      if (adpRes.ok) {
        const adpData = await adpRes.json();
        const adpPlayers = adpData?.adp?.player;
        const adpArray: any[] = adpPlayers
          ? (Array.isArray(adpPlayers) ? adpPlayers : [adpPlayers])
          : [];
        const ordered = adpArray
          .sort(
            (a: any, b: any) =>
              parseFloat(a.averagePick || '999') - parseFloat(b.averagePick || '999'),
          )
          .map((p: any) => p.id as string);
        rankedPlayerIds = dedupe(ordered);
        if (rankedPlayerIds.length > 0) rankingSource = 'mfl-rookie-adp';
      }
    } catch {
      // fall through
    }

    // 2. MFL dynasty ADP (local feed, filter to rookies)
    if (rankedPlayerIds.length === 0) {
      const dynasty = loadJsonFile(`data/theleague/mfl-feeds/${leagueYearStr}/adp-dynasty.json`);
      const raw = dynasty?.adp?.player;
      const arr: any[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const ordered = arr
        .filter((p: any) => rookieIdSet.has(p.id))
        .sort(
          (a: any, b: any) =>
            parseFloat(a.averagePick || '999') - parseFloat(b.averagePick || '999'),
        )
        .map((p: any) => p.id as string);
      rankedPlayerIds = dedupe(ordered);
      if (rankedPlayerIds.length > 0) rankingSource = 'mfl-dynasty-adp';
    }

    // 3. Sleeper (cached)
    if (rankedPlayerIds.length === 0) {
      const sleeper = loadJsonFile(`data/adp/sleeper-rookies-${leagueYearStr}.json`);
      if (sleeper?.players?.length) {
        const ids = (sleeper.players as any[])
          .map((p) =>
            resolveMflId(rookieNameLookup, p.name, { position: p.position, team: p.team }),
          )
          .filter((id): id is string => !!id);
        rankedPlayerIds = dedupe(ids);
        if (rankedPlayerIds.length > 0) rankingSource = 'sleeper';
      }
    }

    // 4. KTC (cached, 1QB)
    if (rankedPlayerIds.length === 0) {
      const ktc = loadJsonFile(`data/adp/ktc-rookies-${leagueYearStr}.json`);
      if (ktc?.players?.length) {
        const ids = (ktc.players as any[])
          .map((p) =>
            resolveMflId(rookieNameLookup, p.name, { position: p.position, team: p.team }),
          )
          .filter((id): id is string => !!id);
        rankedPlayerIds = dedupe(ids);
        if (rankedPlayerIds.length > 0) rankingSource = 'ktc';
      }
    }

    // 5. FBG rookies
    if (rankedPlayerIds.length === 0) {
      const fbg = loadJsonFile(`data/fantasy-expert/sources/fbg/${leagueYearStr}-rookies.json`);
      const fbgPlayers: any[] = fbg?.players || fbg?.rankings || [];
      if (fbgPlayers.length) {
        // FBG entries may have a `rank` field; preserve that order if present
        const ordered = fbgPlayers
          .slice()
          .sort((a: any, b: any) => (a.rank ?? 9999) - (b.rank ?? 9999))
          .map((p) =>
            resolveMflId(rookieNameLookup, p.name || p.playerName || '', {
              position: p.position,
              team: p.team || p.nflTeam,
            }),
          )
          .filter((id): id is string => !!id);
        rankedPlayerIds = dedupe(ordered);
        if (rankedPlayerIds.length > 0) rankingSource = 'fbg';
      }
    }

    // Last-resort top-up: any rookies not yet in the list, appended by name
    // order. Avoids empty picks when every source is stale, but keeps the
    // meaningful ranking at the front of the list.
    if (rankedPlayerIds.length < rookiePool.length) {
      const covered = new Set(rankedPlayerIds);
      const tail = rookiePool
        .filter((p: any) => !covered.has(p.id))
        .sort((a: any, b: any) =>
          formatMflName(a.name || '').localeCompare(formatMflName(b.name || '')),
        )
        .map((p: any) => p.id as string);
      rankedPlayerIds = rankedPlayerIds.concat(tail);
    }

    console.log(
      `[mock-draft/create] Ranking source=${rankingSource} size=${rankedPlayerIds.length}`,
    );

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
    const rawPartyHost = import.meta.env.PUBLIC_PARTYKIT_HOST;
    if (!rawPartyHost) {
      return new Response(
        JSON.stringify({ success: false, message: 'PartyKit host not configured.' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }
    // Ensure protocol prefix for server-side fetch (env var may be bare hostname)
    const partyHost = rawPartyHost.startsWith('http') ? rawPartyHost : `https://${rawPartyHost}`;

    // POST to main party with mock- prefixed room ID
    const partyUrl = `${partyHost}/party/mock-${sessionId}`;

    // Use PartyKit's storage API — POST the session as the room's initial state
    const partyRes = await fetch(partyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, rankedPlayerIds, rankingSource }),
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
    const registryUrl = `${partyHost}/party/${leagueId}-registry`;
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
