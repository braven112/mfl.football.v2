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
import type { MockRankingSource } from '../../../types/draft-room';
import {
  buildMflNameLookup,
  resolveMflId,
  formatMflName,
} from '../../../utils/player-name-matching';

const ALL_RANKING_SOURCES: MockRankingSource[] = [
  'mfl-rookie',
  'mfl-dynasty',
  'sleeper',
  'ktc',
  'my-rank',
  'random',
];
const RANKING_SOURCE_SET = new Set<MockRankingSource>(ALL_RANKING_SOURCES);

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
    const timerSeconds = body.timerSeconds ?? 10;
    const totalRounds = body.totalRounds ?? 3;
    const useRealOrder = body.useRealOrder ?? true;

    // Validate timer presets
    if (![1, 3, 10, 15].includes(timerSeconds)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid timer. Use 1, 3, 10, or 15 seconds.' }),
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
    // Mirror the client's `buildDraftPlayers` filter: this league only drafts
    // skill positions + PK/DEF. Source feeds (dynasty ADP, KTC, Sleeper) include
    // IDPs (LB/DE/DT/CB/S) which are valid rookies but render blank on the
    // board because the client's playerMap excludes them. Drop them at the
    // source so AI auto-picks never produce a slot the UI can't render.
    const DRAFTABLE = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']);
    const normPos = (pos: string): string => {
      if (!pos) return '';
      const upper = pos.toUpperCase();
      if (upper.startsWith('TM') || upper === 'DEF' || upper === 'D/ST') return 'DEF';
      if (upper === 'PK' || upper === 'K') return 'PK';
      return upper;
    };
    const rookiePool = allPlayers.filter((p: any) => {
      const isRookie = p.status === 'R' || p.draft_year === leagueYearStr;
      if (!isRookie) return false;
      return DRAFTABLE.has(normPos(p.position || ''));
    });
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

    // ── Build ranked rookie player lists — one per source ──
    // Each AI team can be assigned a different source so mock drafts produce
    // realistic board variance. RSP is intentionally omitted: it's licensed
    // content gated to franchise 0001 and must never drive a CPU team.
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

    /**
     * Any rookies not yet in `ids` are appended alphabetically so the list
     * always has enough players to carry a draft to completion.
     */
    const topUp = (ids: string[]): string[] => {
      if (ids.length >= rookiePool.length) return ids;
      const covered = new Set(ids);
      const tail = rookiePool
        .filter((p: any) => !covered.has(p.id))
        .sort((a: any, b: any) =>
          formatMflName(a.name || '').localeCompare(formatMflName(b.name || '')),
        )
        .map((p: any) => p.id as string);
      return ids.concat(tail);
    };

    const rankedLists: Partial<Record<MockRankingSource, string[]>> = {};

    // MFL rookie ADP (live, pre-draft cutoff 3)
    try {
      const mflHost = `https://www55.myfantasyleague.com/${leagueYearStr}`;
      const adpUrl = `${mflHost}/export?TYPE=adp&L=${leagueId}&FCOUNT=12&IS_PPR=3&IS_KEEPER=3&IS_MOCK=0&CUTOFF=3&ROOKIES=1&JSON=1`;
      const adpRes = await fetch(adpUrl, { signal: AbortSignal.timeout(5000) });
      if (adpRes.ok) {
        const adpData = await adpRes.json();
        const raw = adpData?.adp?.player;
        const arr: any[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
        const ordered = arr
          .sort(
            (a: any, b: any) =>
              parseFloat(a.averagePick || '999') - parseFloat(b.averagePick || '999'),
          )
          .map((p: any) => p.id as string);
        const deduped = dedupe(ordered);
        if (deduped.length > 0) rankedLists['mfl-rookie'] = topUp(deduped);
      }
    } catch {
      // fall through — absent source just won't be in rankedLists
    }

    // MFL dynasty ADP (local feed, filter to rookies)
    {
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
      const deduped = dedupe(ordered);
      if (deduped.length > 0) rankedLists['mfl-dynasty'] = topUp(deduped);
    }

    // Sleeper (cached)
    {
      const sleeper = loadJsonFile(`data/adp/sleeper-rookies-${leagueYearStr}.json`);
      if (sleeper?.players?.length) {
        const ids = (sleeper.players as any[])
          .map((p) =>
            resolveMflId(rookieNameLookup, p.name, { position: p.position, team: p.team }),
          )
          .filter((id): id is string => !!id);
        const deduped = dedupe(ids);
        if (deduped.length > 0) rankedLists.sleeper = topUp(deduped);
      }
    }

    // KTC (cached, 1QB)
    {
      const ktc = loadJsonFile(`data/adp/ktc-rookies-${leagueYearStr}.json`);
      if (ktc?.players?.length) {
        const ids = (ktc.players as any[])
          .map((p) =>
            resolveMflId(rookieNameLookup, p.name, { position: p.position, team: p.team }),
          )
          .filter((id): id is string => !!id);
        const deduped = dedupe(ids);
        if (deduped.length > 0) rankedLists.ktc = topUp(deduped);
      }
    }

    // My Rank — player IDs pulled from the caller's personal draft queue
    // (localStorage on the client). Sent in the request body so the server
    // has no dependency on user-private client state.
    {
      const raw = body.myRankPlayerIds;
      if (Array.isArray(raw)) {
        const ids = raw
          .filter((v): v is string => typeof v === 'string')
          .filter((id) => rookieIdSet.has(id));
        const deduped = dedupe(ids);
        if (deduped.length > 0) rankedLists['my-rank'] = topUp(deduped);
      }
    }

    // Random (shuffled rookie pool) — always available
    {
      const shuffled = shuffle(rookiePool.map((p: any) => p.id as string));
      rankedLists.random = shuffled;
    }

    // Pick a usable default in priority order so if the caller doesn't
    // specify one, we use the freshest/most-authoritative source that loaded.
    const availableSources = Object.keys(rankedLists) as MockRankingSource[];
    const defaultPriority: MockRankingSource[] = [
      'mfl-rookie',
      'mfl-dynasty',
      'sleeper',
      'ktc',
      'my-rank',
      'random',
    ];
    const fallbackDefault: MockRankingSource =
      defaultPriority.find((s) => rankedLists[s] && rankedLists[s]!.length > 0) ?? 'random';

    // ── Parse caller-specified ranking config ──
    const sanitizeSource = (s: unknown): MockRankingSource | null => {
      if (typeof s !== 'string') return null;
      return RANKING_SOURCE_SET.has(s as MockRankingSource) ? (s as MockRankingSource) : null;
    };

    const requestedDefault = sanitizeSource(body.defaultRankingSource);
    // Only honour the caller's default if we actually built that list.
    const defaultRankingSource: MockRankingSource =
      requestedDefault && rankedLists[requestedDefault] ? requestedDefault : fallbackDefault;

    const rankingAssignments: Record<string, MockRankingSource> = {};
    if (body.rankingAssignments && typeof body.rankingAssignments === 'object') {
      for (const [fid, src] of Object.entries(body.rankingAssignments as Record<string, unknown>)) {
        const sanitized = sanitizeSource(src);
        if (sanitized && rankedLists[sanitized] && franchiseOrder.includes(fid)) {
          rankingAssignments[fid] = sanitized;
        }
      }
    }

    // For backwards compat with the autoPick fallback, also ship a flat list
    // using the default source.
    const rankedPlayerIds: string[] = rankedLists[defaultRankingSource] ?? [];

    console.log(
      `[mock-draft/create] Sources=${availableSources.join(',')} default=${defaultRankingSource} assignments=${Object.keys(rankingAssignments).length}`,
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
      rankingAssignments,
      defaultRankingSource,
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
      body: JSON.stringify({
        session,
        // Legacy single-list field (kept so older party code still works)
        rankedPlayerIds,
        // Tracks which source produced `rankedPlayerIds`
        rankingSource: defaultRankingSource,
        // Phase 2: per-source lists + per-team assignments
        rankedLists,
        rankingAssignments,
        defaultRankingSource,
      }),
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
