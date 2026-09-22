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
import { PLAYOFFS_START_WEEK } from './fantasy-bracket.mjs';
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
 * How long one league's week stays good in process.
 *
 * ── WHY THERE IS A CACHE AT ALL ───────────────────────────────────────────
 * On 2026-09-20 an owner screenshotted `/live` with both leagues reading
 * "Couldn't read this league" while the freshness pill said "Live · updated
 * just now"; the production logs for that minute show every
 * `/api/live-board` answering 200, so the failure was here — the LEAGUE reads
 * inside a healthy board. Nothing in this file was cached, so every board
 * poll, on every device, for every viewer, asked MFL again: at the 25s live
 * cadence that is ~2.4 requests per league per minute per open tab, and MFL
 * answers a client it considers noisy with an HTML page under a 200, which is
 * exactly the shape that becomes `ok: false` below.
 *
 * ── WHAT IT DOES AND DOES NOT FIX ─────────────────────────────────────────
 * It collapses CONCURRENT readers sharing a process — a phone and a laptop on
 * one lambda, a page render and the poll that follows it, the league board and
 * MFL Live open at once. It does NOT collapse readers on different instances,
 * so this is a real reduction rather than a fix, and it is paired with the
 * bracket skip below, which removes half the requests outright.
 *
 * Twenty seconds: under the 25s live poll, so a single viewer's own next poll
 * still reaches MFL and the board never shows a number older than one cycle
 * for want of asking.
 */
const LIVE_PAYLOAD_TTL_MS = 20_000;

/**
 * Keyed by everything that changes the ANSWER, host included.
 *
 * `L` and the host are one composite key and MFL validates neither against the
 * other — a server asked for a league it does not host answers with its own
 * league — so a key that left the host out could serve one league's scores
 * under another's id, which is the exact failure `resolveHost` exists to
 * prevent. It would be a poor trade to reintroduce it for a cache.
 */
const payloadCache = new Map<string, { at: number; payload: LiveScoringPayload }>();

/** Exported for tests only — a module-level cache leaks between them otherwise. */
export function clearLiveScoringPayloadCache(): void {
  payloadCache.clear();
}

/**
 * Why a read failed, named, on one line.
 *
 * The failures this exists for were INVISIBLE: `readCrossLeagueLive` turns
 * every one of them into `ok: false` and the assembler turns that into a panel
 * that says "couldn't read this league", so the only evidence a request ever
 * failed was a screenshot from an owner. That is the same "a request that
 * never reaches the route leaves no entry beside the page render" signature as
 * the 2026-09-09 outage in `docs/claude/rules/live-scoring.md`, and it is why
 * that one took hours to triage.
 *
 * `warn`, not `error`: a single failed league read is survivable by design
 * (the board holds its last confirmed scores), and a level that pages someone
 * for a recoverable blip is a level that gets muted.
 */
function noteFailure(where: string, url: string, reason: string): void {
  console.warn(`[live-scoring] ${where} failed for ${url}: ${reason}`);
}

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

  /**
   * A recent READ of this exact league-week, if one is in this process.
   *
   * Only successes are ever in here (see the write below), so a hit is always
   * a payload we actually read. The copy is shallow and the collections under
   * it are SHARED: every consumer of a snapshot reads it — `buildBoardFromSnapshot`
   * copies before it writes, the broadcast source only indexes — and this
   * keeps that contract explicit rather than handing out the same object
   * reference to be mutated behind everyone's back.
   */
  const cacheKey = `${host}|${leagueId}|${year}|${week}`;
  const hit = payloadCache.get(cacheKey);
  if (hit && Date.now() - hit.at < LIVE_PAYLOAD_TTL_MS) return { ...hit.payload };

  /**
   * The bracket feed is a PLAYOFF-WEEK read, and it used to run every week.
   *
   * `mergePlayoffBrackets` only does anything for a week a bracket covers, so
   * in Week 2 this was a second MFL request per league per poll whose entire
   * contribution was to find no round for the week and return. That doubled
   * our request count against a host that answers a noisy client with an HTML
   * page under a 200 — the failure this file's `ok` flag exists to catch, and
   * the one owners were seeing on the board.
   *
   * Both leagues run the same three-round shape (see `fantasy-bracket.mjs`),
   * so one constant governs it. Asking one week EARLY is deliberate slack: a
   * league that opens its bracket a week sooner than the shared shape still
   * merges correctly, and the cost is one request per league in one week of
   * the year. `tests/live-scoring-read-load.test.ts` pins both halves.
   */
  const wantsBrackets = Number(week) >= PLAYOFFS_START_WEEK - 1;

  const [liveScoreResponse, playoffBracketsResponse] = await Promise.all([
    // DETAILS=1 so each franchise carries its per-player breakdown
    // (players.player[] with id, score, gameSecondsRemaining, status).
    fetchMfl(buildMflExportUrl({ type: 'liveScoring', leagueId, year, params: { W: week, DETAILS: 1 }, host })),
    wantsBrackets
      ? fetchMfl(buildMflExportUrl({ type: 'playoffBrackets', leagueId, year, host }))
      : Promise.resolve(null),
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
  const liveUrl = buildMflExportUrl({
    type: 'liveScoring',
    leagueId,
    year,
    params: { W: week, DETAILS: 1 },
    host,
  });
  if (!liveScoreResponse) {
    // `fetchMfl` already logged the network reason; this names the league, so
    // a board with one dead panel can be told from MFL being down for everyone.
    noteFailure('liveScoring', liveUrl, 'no response');
  } else if (!liveScoreResponse.ok) {
    noteFailure('liveScoring', liveUrl, `HTTP ${liveScoreResponse.status}`);
  } else {
    const body = await liveScoreResponse.json().catch(() => null);
    // MFL also reports some failures as well-formed JSON with an `error` key
    // rather than a status — same conclusion, same reason.
    if (body === null) {
      ok = false;
      // The throttle signature: a 200 carrying an HTML page. Named explicitly
      // because it is the one failure whose fix is "ask MFL less", not "retry".
      noteFailure('liveScoring', liveUrl, 'body did not parse as JSON (HTML under a 200?)');
    } else if (body?.error) {
      ok = false;
      noteFailure('liveScoring', liveUrl, `MFL error: ${String(body.error).slice(0, 120)}`);
    } else {
      snapshot = parseLiveScoringPayload(body);
    }
  }

  await mergePlayoffBrackets(snapshot, playoffBracketsResponse, { leagueId, year, week, host });

  const payload: LiveScoringPayload = { ok, week: Number(week), ...snapshot };

  /**
   * ONLY A SUCCESSFUL READ IS REMEMBERED.
   *
   * Caching a failure would pin the outage in front of every reader sharing
   * this process for the whole TTL, and turn a one-poll blip into twenty
   * seconds of "couldn't read this league" for everybody — the identical
   * mistake `PROJECTION_EMPTY_TTL_MS` and `/api/nfl-game-detail`'s
   * never-memoize-a-partial-read rule are each written to avoid. A failed read
   * must stay cheap to retry.
   */
  if (ok) {
    payloadCache.set(cacheKey, { at: Date.now(), payload });
    /**
     * BOUNDED, because the key is caller-supplied.
     *
     * `/api/live-scoring` accepts any numeric league id, a year across a
     * century and 25 weeks, so the key space is effectively open and a warm
     * lambda would otherwise grow until it OOMs — on a `no-store` route that
     * nothing else caps. An expired entry is ignored by the read but never
     * deleted by it, so time alone frees nothing.
     *
     * Same shape and same bound as `franchiseNamesCache` in
     * `broadcast-live-source.ts`: evict the oldest, one per write. Real usage
     * is a handful of league-weeks, so this never binds in practice — it only
     * has to stop the pathological case.
     */
    if (payloadCache.size > 64) {
      const oldest = [...payloadCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) payloadCache.delete(oldest[0]);
    }
  }

  return payload;
}

/** A failed MFL read is `null`, never a throw — every caller treats it as "not ok". */
async function fetchMfl(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { headers: MFL_HEADERS, signal: AbortSignal.timeout(MFL_TIMEOUT_MS) });
  } catch (err) {
    // The one place that knows WHY — a timeout and a refused connection are
    // the same `null` to every caller, and they mean different things about
    // MFL. Swallowing this is what made the failures unfalsifiable.
    noteFailure('fetch', url, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
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
