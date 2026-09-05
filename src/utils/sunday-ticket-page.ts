/**
 * Sunday Ticket page helpers — the glue between the session, the account's
 * league list, the slate builder and the URL. Everything here is either pure
 * (testable) or a single network read with a timeout.
 *
 * The pure selection helpers live in `sunday-ticket-selection.ts` and the
 * kickoff formatter in the slate module — the board components import those,
 * never this file, so the story graph stays free of fs and network.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES, getLeagueById, type LeagueDefinition } from '../config/leagues';
import type { BoardLeague } from './sunday-ticket-selection';

import type { MyLeague } from './my-leagues';
import type { BroadcastLookup } from './sunday-ticket-slate';
import { canonicalNflCode, parseBroadcast } from './espn-game-detail';
import { buildEspnScoreboardUrl, espnSeasonSlot } from './espn-scoreboard-url';

// Re-exported so the page (and tests) have one import for the helpers that
// live in the pure modules; the board components import those directly.
export type { BoardLeague } from './sunday-ticket-selection';
export {
  LEAGUE_SELECTION_COOKIE,
  LEAGUE_SELECTION_MAX_AGE,
  leagueSelectionHref,
  parseLeagueSelection,
  toggleLeagueSelection,
} from './sunday-ticket-selection';
export { formatKickoff } from './sunday-ticket-slate';

// ── Which leagues are on the board ───────────────────────────────────────

export interface SessionLeague {
  league: LeagueDefinition;
  franchiseId: string;
  franchiseName: string;
}

/**
 * The board's leagues: the session's first, then every other league the
 * account belongs to (`myleagues`), registered ones before outside ones. A
 * league is on the board once even when both sources name it; the session's
 * franchise wins for its own league because the JWT is the identity we
 * actually verified.
 */
export function resolveBoardLeagues(session: SessionLeague | null, myLeagues: readonly MyLeague[]): BoardLeague[] {
  const out: BoardLeague[] = [];
  const seen = new Set<string>();

  if (session) {
    out.push({
      id: session.league.id,
      name: session.league.name,
      franchiseId: session.franchiseId,
      franchiseName: session.franchiseName,
      registered: session.league,
      host: null,
      isSession: true,
    });
    seen.add(session.league.id);
  }

  const rest: BoardLeague[] = [];
  for (const l of myLeagues) {
    if (!l.id || seen.has(l.id) || !l.franchiseId) continue;
    seen.add(l.id);
    const registered = getLeagueById(l.id);
    rest.push({
      id: l.id,
      name: registered?.name ?? l.name ?? `League ${l.id}`,
      franchiseId: l.franchiseId,
      franchiseName: l.franchiseName,
      registered,
      host: registered ? null : l.host,
      isSession: false,
    });
  }
  // Registered leagues in registry order, then outside leagues in MFL's order
  // — stable, so the chips do not reshuffle between visits.
  const rank = (l: BoardLeague) => (l.registered ? ALL_LEAGUES.indexOf(l.registered) : ALL_LEAGUES.length);
  rest.sort((a, b) => rank(a) - rank(b));
  return [...out, ...rest];
}

/** A franchise's display name from its league config, or '' when the config has no such team. */
export function franchiseNameFromConfig(league: LeagueDefinition, franchiseId: string): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), league.configPath), 'utf8');
    const teams: any[] = JSON.parse(raw)?.teams ?? [];
    // Both league configs key teams by `franchiseId` (a 4-digit string), not `id`.
    return `${teams.find((t) => t?.franchiseId === franchiseId)?.name ?? ''}`;
  } catch {
    return '';
  }
}

// ── ESPN broadcasts for the week ─────────────────────────────────────────

/**
 * The network per game for a week, from ESPN's scoreboard — the same payload
 * `/api/nfl-scoreboard` proxies for the live board, read here server-side so
 * the page needs no island. Enrichment only: a failure (timeout, 5xx, a
 * malformed body) yields an empty list and the boxes simply show no network.
 */
export async function fetchEspnBroadcasts(week: number, year: number, timeoutMs = 5000): Promise<BroadcastLookup[]> {
  try {
    const res = await fetch(buildEspnScoreboardUrl(espnSeasonSlot(week), year), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const data = await res.json();
    const events: any[] = Array.isArray(data?.events) ? data.events : [];
    const out: BroadcastLookup[] = [];
    for (const event of events) {
      const comp = event?.competitions?.[0] ?? {};
      const competitors: any[] = Array.isArray(comp.competitors) ? comp.competitors : [];
      const home = competitors.find((c) => c?.homeAway === 'home');
      const away = competitors.find((c) => c?.homeAway === 'away');
      const broadcast = parseBroadcast(comp);
      if (!home || !away || !broadcast) continue;
      out.push({
        away: canonicalNflCode(away?.team?.abbreviation ?? ''),
        home: canonicalNflCode(home?.team?.abbreviation ?? ''),
        broadcast,
      });
    }
    return out;
  } catch {
    return [];
  }
}
