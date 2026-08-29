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

/**
 * Drop trailing slashes from a host so `${host}/${year}` never doubles up.
 *
 * Deliberately not `host.replace(/\/+$/, '')`: an anchored `+` quantifier over
 * a repeatable character is the shape static analysis reads as polynomial
 * backtracking, and there is no reason to hand it a regex for this. Same
 * output, linear, no engine involved.
 */
function trimTrailingSlashes(host: string): string {
  let end = host.length;
  while (end > 0 && host[end - 1] === '/') end -= 1;
  return host.slice(0, end);
}

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

  const trimmedHost = trimTrailingSlashes(host);
  return `${trimmedHost}/${year}/export?${query.toString()}`;
}

export interface BuildMflLiveDraftUrlOptions {
  /** League id, e.g. '19621'. Read it from the registry — never inline. */
  leagueId: string | number;
  /** Season/league year, interpolated into the URL path. */
  year: string | number;
  /**
   * Full host including protocol, e.g. 'https://www44.myfantasyleague.com'.
   * REQUIRED — unlike the export API, the live-draft applet is only served by
   * the league's own MFL host; `api.myfantasyleague.com` does not serve it.
   * Trailing slashes are stripped.
   */
  host: string;
}

/**
 * Build the MFL live draft room URL:
 * `${host}/${year}/ajax_ld?L=${leagueId}`.
 *
 * This is the actual room owners pick from on draft day — distinct from our
 * own draft-order page (a projection, useful before the draft) and our
 * draft-broadcast board (a read-only TV view of picks as they land). Neither
 * of those lets an owner make a pick, so on draft day the room is the link
 * that matters.
 */
export function buildMflLiveDraftUrl({ leagueId, year, host }: BuildMflLiveDraftUrlOptions): string {
  const trimmedHost = trimTrailingSlashes(host);
  return `${trimmedHost}/${year}/ajax_ld?L=${encodeURIComponent(String(leagueId))}`;
}

export interface BuildMflOptionUrlOptions {
  /** League id, e.g. '19621'. Read it from the registry — never inline. */
  leagueId: string | number;
  /** Season/league year, interpolated into the URL path. */
  year: string | number;
  /**
   * MFL option number (the `O=` param), e.g. 52 for the email draft page.
   * MFL identifies these pages only by number — there are no named routes.
   */
  option: string | number;
  /**
   * Full host including protocol, e.g. 'https://www44.myfantasyleague.com'.
   * REQUIRED — option pages are league-site pages, not API endpoints, so
   * `api.myfantasyleague.com` does not serve them. Trailing slashes stripped.
   */
  host: string;
}

/**
 * Build an MFL league option-page URL:
 * `${host}/${year}/options?L=${leagueId}&O=${option}`.
 *
 * These are MFL's own owner-facing pages (email draft, waiver requests, …),
 * addressed by option NUMBER. Give every call site a named constant for the
 * number so the meaning survives — `O=52` reads as nothing on its own.
 */
export function buildMflOptionUrl({
  leagueId,
  year,
  option,
  host,
}: BuildMflOptionUrlOptions): string {
  const trimmedHost = trimTrailingSlashes(host);
  return `${trimmedHost}/${year}/options?L=${encodeURIComponent(String(leagueId))}&O=${encodeURIComponent(String(option))}`;
}
