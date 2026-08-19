/**
 * ESPN athlete-scoped player news — pure parsing split from the network call.
 *
 * The endpoint is ESPN's public (but UNOFFICIAL) athlete news feed:
 *   site.api.espn.com/apis/site/v2/sports/football/nfl/athletes/{id}/news
 *
 * Why athlete-scoped and not `news?team=`: team news is the national wire with a
 * light tint. The one committed sample of it (data/theleague/nfl-news-week15.json,
 * since deleted) carried 87 articles across 29 teams but only 28 distinct
 * headlines — a Madden ratings story appeared under 27 of the 29. Every player on
 * a roster would have shown the same four irrelevant stories, which is why the
 * script that produced it was never wired to anything.
 *
 * Structure mirrors `src/utils/espn-feed.ts`: a pure `parseEspnAthleteNews` that
 * never throws, and a single networked `fetchAthleteNews`. ESPN is unreachable
 * from the dev sandbox (egress policy 403s every espn.com host), so the parser is
 * the only part that can be verified locally — keep it pure and fixture-tested.
 */

/** One normalized article. `link` is null when ESPN's href failed validation. */
export interface PlayerNewsItem {
  id: string;
  headline: string;
  description: string;
  published: string | null;
  type: string;
  link: string | null;
}

export type PlayerNewsStatus = 'ok' | 'empty' | 'error';

/** Why a fetch failed. Surfaced for logging — the UI only branches on status. */
export type PlayerNewsFailure =
  | 'upstream-status'
  | 'upstream-timeout'
  | 'upstream-network'
  | 'upstream-shape';

export interface PlayerNewsResult {
  espnId: string;
  status: PlayerNewsStatus;
  items: PlayerNewsItem[];
  fetchedAt: string;
  reason?: PlayerNewsFailure;
}

export const ESPN_ATHLETE_NEWS_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/athletes';

export const PLAYER_NEWS_DEFAULT_LIMIT = 3;
export const PLAYER_NEWS_MAX_LIMIT = 6;

/** Upstream timeout. Matches the 5s used by src/pages/api/nfl-scoreboard.ts. */
const FETCH_TIMEOUT_MS = 5000;

/**
 * ESPN athlete ids are plain digits (verified: 100% of the 2,260 `espn_id`
 * values in the MFL players feed match /^\d+$/, 4-7 chars).
 *
 * This is a security gate, not a nicety — the id is interpolated into an
 * upstream URL path, so anything but digits (`../../`, a full URL, a newline)
 * must be rejected before it can reshape that path.
 */
export function isValidEspnId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{1,12}$/.test(raw);
}

/** Build the upstream URL, or null if the id is not a plain ESPN athlete id. */
export function buildAthleteNewsUrl(espnId: unknown): string | null {
  if (!isValidEspnId(espnId)) return null;
  return `${ESPN_ATHLETE_NEWS_BASE}/${espnId}/news`;
}

/**
 * Accept only http/https hrefs.
 *
 * A `javascript:` href reaching an anchor is the classic injection here, and the
 * check lives in the parser (not the renderer) so it is a pure, fixture-testable
 * function AND so a bad URL never crosses the wire to the browser at all.
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Coerce an unknown to a trimmed string ('' when absent or not a string). */
function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Valid ISO timestamp or null — an unparseable date must not become NaN later. */
function publishedAt(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/**
 * Does this payload actually look like ESPN's news envelope?
 *
 * This is the difference between "ESPN says there is no news" and "we did not
 * understand ESPN's answer", and those must never be merged: both produce zero
 * articles, so a shape change upstream would otherwise render as a confident
 * "No recent ESPN stories" on every player in the league. That is precisely the
 * failure this module's `empty` / `error` split exists to prevent, and the
 * parser alone could not express it — it returns `[]` either way.
 */
export function hasArticlesEnvelope(payload: unknown): boolean {
  return Array.isArray((payload as { articles?: unknown } | null)?.articles);
}

/** Top-level keys of an unrecognized payload, for diagnosing a shape change. */
export function describePayloadShape(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return typeof payload;
  return Object.keys(payload as Record<string, unknown>).slice(0, 20).join(',') || '(no keys)';
}

/**
 * Normalize ESPN's `{ articles: [...] }` envelope. PURE — never throws, never
 * fetches. Returns newest-first, capped at `limit`.
 *
 * An article with no headline is dropped (there is nothing to render). An
 * article whose link fails validation is KEPT with `link: null` — losing the
 * click is better than losing the story.
 */
export function parseEspnAthleteNews(
  payload: unknown,
  limit: number = PLAYER_NEWS_DEFAULT_LIMIT,
): PlayerNewsItem[] {
  const articles = (payload as { articles?: unknown })?.articles;
  if (!Array.isArray(articles)) return [];

  const cap = clampLimit(limit);
  const items: PlayerNewsItem[] = [];

  for (const raw of articles) {
    if (!raw || typeof raw !== 'object') continue;
    const article = raw as Record<string, unknown>;

    const headline = text(article.headline);
    if (!headline) continue;

    const links = article.links as { web?: { href?: unknown } } | undefined;
    const link = safeExternalUrl(links?.web?.href);

    // ESPN sends `id` as a JSON number, not a string — coercing only strings
    // silently fell through to the href and produced URL-shaped ids.
    const rawId = article.id;
    const id = (typeof rawId === 'number' && Number.isFinite(rawId) ? String(rawId) : text(rawId));

    items.push({
      id: id || link || headline,
      headline,
      description: text(article.description),
      published: publishedAt(article.published),
      type: text(article.type) || 'Story',
      link,
    });
  }

  // Newest first. Undated articles sort last rather than poisoning the compare.
  items.sort((a, b) => {
    if (a.published === b.published) return 0;
    if (!a.published) return 1;
    if (!b.published) return -1;
    return new Date(b.published).getTime() - new Date(a.published).getTime();
  });

  return items.slice(0, cap);
}

/** Clamp a caller-supplied limit into [1, PLAYER_NEWS_MAX_LIMIT]. */
export function clampLimit(raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return PLAYER_NEWS_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), PLAYER_NEWS_MAX_LIMIT);
}

/**
 * Fetch and normalize one athlete's news.
 *
 * Returns a typed result rather than throwing — and deliberately distinguishes
 * `empty` (ESPN answered, no stories) from `error` (we could not read ESPN).
 * Collapsing those two is the mistake the lineup pages made: both yield zero
 * items, and treating "couldn't read" as "nothing there" tells the owner a
 * confident lie during an outage.
 */
export async function fetchAthleteNews(
  espnId: string,
  limit: number = PLAYER_NEWS_DEFAULT_LIMIT,
): Promise<PlayerNewsResult> {
  const fetchedAt = new Date().toISOString();
  const url = buildAthleteNewsUrl(espnId);

  const fail = (reason: PlayerNewsFailure): PlayerNewsResult => ({
    espnId: String(espnId),
    status: 'error',
    items: [],
    fetchedAt,
    reason,
  });

  if (!url) return fail('upstream-shape');

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    // AbortSignal.timeout rejects with TimeoutError; a caller-cancelled request
    // rejects with AbortError. Neither is "ESPN is broken", but only the timeout
    // is ours to report — an AbortError means the caller moved on already.
    const name = (error as { name?: string } | null)?.name;
    return fail(name === 'TimeoutError' ? 'upstream-timeout' : 'upstream-network');
  }

  if (!response.ok) return fail('upstream-status');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fail('upstream-shape');
  }

  // An unrecognized envelope is a READ FAILURE, not "no news". Log the shape so
  // an upstream change is diagnosable from the runtime logs rather than showing
  // up as every player quietly having nothing to report.
  if (!hasArticlesEnvelope(payload)) {
    console.warn(
      `[player-news] unrecognized ESPN payload for ${espnId}; top-level keys: ${describePayloadShape(payload)}`,
    );
    return fail('upstream-shape');
  }

  const items = parseEspnAthleteNews(payload, limit);

  return {
    espnId: String(espnId),
    status: items.length ? 'ok' : 'empty',
    items,
    fetchedAt,
  };
}
