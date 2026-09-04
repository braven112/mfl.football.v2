/**
 * /api/draft/status — Live draft board polling endpoint.
 *
 * Proxies MFL's public `draftResults` export and returns picks in the same
 * shape `draft-room.astro` builds at SSR time so the client can swap the
 * picks array in‑place. No auth required (draftResults is public).
 *
 * The DraftRoom client polls this every 12s when picks are recent and 30s
 * otherwise (see DraftRoom.tsx). For an email draft 30s of latency is fine.
 * The AFL broadcast board polls faster (see DraftBroadcast.tsx) — a live
 * in-person draft can't wait 30s for the room to learn who was picked.
 *
 * DRAFT UNITS: `draftResults.draftUnit` is an OBJECT in a single-draft league
 * (TheLeague, best-ball) but an ARRAY in a league that drafts by conference
 * (the AFL runs CONFERENCE00 + CONFERENCE01 as two independent 108-pick
 * boards). Reading `.draftPick` straight off the raw value therefore returned
 * `undefined` for the AFL — and because that fell through to `picks: []` with
 * a 200, the board looked empty rather than broken. `selectDraftUnit`
 * normalizes both shapes; `?unit=` chooses among them.
 */

import type { APIRoute } from 'astro';
import { parseTradeFromComment, selectDraftUnit } from '../../../utils/draft-utils';
import type { DraftRoomPick, DraftStatusResponse } from '../../../types/draft-room';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { buildMflExportUrl } from '../../../utils/mfl-url';
import { getLeagueById, getLeagueBySlug } from '../../../config/leagues';
import { resolveMflHost, resolveMflLeagueId, toSafeMflUrl } from '../../../utils/draft-broadcast-source';

export const prerender = false;

const DEFAULT_HOST = getLeagueBySlug('theleague')!.mflHost;
const DEFAULT_LEAGUE_ID = getLeagueBySlug('theleague')!.id;

interface RawDraftPick {
  player?: string;
  pick?: string;
  franchise?: string;
  timestamp?: string;
  comments?: string;
  round?: string;
}


function buildPicks(rawPicks: RawDraftPick | RawDraftPick[] | undefined): DraftRoomPick[] {
  if (!rawPicks) return [];
  const arr = Array.isArray(rawPicks) ? rawPicks : [rawPicks];

  // Sort by (round, pickInRound) then assign sequential overallPickNumber.
  // Rounds may have variable counts (R1=17, R2=18, R3=16) so a fixed stride
  // would mis-number picks — match draft-room.astro's logic exactly.
  const sorted = [...arr].sort((a, b) => {
    const rDiff = parseInt(a.round || '1') - parseInt(b.round || '1');
    return rDiff !== 0 ? rDiff : parseInt(a.pick || '1') - parseInt(b.pick || '1');
  });

  return sorted.map((p, idx) => {
    const tradedFrom = parseTradeFromComment(p.comments || '');
    return {
      round: parseInt(p.round || '1'),
      pickInRound: parseInt(p.pick || '1'),
      overallPickNumber: idx + 1,
      franchiseId: p.franchise || '',
      playerId: p.player || '',
      timestamp: p.timestamp || '',
      comments: p.comments || '',
      isTraded: !!tradedFrom,
      originalTeamName: tradedFrom,
    };
  });
}


/**
 * How many times to ask MFL for the same board, in parallel, keeping the
 * freshest answer.
 *
 * MFL serves `draftResults` from backends whose caches disagree, and the spread
 * is far worse than "occasionally stale". Measured against the live 2026 AFL
 * rehearsal, 48 requests for one conference returned NINE distinct boards — 0,
 * 1, 2, 3, 4, 6, 8, 9 and 13 picks — and the CURRENT one came back twice. MFL
 * had the fresh data (its newest pick was 103 seconds old); it just handed it
 * over about 4% of the time.
 *
 * A single request per poll therefore leaves the board minutes behind a live
 * room, which is exactly how it was reported: "it was doing good till 10 now
 * it's stuck and behind the draft". Cache-bypass headers do not help — plain
 * and `Cache-Control: no-cache` returned the same spread — because this is
 * many backends, not one edge cache.
 *
 * Measured again with the draft PAUSED, so the truth was static at 24 picks,
 * 77 requests returned: 17 picks 70% of the time, 18 picks 18%, 19 picks 3%,
 * and the CURRENT board 8%. Seven picks behind is the single most likely answer
 * MFL will give you.
 *
 * Ten parallel requests take the freshest of ten draws — about a 57% chance of
 * the current board on any one poll, against 8% for a single request. They run
 * concurrently, so a poll still costs one round trip.
 *
 * Sampling alone is not enough at those odds, which is what FRESHEST_TTL_MS is
 * for: the freshest board is REMEMBERED between requests, so misses cost
 * nothing and every client gets the best answer the server has seen.
 */
const MFL_SAMPLES = 10;

/**
 * How long the server keeps the freshest board it has seen, per league+unit.
 *
 * Sampling is a per-request lottery; this makes the wins stick. With clients
 * polling every few seconds, the cache converges on the true board within a
 * poll or two and then serves it to everyone INSTANTLY, including a client that
 * just loaded.
 *
 * Bounded so it can heal. A commissioner reverting the draft makes the
 * remembered board wrong, and 60s is long enough to smooth MFL's flapping while
 * short enough that a revert clears on its own. The board's own recency rule
 * (see `acceptedRef` in DraftBroadcast.tsx) is the second line of defence.
 */
const FRESHEST_TTL_MS = 60_000;

/**
 * Freshest board per league+unit, remembered across requests.
 *
 * Module scope, so it lives as long as the serverless instance does. A cold
 * instance simply starts empty and refills on its first request — the cache is
 * an accelerator, never a source of truth.
 */
const freshestSeen = new Map<string, { data: any; freshness: BoardFreshness; at: number }>();

/** Newest pick stamp for `unit` in a payload, or -1 if it has no board. */
function unitFreshness(raw: any, unit: string | null): BoardFreshness | null {
  const selected = selectDraftUnit<RawDraftPick>(raw?.draftResults?.draftUnit, unit);
  if (!selected) return null;
  const picks = selected.draftPick;
  return picksFreshness(Array.isArray(picks) ? picks : picks ? [picks] : []);
}

/** Ask MFL MFL_SAMPLES times at once; return the freshest board for `unit`. */
async function fetchFreshest(
  mflUrl: string,
  unit: string | null,
  cacheKey: string,
  samples: number = MFL_SAMPLES
): Promise<{ data: any | null; status?: number }> {
  let lastStatus: number | undefined;

  const once = async (): Promise<any | null> => {
    try {
      const res = await fetch(mflUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        lastStatus = res.status;
        return null;
      }
      return await res.json();
    } catch {
      return null;
    }
  };

  const results = await Promise.all(Array.from({ length: Math.max(1, samples) }, once));

  let best: any | null = null;
  let bestFreshness: BoardFreshness | null = null;
  for (const candidate of results) {
    if (!candidate) continue;
    const freshness = unitFreshness(candidate, unit);
    if (!freshness) continue;
    if (!bestFreshness || atLeastAsFresh(freshness, bestFreshness)) {
      best = candidate;
      bestFreshness = freshness;
    }
  }

  // Fold in what earlier requests already won — see FRESHEST_TTL_MS. This is
  // what turns a 57%-per-poll lottery into a board that is right continuously.
  const key = `${cacheKey}|${unit ?? ''}`;
  const now = Date.now();
  const remembered = freshestSeen.get(key);
  if (
    remembered &&
    now - remembered.at < FRESHEST_TTL_MS &&
    (!bestFreshness || atLeastAsFresh(remembered.freshness, bestFreshness))
  ) {
    best = remembered.data;
    bestFreshness = remembered.freshness;
  } else if (best && bestFreshness) {
    freshestSeen.set(key, { data: best, freshness: bestFreshness, at: now });
  }

  return { data: best, status: lastStatus };
}


/**
 * MFL's STATIC draft-results file — the same one its own draft room reads.
 *
 * This is the fix for a problem sampling could not solve. The JSON export is
 * served from backends whose caches disagree so badly that, measured with the
 * draft PAUSED (truth static at 24 picks), 77 requests returned the CURRENT
 * board 8% of the time and a seven-pick-stale board 70% of the time. Ten
 * parallel samples still leaves the room watching a board five picks behind.
 *
 * The static file has none of that. Ten consecutive fetches during a live draft
 * returned byte-identical, CURRENT results — 31 picks, matching the room's
 * 3.08 on the clock exactly — where the JSON export was stuck at 26.
 *
 * MFL advertises the URL itself, in `static_url` on each draft unit, so it is
 * never constructed by hand: the JSON response names the file, including the
 * `www##` host that actually serves it (the `api.` host only redirects). The
 * URL is remembered per league+unit so later polls fetch both at once.
 *
 * The JSON export stays as the fallback. It is the documented API; this file is
 * an implementation detail of MFL's own UI, and if it ever moves the board
 * degrades to the old behaviour rather than to nothing.
 */
const staticUrlSeen = new Map<string, string>();

/**
 * Decode the XML entities an attribute value can carry.
 *
 * `res.json()` did this for free on the export path, so nothing downstream ever
 * had to think about it. The static file is raw XML: a franchise called
 * `Da Bear's & Co.` arrives as `Da Bear&#39;s &amp; Co.`, and that string is
 * read by `parseTradeFromComment` and rendered on a 65" screen.
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|quot|apos|amp));/gi, (whole, dec, hex, named) => {
      if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      switch ((named as string).toLowerCase()) {
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        case 'amp': return '&';
        default: return whole;
      }
    });
}

/** `<draftPick ... />` attributes, in whatever order MFL emitted them. */
function parseStaticXml(xml: string): RawDraftPick[] | null {
  if (!xml.includes('<draftResults')) return null;
  const out: RawDraftPick[] = [];
  for (const tag of xml.match(/<draftPick\b[^>]*\/?>/g) ?? []) {
    const attr = (name: string) => {
      const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
      // `&amp;` must be decoded LAST or an encoded entity decodes twice.
      return m ? decodeXmlEntities(m[1]) : '';
    };
    out.push({
      round: attr('round'),
      pick: attr('pick'),
      franchise: attr('franchise'),
      player: attr('player'),
      timestamp: attr('timestamp'),
      comments: attr('comments'),
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * How recent a parsed board is: newest pick stamp, then how many picks.
 *
 * A TUPLE, never one number standing in for both. Collapsing them —
 * "timestamp if any pick has one, else the count" — makes two boards
 * incomparable the moment one of them is unstamped: an epoch second always
 * dwarfs a pick count, so an unstamped static board could never win and the
 * headline fix would silently never engage, while an unstamped JSON board would
 * lose to a far staler stamped one. Same shape as the client's `boardAge`.
 */
interface BoardFreshness {
  newestPick: number;
  filled: number;
}

function picksFreshness(picks: RawDraftPick[]): BoardFreshness {
  let newestPick = 0;
  let filled = 0;
  for (const p of picks) {
    if (!p.player) continue;
    filled += 1;
    const ts = Number.parseInt(p.timestamp ?? '', 10);
    if (Number.isFinite(ts) && ts > newestPick) newestPick = ts;
  }
  return { newestPick, filled };
}

/** Is `a` at least as recent as `b`? Stamp first, count only breaks ties. */
function atLeastAsFresh(a: BoardFreshness, b: BoardFreshness): boolean {
  if (a.newestPick !== b.newestPick) return a.newestPick > b.newestPick;
  return a.filled >= b.filled;
}

/** Fetch and parse the static file. Null on any failure — it is an optimisation. */
async function fetchStaticBoard(staticUrl: string): Promise<RawDraftPick[] | null> {
  // Rebuilt here rather than trusting the caller: this is the function that
  // actually reaches the network with a URL derived from a response body.
  const safeUrl = toSafeMflUrl(staticUrl);
  if (!safeUrl) return null;
  try {
    const res = await fetch(safeUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return parseStaticXml(await res.text());
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ url }) => {
  const year = url.searchParams.get('year') || String(getCurrentLeagueYear());

  // `league` and `host` are both interpolated into a URL this server then
  // FETCHES, and both arrive from a public page's query string — the broadcast
  // board's `?mflLeague=` override is one legitimate caller (see
  // draft-broadcast-source.ts) and anyone with a browser is another. A host
  // that is not MFL's is server-side request forgery with a URL bar for an
  // interface, so an unrecognised value falls back to the default rather than
  // erroring: every real caller passes a valid one, and a 400 here would only
  // tell a prober it had found the right parameter.
  const leagueId =
    resolveMflLeagueId(url.searchParams.get('league') || url.searchParams.get('L')) ||
    DEFAULT_LEAGUE_ID;
  // `league` and the host are ONE composite key, and MFL validates neither
  // against the other: a `www##` server asked for a league id it does not
  // host answers with its OWN league instead of erroring. So for a league in
  // our registry the registry host wins outright and `host` is not consulted
  // — a supplied one can only agree (redundant) or disagree (TheLeague's
  // draft results served at 200, in the right shape, as the AFL's).
  //
  // `host` still decides for a league id we do NOT know, which is the point
  // of the `?mflLeague=` override above: watching another league's draft is a
  // real feature, and there the hint is the only information available. It
  // stays allowlist-checked. See src/pages/api/live-scoring.ts#resolveHost.
  const registryLeague = getLeagueById(leagueId);
  const host = registryLeague
    ? registryLeague.mflHost
    : resolveMflHost(url.searchParams.get('host'), DEFAULT_HOST);
  const unit = url.searchParams.get('unit');

  const mflUrl = buildMflExportUrl({ type: 'draftResults', leagueId, year, host: `https://${host}` });

  try {
    // Once the static file's URL is known, the JSON export is only a fallback,
    // so it is asked ONCE instead of MFL_SAMPLES times. Sampling exists to beat
    // the export's disagreeing caches; the static file does not have them, and
    // ten redundant requests per poll per viewer is a lot to spend on a source
    // we are about to ignore. See staticUrlSeen.
    const staticKey = `${host}|${leagueId}|${year}|${unit ?? ''}`;
    const knownStatic = staticUrlSeen.get(staticKey);
    const { data, status } = await fetchFreshest(
      mflUrl,
      unit,
      `${host}|${leagueId}|${year}`,
      knownStatic ? 1 : MFL_SAMPLES
    );

    if (!data) {
      return new Response(
        JSON.stringify({ picks: [], serverTime: Date.now(), error: `MFL ${status ?? 'unreachable'}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const selected = selectDraftUnit<RawDraftPick>(data?.draftResults?.draftUnit, unit);

    // A named unit that isn't on the board is a caller error, not an empty
    // draft — say so instead of returning a plausible-looking empty board.
    if (unit && !selected) {
      return new Response(
        JSON.stringify({
          picks: [],
          serverTime: Date.now(),
          error: `unknown draft unit "${unit}"`,
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Prefer MFL's own static file when it is at least as fresh — see
    // staticUrlSeen. It is the same board its draft room reads, and it does not
    // flap; the sampled JSON above is the fallback, not the target.
    // `static_url` arrives inside MFL's JSON body, so it is third-party data
    // this server would otherwise fetch on trust. Allowlisted to MFL hosts by
    // the same rule as the `host` parameter — see toSafeMflUrl.
    const staticUrl = toSafeMflUrl((selected as any)?.static_url) ?? knownStatic;
    if (staticUrl) staticUrlSeen.set(staticKey, staticUrl);

    let rawPicks: RawDraftPick[] | RawDraftPick[] | undefined = undefined;
    const jsonPicks = selected?.draftPick;
    const jsonArr = Array.isArray(jsonPicks) ? jsonPicks : jsonPicks ? [jsonPicks] : [];

    const remembered = toSafeMflUrl(staticUrlSeen.get(staticKey));
    const staticPicks = remembered ? await fetchStaticBoard(remembered) : null;

    rawPicks =
      staticPicks && atLeastAsFresh(picksFreshness(staticPicks), picksFreshness(jsonArr))
        ? staticPicks
        : jsonArr;

    const picks = buildPicks(rawPicks);
    const body: DraftStatusResponse = {
      picks,
      serverTime: Date.now(),
      unit: selected?.unit,
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Don't cache at the edge — clients should always see the latest picks.
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        picks: [],
        serverTime: Date.now(),
        error: (err as Error).message || 'fetch failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
