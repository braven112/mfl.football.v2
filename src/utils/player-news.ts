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
  /** Which upstream produced the articles — surfaced for diagnosis. */
  source?: 'athlete-news' | 'athlete-overview';
}

export const ESPN_ATHLETE_NEWS_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/athletes';

/**
 * Second source. The athlete-news endpoint above answers 200 with an EMPTY
 * `articles` array for every athlete tried on a live deploy (Mahomes, Kelce,
 * Budda Baker, Aug 2026) — it is reachable and honest, just empty. The Web API's
 * athlete overview carries its own `news.articles`, so it is tried when the
 * first source yields nothing.
 */
export const ESPN_ATHLETE_OVERVIEW_BASE =
  'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes';

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

/** Build the athlete-overview URL (second news source), or null. */
export function buildAthleteOverviewUrl(espnId: unknown): string | null {
  if (!isValidEspnId(espnId)) return null;
  return `${ESPN_ATHLETE_OVERVIEW_BASE}/${espnId}/overview`;
}

/**
 * Pull the article list out of an athlete-overview payload.
 *
 * The overview's top-level keys are `statistics,news,nextGame,gameLog,rotowire,
 * awards,fantasy` (observed live, Aug 2026), so `news` is definitely there —
 * but ESPN is inconsistent about what sits under it across their surfaces, and
 * this endpoint's schema is undocumented even in the community reference. So
 * accept the shapes it plausibly takes rather than betting on one, and return
 * null (not []) for anything else, keeping "unrecognized" distinct from "empty".
 */
export function extractOverviewArticles(payload: unknown): unknown[] | null {
  const news = (payload as { news?: unknown } | null)?.news;
  if (news === undefined || news === null) return null;

  // `news` is the list itself.
  if (Array.isArray(news)) return news;

  const container = news as Record<string, unknown>;
  for (const key of ['articles', 'items', 'article', 'feed', 'headlines']) {
    if (Array.isArray(container[key])) return container[key] as unknown[];
  }

  return null;
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

/** How many raw entries the envelope claimed, for the drop-rate check below. */
export function countRawArticles(payload: unknown): number {
  const articles = (payload as { articles?: unknown } | null)?.articles;
  return Array.isArray(articles) ? articles.length : 0;
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

  // Read source 1, but do NOT return early on its failure. In production it is
  // the vestigial endpoint — always an empty array — while the overview is the
  // real provider, so letting a 404/5xx here short-circuit would blank the
  // feature behind a Retry that could never succeed.
  let sourceOneFailure: PlayerNewsFailure | null = null;
  let items: PlayerNewsItem[] = [];

  if (!response.ok) {
    sourceOneFailure = 'upstream-status';
  } else {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
      sourceOneFailure = 'upstream-shape';
    }

    if (!sourceOneFailure) {
      // An unrecognized envelope is a READ FAILURE, not "no news". Log the shape
      // so an upstream change is diagnosable from the runtime logs rather than
      // showing up as every player quietly having nothing to report.
      if (!hasArticlesEnvelope(payload)) {
        console.warn(
          `[player-news] unrecognized ESPN payload for ${espnId}; top-level keys: ${describePayloadShape(payload)}`,
        );
        sourceOneFailure = 'upstream-shape';
      } else {
        items = parseEspnAthleteNews(payload, limit);

        // Envelope recognized but every row dropped means the ITEM shape moved
        // (e.g. `headline` renamed). Validating only the container would let
        // that render as a confident, CDN-cached "no news" on every player —
        // the exact failure the empty/error split exists to prevent.
        const raw = countRawArticles(payload);
        if (raw > 0 && items.length === 0) {
          console.warn(
            `[player-news] ${raw} article(s) for ${espnId} but none renderable — item shape changed?`,
          );
          sourceOneFailure = 'upstream-shape';
        }
      }
    }
  }

  if (items.length) {
    return { espnId: String(espnId), status: 'ok', items, fetchedAt, source: 'athlete-news' };
  }

  // Source 1 gave us nothing usable — whether honestly empty or unreadable.
  // Either way the overview is worth asking before telling the owner there is
  // no news: an empty first source is not proof of absence.
  const overview = await fetchOverviewNews(espnId, limit);
  if (overview.items.length) {
    return {
      espnId: String(espnId), status: 'ok', items: overview.items, fetchedAt, source: 'athlete-overview',
    };
  }

  // Only now is a failure terminal. If EITHER source failed to read we say so;
  // 'empty' is reserved for both sources answering cleanly with nothing.
  const failure = sourceOneFailure ?? overview.failure;
  if (failure) return fail(failure);

  return { espnId: String(espnId), status: 'empty', items: [], fetchedAt };
}

/**
 * Second news source: the athlete overview's own `news` list.
 *
 * Reports whether it FAILED or was merely empty, because the caller can no
 * longer assume source 1 succeeded — if both fail we owe the owner an error
 * with a Retry, not a confident "no news".
 */
async function fetchOverviewNews(
  espnId: string,
  limit: number,
): Promise<{ items: PlayerNewsItem[]; failure: PlayerNewsFailure | null }> {
  const url = buildAthleteOverviewUrl(espnId);
  if (!url) return { items: [], failure: 'upstream-shape' };

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { items: [], failure: 'upstream-status' };

    const payload = await res.json();
    const articles = extractOverviewArticles(payload);
    if (articles === null) {
      // Log the INNER shape — the outer keys are already known to include
      // `news`, so the remaining unknown is what sits under it.
      const news = (payload as { news?: unknown } | null)?.news;
      console.warn(
        `[player-news] overview news shape unrecognized for ${espnId}; ` +
        `news is ${Array.isArray(news) ? 'array' : typeof news}, keys: ${describePayloadShape(news)}`,
      );
      return { items: [], failure: 'upstream-shape' };
    }

    const items = parseEspnAthleteNews({ articles }, limit);
    if (articles.length > 0 && items.length === 0) {
      console.warn(
        `[player-news] overview gave ${articles.length} article(s) for ${espnId} but none renderable`,
      );
      return { items: [], failure: 'upstream-shape' };
    }
    return { items, failure: null };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    console.warn(`[player-news] overview fetch failed for ${espnId}:`, error);
    return { items: [], failure: name === 'TimeoutError' ? 'upstream-timeout' : 'upstream-network' };
  }
}
