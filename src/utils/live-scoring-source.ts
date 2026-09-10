/**
 * One league's live-scoring payload, read from MFL. SERVER-SIDE ONLY.
 *
 * Why this exists: `/api/live-scoring` used to be the only way to assemble
 * this payload, so the live-scoring PAGE fetched its own public API during
 * SSR — `https://<our domain>/api/live-scoring?...` from inside the render.
 * That put our own edge in the path of the page's first paint, and on
 * 2026-09-09 it started failing: the page rendered with `ok:false` and zero
 * matchups (so not even the offseason sample fallback fired, which requires
 * `ok`), and the board printed "Scores will appear here when games begin"
 * over a live Wednesday-night slate. The self-fetch never reached the route —
 * no `/api/live-scoring` entry appeared in the runtime logs next to the page
 * render — which is the same edge-block signature the removed gameday health
 * check hit with a `host=<hostname>` param on a datacenter IP
 * (docs/claude/rules/live-scoring.md).
 *
 * The fix is structural, not a retry: a server that already knows the league's
 * registry host has no reason to ask itself over the public internet for
 * something it can read directly. The route is now a thin wrapper over this,
 * and the page calls it in-process — same payload, one hop, nothing between
 * the render and MFL.
 *
 * `parseLiveScoringPayload` stays the ONE parse (it is pure and
 * fixture-tested); this module owns only the fetching and the playoff-bracket
 * merge that used to live in the route.
 */

import { ALL_LEAGUES, getLeagueById, getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../config/leagues';
import { buildMflExportUrl } from './mfl-url';
import {
  emptyLiveSnapshot,
  parseLiveScoringPayload,
  type LiveSnapshot,
} from './live-scoring-snapshot';

/** The wire shape `/api/live-scoring` answers with. */
export interface LiveScoringPayload extends LiveSnapshot {
  /**
   * Whether the upstream MFL `liveScoring` request itself succeeded. An
   * offseason feed is a healthy 200 with empty collections (`ok: true`); an
   * upstream outage must not read as "no games" — the page's auto-demo uses
   * this to tell the two apart.
   */
  ok: boolean;
  week: number;
}

export interface LoadLiveScoringOptions {
  /** MFL league id, e.g. '13522'. */
  leagueId: string;
  /** SEASON year — live scoring is results-shaped. */
  year: string | number;
  /** Week number, already validated by the caller. */
  week: string | number;
  /**
   * A host HINT, consulted only when `leagueId` names no league in the
   * registry. Never trusted for a known league — see `resolveHost`.
   */
  hostHint?: string | null;
}

const DEFAULT_HOST = `https://${getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!.mflHost}`;

/**
 * The MFL hosts we are willing to fetch from. A hint is interpolated into a
 * server-side fetch, so an unconstrained value is SSRF.
 */
const ALLOWED_HOSTS = new Set(ALL_LEAGUES.map((l) => l.mflHost.toLowerCase()));

/**
 * `L` and the host are ONE composite key and MFL validates neither against the
 * other: every league lives on a different `www##` server, and a server asked
 * for a league id it does not host answers with its OWN league rather than
 * erroring. The wrong pairing is a 200, well-formed, right schema, wrong
 * league — invisible to `res.ok` and to any shape check.
 *
 * So a `leagueId` in the registry resolves to THAT league's host outright and
 * the hint is not consulted at all. This lives here, not in the route, because
 * the page reads MFL through this module too: `getLeagueContext` applies a
 * global `PUBLIC_MFL_HOST` override to EVERY league, so a page handing its own
 * `league.host` straight to the fetch is exactly how one league's page ends up
 * SSR'ing another league's scores. One implementation, both callers.
 */
export function resolveHost(hint: string | null | undefined, leagueId: string): string {
  const league = getLeagueById(leagueId);
  if (league) return `https://${league.mflHost}`;
  if (hint) {
    try {
      const u = new URL(hint.includes('://') ? hint : `https://${hint}`);
      if (u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
        return `https://${u.hostname}`;
      }
    } catch {
      /* fall through to the default league */
    }
  }
  return DEFAULT_HOST;
}

const MFL_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' };

/**
 * Bounded because this now runs inside a PAGE render, not just an API route:
 * an MFL read that hangs would hang the whole first paint. Generous enough
 * that a merely slow MFL still lands.
 */
const MFL_TIMEOUT_MS = 8000;

/**
 * Fetch + parse one league's `liveScoring` week, merging in playoff-bracket
 * scores and pairings for the weeks a bracket covers.
 *
 * Never throws on an upstream failure: a dead or throttled MFL yields
 * `ok: false` with empty collections, which callers must keep distinct from
 * "the feed is healthy and says nothing" (`ok: true`, empty) — the two look
 * identical in the data and mean opposite things.
 */
export async function loadLiveScoringPayload(
  opts: LoadLiveScoringOptions
): Promise<LiveScoringPayload> {
  const { leagueId } = opts;
  const host = resolveHost(opts.hostHint, leagueId);
  const year = String(opts.year);
  const week = String(opts.week);

  const [liveScoreResponse, playoffBracketsResponse] = await Promise.all([
    // DETAILS=1 so each franchise carries its per-player breakdown
    // (players.player[] with id, score, gameSecondsRemaining, status).
    fetchMfl(buildMflExportUrl({ type: 'liveScoring', leagueId, year, params: { W: week, DETAILS: 1 }, host })),
    fetchMfl(buildMflExportUrl({ type: 'playoffBrackets', leagueId, year, host })),
  ]);

  // `.json()` REJECTS on a non-JSON body, and MFL answers a throttled or
  // errored request with an HTML page under a 200 often enough that this is a
  // real path, not a hypothetical.
  //
  // The status alone therefore cannot decide `ok`. A 200 carrying HTML parses
  // to an EMPTY snapshot, and `ok: true` + no matchups is precisely the
  // offseason shape — so the live-scoring page would swap in last season's
  // sample replay, badge and all, in the middle of an in-season MFL outage.
  // Its own comment promises the opposite ("we must not paper over an
  // in-season outage with last season's sample"), and `res.ok` was quietly
  // not enough to keep that promise. A body we could not read is a FAILED
  // read, not an empty week — the same "no games" / "couldn't read it" merge
  // this whole file exists to prevent.
  let ok = !!liveScoreResponse?.ok;
  let snapshot = emptyLiveSnapshot();
  if (liveScoreResponse?.ok) {
    const body = await liveScoreResponse.json().catch(() => null);
    // MFL also reports some failures as well-formed JSON with an `error` key
    // rather than a status — same conclusion, same reason.
    if (body === null || body?.error) ok = false;
    else snapshot = parseLiveScoringPayload(body);
  }

  await mergePlayoffBrackets(snapshot, playoffBracketsResponse, { leagueId, year, week, host });

  return { ok, week: Number(week), ...snapshot };
}

/** A failed MFL read is `null`, never a throw — every caller treats it as "not ok". */
async function fetchMfl(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { headers: MFL_HEADERS, signal: AbortSignal.timeout(MFL_TIMEOUT_MS) });
  } catch {
    return null;
  }
}

/**
 * Playoff weeks: MFL's `liveScoring` does not group bracket games, so the
 * pairings and final points come from the bracket feed instead. Best-effort —
 * a bracket that will not load leaves the regular-season snapshot untouched.
 */
async function mergePlayoffBrackets(
  snapshot: LiveSnapshot,
  bracketsResponse: Response | null,
  ids: { leagueId: string; year: string; week: string; host: string }
): Promise<void> {
  if (!bracketsResponse?.ok) return;

  const playoffData = await bracketsResponse.json().catch(() => null);
  const bracketIds = playoffData?.playoffBrackets?.playoffBracket;
  if (!bracketIds) return;

  const brackets = Array.isArray(bracketIds) ? bracketIds : [bracketIds];
  const bracketResponses = await Promise.all(
    brackets.map((bracket: any) =>
      fetchMfl(
        buildMflExportUrl({
          type: 'playoffBracket',
          leagueId: ids.leagueId,
          year: ids.year,
          params: { BRACKET_ID: bracket.id },
          host: ids.host,
        })
      )
    )
  );

  for (const response of bracketResponses) {
    if (!response?.ok) continue;

    const bracketData = await response.json().catch(() => null);
    const rounds = bracketData?.playoffBracket?.playoffRound;
    if (!rounds) continue;

    const roundsArray = Array.isArray(rounds) ? rounds : [rounds];
    const weekRound = roundsArray.find((r: any) => r.week === ids.week);
    if (!weekRound) continue;

    const games = weekRound.playoffGame;
    const gamesArray = Array.isArray(games) ? games : [games];

    for (const game of gamesArray) {
      const homeId = game?.home?.franchise_id ? String(game.home.franchise_id) : null;
      const awayId = game?.away?.franchise_id ? String(game.away.franchise_id) : null;

      if (homeId && game.home?.points) {
        snapshot.scores[homeId] = Number(game.home.points) || 0;
        snapshot.remaining[homeId] = 0;
      }
      if (awayId && game.away?.points) {
        snapshot.scores[awayId] = Number(game.away.points) || 0;
        snapshot.remaining[awayId] = 0;
      }
      if (homeId && awayId) {
        snapshot.matchups.push({ home: homeId, away: awayId });
      }
    }
  }
}
