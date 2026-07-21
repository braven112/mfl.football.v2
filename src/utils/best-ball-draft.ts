/**
 * Best-ball official draft helpers.
 *
 * A best-ball league has exactly ONE official draft session per league year,
 * living in the PartyKit mock-draft engine under a deterministic room id —
 * `mock-{navSlug}-official-{year}` — created commissioner-only via
 * /api/best-ball-draft/create. These helpers give the league's pages
 * (draft room, draft board, rosters, home) one shared way to locate and
 * fetch that session server-side.
 */

import type { LeagueDefinition } from '../config/leagues';
import type { MockDraftSession } from '../types/draft-room';
import { getLeagueYearForSlug } from './league-year';

/** Deterministic official-session id for a best-ball league + year. */
export function officialDraftSessionId(league: LeagueDefinition, year?: number): string {
  const leagueYear = year ?? getLeagueYearForSlug(league.slug);
  return `${league.navSlug}-official-${leagueYear}`;
}

/** Normalized PartyKit host (env may be a bare hostname). Null when unset. */
export function partyKitHost(): string | null {
  const raw = import.meta.env.PUBLIC_PARTYKIT_HOST as string | undefined;
  if (!raw) return null;
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

/**
 * Fetch the league's official draft session from PartyKit (server-side).
 * Returns null when the session doesn't exist yet, the PartyKit host isn't
 * configured, or the fetch fails — callers render their "draft not
 * scheduled yet" state in all three cases.
 */
export async function fetchOfficialDraftSession(
  league: LeagueDefinition,
  year?: number,
): Promise<MockDraftSession | null> {
  const host = partyKitHost();
  if (!host) return null;

  const sessionId = officialDraftSessionId(league, year);
  try {
    const res = await fetch(`${host}/party/mock-${sessionId}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const session = data?.session as MockDraftSession | undefined;
    // Only ever surface the draft of record — a mock that somehow landed on
    // this room id must not render as the official draft.
    return session?.official ? session : null;
  } catch {
    return null;
  }
}
