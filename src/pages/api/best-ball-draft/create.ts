/**
 * POST /api/best-ball-draft/create
 *
 * Creates (or re-arms) THE official startup draft session for a best-ball
 * league. Reuses the PartyKit mock-draft engine — same Durable Object state
 * machine, same DraftRoom UI — but promoted to a draft of record:
 *
 *   - Commissioner-only (adminFranchiseIds for the league's navSlug).
 *   - Deterministic session id `{navSlug}-official-{year}` so there is
 *     exactly ONE official room per league-year and every page can link to
 *     it without a lobby lookup.
 *   - FULL veteran+rookie player pool (best-ball startup), not rookie-only.
 *   - Human-length pick clocks (30s–5min) instead of mock-speed presets.
 *   - `official: true` stamped on the session so the UI can frame it as the
 *     real thing and the export script can refuse non-official sessions.
 *
 * An existing session in 'lobby' status is safely overwritten (lets the
 * commissioner fix timer/order before start). Once the draft is 'active' /
 * 'paused' / 'completed' the route refuses unless `force: true` — that's
 * the guard against nuking a real draft by double-click.
 *
 * Body: { timerSeconds?: number, randomizeOrder?: boolean, order?: string[], force?: boolean }
 * Returns: { success: true, sessionId: string }
 */

import type { APIRoute } from 'astro';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAuthUser } from '../../../utils/auth';
import { getLeagueYearForSlug } from '../../../utils/league-year';
import { isAdminFranchise } from '../../../config/nav-config';
import { isDraftablePosition } from '../../../utils/build-draft-players';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { getLeagueById, getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../../../config/leagues';
import type { LeagueSlug } from '../../../types/nav';
import type { MockRankingSource } from '../../../types/draft-room';
import bb1Config from '../../../../data/best-ball-1/bb1.config.json';

/** Pick clocks that make sense for a real draft (plus 30s for test runs). */
const OFFICIAL_TIMER_PRESETS = [30, 60, 120, 300];

/** Best-ball startup drafts: every roster spot is filled on draft night. */
const BEST_BALL_TOTAL_ROUNDS = 25;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Snake order: odd rounds forward, even rounds reversed. */
function buildSnakeOrder(franchiseIds: string[], totalRounds: number): string[] {
  const order: string[] = [];
  for (let round = 1; round <= totalRounds; round++) {
    order.push(...(round % 2 === 1 ? franchiseIds : [...franchiseIds].reverse()));
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

  const league = getLeagueById(user.leagueId || '');
  if (!league?.bestBall) {
    return new Response(
      JSON.stringify({ success: false, message: 'Official drafts only exist for best-ball leagues.' }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  if (!user.franchiseId || !isAdminFranchise(user.franchiseId, league.navSlug as LeagueSlug)) {
    return new Response(
      JSON.stringify({ success: false, message: 'Only the commissioner can create the official draft.' }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const timerSeconds = body.timerSeconds ?? 120;
    if (!OFFICIAL_TIMER_PRESETS.includes(timerSeconds)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid timer. Use 30, 60, 120, or 300 seconds.' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const leagueYear = getLeagueYearForSlug(league.slug);
    const leagueYearStr = String(leagueYear);

    // ── Franchise order ──
    // Explicit order wins (commissioner ran a draft-slot lottery elsewhere);
    // otherwise config order, optionally shuffled server-side.
    const configIds: string[] = (bb1Config.teams ?? []).map((t: any) => t.franchiseId as string);
    let franchiseOrder = configIds;
    if (Array.isArray(body.order) && body.order.length > 0) {
      const requested = body.order.filter((v: unknown): v is string => typeof v === 'string');
      const valid =
        requested.length === configIds.length && new Set(requested).size === configIds.length &&
        requested.every((id: string) => configIds.includes(id));
      if (!valid) {
        return new Response(
          JSON.stringify({ success: false, message: 'Order must list every franchise exactly once.' }),
          { status: 400, headers: JSON_HEADERS },
        );
      }
      franchiseOrder = requested;
    } else if (body.randomizeOrder) {
      franchiseOrder = shuffle([...configIds]);
    }

    const picksPerRound = franchiseOrder.length;
    const totalRounds = BEST_BALL_TOTAL_ROUNDS;
    const draftOrder = buildSnakeOrder(franchiseOrder, totalRounds);

    // ── Full draftable player pool ──
    // The MFL player universe is league-agnostic; the committed players feed
    // lives under the default league's data dir (single copy on purpose —
    // best-ball leagues don't duplicate the 229 KB catalog).
    const defaultLeague = getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!;
    const loadJsonFile = (relPath: string): any => {
      try {
        const abs = join(process.cwd(), relPath);
        if (!existsSync(abs)) return null;
        return JSON.parse(readFileSync(abs, 'utf-8'));
      } catch {
        return null;
      }
    };

    const playersData = loadJsonFile(`${defaultLeague.dataPath}/mfl-feeds/${leagueYearStr}/players.json`);
    const rawPlayers = playersData?.players?.player;
    const allPlayers: any[] = rawPlayers ? (Array.isArray(rawPlayers) ? rawPlayers : [rawPlayers]) : [];
    const draftPool = allPlayers.filter((p: any) => isDraftablePosition(p.position || ''));
    if (draftPool.length < picksPerRound * totalRounds) {
      return new Response(
        JSON.stringify({ success: false, message: 'Player pool unavailable — feeds not synced yet.' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }
    const poolIdSet = new Set(draftPool.map((p: any) => p.id));

    // ── Ranked lists for the auto-pick engine ──
    // Best-ball leagues are seasonal REDRAFTS, so the primary board is the
    // full redraft ADP (dynasty ADP overrates youth/longevity here). Dynasty
    // stays available as a fallback source, and random is the always-there
    // last resort. Rookie-mock sources (Sleeper/KTC rookie boards, my-rank)
    // don't apply to a 25-round veteran draft.
    const rankedLists: Partial<Record<MockRankingSource, string[]>> = {};
    const buildAdpList = (feedKey: 'adp-redraft' | 'adp-dynasty'): string[] | null => {
      const feed = loadJsonFile(
        `${defaultLeague.dataPath}/mfl-feeds/${leagueYearStr}/${feedKey}.json`,
      );
      const raw = feed?.adp?.player;
      const arr: any[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const ordered = arr
        .filter((p: any) => poolIdSet.has(p.id))
        .sort((a: any, b: any) => parseFloat(a.averagePick || '999') - parseFloat(b.averagePick || '999'))
        .map((p: any) => p.id as string);
      if (ordered.length === 0) return null;
      // Top up with the rest of the pool so 300 picks never run dry.
      const covered = new Set(ordered);
      const tail = draftPool.filter((p: any) => !covered.has(p.id)).map((p: any) => p.id as string);
      return ordered.concat(tail);
    };
    const redraftList = buildAdpList('adp-redraft');
    if (redraftList) rankedLists['mfl-redraft'] = redraftList;
    const dynastyList = buildAdpList('adp-dynasty');
    if (dynastyList) rankedLists['mfl-dynasty'] = dynastyList;
    rankedLists.random = shuffle(draftPool.map((p: any) => p.id as string));
    const defaultRankingSource: MockRankingSource = rankedLists['mfl-redraft']
      ? 'mfl-redraft'
      : rankedLists['mfl-dynasty']
        ? 'mfl-dynasty'
        : 'random';

    // ── Deterministic official session id ──
    const sessionId = `${league.navSlug}-official-${leagueYearStr}`;

    const rawPartyHost = import.meta.env.PUBLIC_PARTYKIT_HOST;
    if (!rawPartyHost) {
      return new Response(
        JSON.stringify({ success: false, message: 'PartyKit host not configured.' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }
    const partyHost = rawPartyHost.startsWith('http') ? rawPartyHost : `https://${rawPartyHost}`;
    const partyUrl = `${partyHost}/party/mock-${sessionId}`;

    // ── Don't clobber a live/finished draft ──
    try {
      const existingRes = await fetch(partyUrl, { signal: AbortSignal.timeout(5000) });
      if (existingRes.ok) {
        const existing = await existingRes.json();
        const status = existing?.session?.status;
        if (status && status !== 'lobby' && !body.force) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `An official draft already exists (status: ${status}). Pass force to recreate it.`,
            }),
            { status: 409, headers: JSON_HEADERS },
          );
        }
      }
    } catch {
      // Party room unreachable/absent — proceed with creation.
    }

    const totalPicks = totalRounds * picksPerRound;
    const picks = Array.from({ length: totalPicks }, (_, i) => {
      const overallPickNumber = i + 1;
      const round = Math.ceil(overallPickNumber / picksPerRound);
      return {
        overallPickNumber,
        round,
        pickInRound: overallPickNumber - (round - 1) * picksPerRound,
        franchiseId: draftOrder[i],
      };
    });

    const session = {
      id: sessionId,
      leagueId: league.id,
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
      useRealOrder: !body.randomizeOrder,
      rankingAssignments: {},
      defaultRankingSource,
      /** Marks this session as the league's draft of record (not a mock). */
      official: true,
    };

    const partyRes = await fetch(partyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session,
        rankedPlayerIds: rankedLists[defaultRankingSource] ?? [],
        rankingSource: defaultRankingSource,
        rankedLists,
        rankingAssignments: {},
        defaultRankingSource,
      }),
    });
    if (!partyRes.ok) {
      console.error('[best-ball-draft/create] PartyKit init failed:', partyRes.status);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to initialize draft session.' }),
        { status: 502, headers: JSON_HEADERS },
      );
    }

    // Register in the league's session registry (used by admin tooling).
    try {
      await fetch(`${partyHost}/party/${league.id}-registry`, {
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
      console.warn('[best-ball-draft/create] Could not register session in registry');
    }

    return new Response(JSON.stringify({ success: true, sessionId }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error('[best-ball-draft/create] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
