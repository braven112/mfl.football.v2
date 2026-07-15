/**
 * Shared MFL export URL builder
 *
 * Extracted from ~12 hand-built `https://api.myfantasyleague.com/${year}/export?TYPE=...`
 * strings scattered across src/pages/api and src/utils. All of them shape the
 * same URL: `${host}/${year}/export?TYPE=${type}&L=${leagueId}&JSON=1${...extra params}`.
 * A few callers (live-scoring, draft/status, playoffs) resolve a league-specific
 * host instead of the default `api.myfantasyleague.com` — pass `host` to cover
 * that case.
 *
 * This is a pure string assembler: it does not fetch, validate, or default
 * anything beyond what's given. Callers keep their own host-allowlisting /
 * SSRF guards (see live-scoring.ts's `resolveHost`) — this helper only builds
 * the final URL string.
 */

const DEFAULT_HOST = 'https://api.myfantasyleague.com';

export interface BuildMflExportUrlOptions {
  /** MFL export TYPE, e.g. 'rosters', 'salaries', 'pendingTrades'. */
  type: string;
  /** League id, e.g. '13522'. */
  leagueId: string | number;
  /** Season/league year, interpolated into the URL path. */
  year: string | number;
  /** Extra query params beyond TYPE/L/JSON, e.g. { FRANCHISE, W, DETAILS }. */
  params?: Record<string, string | number | boolean | undefined>;
  /**
   * Full host including protocol, e.g. 'https://www49.myfantasyleague.com'.
   * Defaults to 'https://api.myfantasyleague.com'. Trailing slashes are
   * stripped.
   */
  host?: string;
}

/** Build an MFL export URL: `${host}/${year}/export?TYPE=...&L=...&JSON=1&...params`. */
export function buildMflExportUrl({
  type,
  leagueId,
  year,
  params = {},
  host = DEFAULT_HOST,
}: BuildMflExportUrlOptions): string {
  const query = new URLSearchParams();
  query.set('TYPE', type);
  query.set('L', String(leagueId));
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    query.set(key, String(value));
  }
  query.set('JSON', '1');

  const trimmedHost = host.replace(/\/+$/, '');
  return `${trimmedHost}/${year}/export?${query.toString()}`;
}
