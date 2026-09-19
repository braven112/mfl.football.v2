/**
 * One league's weekly projections, for every live-scoring surface.
 *
 * SERVER-SIDE ONLY.
 *
 * ── WHY THIS EXISTS: THE FEED'S WEEK IS NOT OUR WEEK ──────────────────────
 * `scripts/fetch-mfl-feeds.mjs` syncs `projectedScores` with `W` OMITTED, and
 * MFL answers a `W`-less request using ITS OWN notion of the current week —
 * which rolls to the UPCOMING week the moment the current week's games are
 * under way. Verified against TheLeague on 2026-09-13:
 *
 *     W omitted  -> {"week":"2", 533 rows}
 *     W=1        -> {"week":"1", 509 rows}
 *
 * So the committed feed routinely carries next week's numbers during a slate.
 * Anything that reads it and does not check the week is not "slightly stale",
 * it is confidently wrong: every projected final and every win-probability bar
 * computed from the wrong week's projections, with no visible tell.
 *
 * That is exactly what the live-scoring board's previous `loadProjections`
 * (`live-scoring-data.ts`) did — it took every `playerScore` row with no week
 * check at all. It is a DIFFERENT and worse symptom than the P0 that hit the
 * broadcast board on the same Sunday: there, `projectionsForWeek` refused the
 * mismatch and the board went flat to zero, which at least looked broken.
 * See `docs/claude/followups/2026-09-13-broadcast-projections-week.md`.
 *
 * `projectionsForWeek`'s week-mismatch refusal IS the guard. Never relax it:
 * ranking this Sunday by another week's numbers is worse than going flat.
 *
 * ── TWO YEARS, TWO CLOCKS, AND THEY ARE NOT INTERCHANGEABLE ───────────────
 * The COMMITTED feed lives in `data/<league>/mfl-feeds/<LEAGUE year>/`, which
 * rolls Feb 14 (June 1 for the AFL). The LIVE read is results-shaped and takes
 * the SEASON year, which rolls at Labor Day. Between those two dates the two
 * disagree, so reading the disk feed on the season year misses the directory
 * outright — which is the second, quieter half of the same bug.
 */

import type { CanonicalLeagueSlug } from '../../config/leagues';
import { getLeagueBySlug } from '../../config/leagues';
import { getCurrentSeasonYear, getLeagueYearForSlug } from '../league-year';
import { projectionsForWeek, readLeagueFeed } from '../sunday-ticket-sources';
import { buildMflExportUrl } from '../mfl-url';
import { resolveHost } from '../live-scoring-source';

/**
 * A projection is a number for the WHOLE WEEK — it does not tick — so a long
 * TTL costs nothing and a short one is pure upstream load.
 */
const PROJECTION_TTL_MS = 10 * 60 * 1000;

/**
 * An EMPTY answer is cached too, but briefly.
 *
 * Both extremes are wrong. Never caching an empty means re-asking MFL on every
 * poll of every board for something it just said it has none of, which is how
 * a board gets itself throttled — and a throttled MFL answers with an HTML
 * page under a 200, so the failure is silent. Caching it for the full TTL
 * means a feed that appears mid-afternoon (the sync lands, the week turns)
 * cannot be picked up for ten minutes.
 */
const PROJECTION_EMPTY_TTL_MS = 60 * 1000;

const cache = new Map<string, { at: number; map: Map<string, number> }>();

/** Test seam. */
export function __clearProjectionCache(): void {
  cache.clear();
}

/**
 * Same posture as `loadLiveScoringPayload`: this runs inside a PAGE render,
 * not only an API route, so an MFL read that hangs would hang the first paint.
 */
const MFL_TIMEOUT_MS = 6000;
const MFL_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' };

/**
 * `Map<mflPlayerId, projectedPoints>` for ONE league and ONE week.
 *
 * Committed feed first (free, no network) but only when its week matches;
 * otherwise a week-NUMBERED live read. Never throws — a missing projection
 * degrades the win-probability model to live-only, which is honest. An empty
 * map means "we have no forward numbers", never "this week has none": MFL
 * publishes projections for every week of the season.
 *
 * A projection belongs to a player IN A LEAGUE, never to a player — the same
 * back is worth different points under two rule sets — so this is keyed per
 * league and callers must never pool the maps.
 */
export async function loadLeagueWeekProjections(
  slug: CanonicalLeagueSlug,
  week: number,
  seasonYear: number = getCurrentSeasonYear(),
): Promise<Map<string, number>> {
  const league = getLeagueBySlug(slug);
  if (!league || !Number.isFinite(week) || week <= 0) return new Map();

  // The disk feed is keyed by the LEAGUE year. Using the season year here is
  // the quiet half of this bug — see the header.
  const committed = projectionsForWeek(
    readLeagueFeed(league, getLeagueYearForSlug(slug), 'projectedScores.json'),
    week,
  );
  if (committed.size > 0) return committed;

  // Empty means the committed copy is for a DIFFERENT week, or the sync has
  // not written one yet. Ask MFL for the week BY NUMBER.
  const key = `${league.id}:${seasonYear}:w${week}`;
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.map.size > 0 ? PROJECTION_TTL_MS : PROJECTION_EMPTY_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.map;
  }

  let map = new Map<string, number>();
  try {
    const url = buildMflExportUrl({
      type: 'projectedScores',
      leagueId: league.id,
      year: seasonYear,
      params: { W: week },
      // Registry-resolved. Never a caller-supplied hostname: a `host=` param
      // on a public URL from a datacenter IP reads as SSRF to a WAF and gets
      // 403'd at the edge with nothing in our logs.
      host: resolveHost(null, league.id),
    });
    const response = await fetch(url, {
      headers: MFL_HEADERS,
      signal: AbortSignal.timeout(MFL_TIMEOUT_MS),
    });
    // `res.ok` is not "the data is good" — MFL answers a throttled request
    // with an HTML page under a 200, which parses to nothing. Both the
    // unreadable body and the non-200 land on an empty map, and the short
    // negative TTL is what lets it recover.
    if (response.ok) {
      map = projectionsForWeek(await response.json().catch(() => null), week);
    }
  } catch {
    // Network error / timeout — no forward numbers this poll.
  }

  cache.set(key, { at: Date.now(), map });
  return map;
}
