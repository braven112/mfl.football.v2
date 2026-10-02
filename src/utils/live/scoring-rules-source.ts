/**
 * Server-side read of a league's MFL scoring rules, for the live stat sheet.
 *
 * ANY league, not only the registry's: the board is shared by TheLeague, the
 * AFL, Best Ball and every league an owner switches on in MFL Live. A league
 * we run is read from its registry host; anything else goes through
 * `api.myfantasyleague.com`, which redirects to the league's own host. The
 * host is never taken from the request — only a numeric league id is — so
 * there is no URL here a caller can steer.
 *
 * Rules change a handful of times a season, so a SUCCESSFUL read (including
 * "this league publishes no rules") is held for hours. A failed read is never
 * cached, for the reason every never-cache-a-failure rule in live scoring
 * exists: it would pin an outage in front of every reader sharing the process.
 */
import { getLeagueById } from '../../config/leagues';
import { buildMflExportUrl } from '../mfl-url';
import { parseScoringRules, type LiveScoringRulesResponse } from './scoring-rules';

const MFL_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' };
const MFL_TIMEOUT_MS = 8_000;
export const RULES_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 256;

const cache = new Map<string, { at: number; payload: LiveScoringRulesResponse }>();

/** For tests. */
export function clearScoringRulesCache(): void {
  cache.clear();
}

/** MFL league ids are short digit strings. Anything else is refused. */
export function isValidLeagueId(raw: string): boolean {
  return /^\d{1,7}$/.test(raw);
}

export async function loadLeagueScoringRules(
  leagueId: string,
  year: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveScoringRulesResponse> {
  const failed: LiveScoringRulesResponse = { ok: false, leagueId, year, rules: null };
  if (!isValidLeagueId(leagueId) || !/^\d{4}$/.test(year)) return failed;

  const key = `${leagueId}:${year}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < RULES_TTL_MS) return hit.payload;

  const league = getLeagueById(leagueId);
  const url = buildMflExportUrl({
    type: 'rules',
    leagueId,
    year,
    ...(league ? { host: `https://${league.mflHost}` } : {}),
  });

  let body: any = null;
  try {
    const res = await fetchImpl(url, {
      headers: MFL_HEADERS,
      signal: AbortSignal.timeout(MFL_TIMEOUT_MS),
    });
    if (!res.ok) return failed;
    // MFL answers a throttled request with HTML under a 200 — unreadable is a
    // failed read, not "no rules".
    body = await res.json().catch(() => null);
  } catch {
    return failed;
  }
  if (!body || typeof body !== 'object') return failed;

  const rules = parseScoringRules(body);
  const errorText = String(body?.error?.$t ?? body?.error ?? '');
  // "No League Scoring Rules" is an ANSWER — the league runs without
  // published rules — and is cached like one. Any other error is a failure.
  if (!rules && !/no league scoring rules/i.test(errorText)) return failed;

  const payload: LiveScoringRulesResponse = { ok: true, leagueId, year, rules };
  cache.set(key, { at: Date.now(), payload });
  if (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return payload;
}
