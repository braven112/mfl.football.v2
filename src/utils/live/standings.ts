/**
 * One league's standings, read live, for ANY league the owner is in.
 *
 * ── WHY THIS IS NOT `live-standings.ts` ───────────────────────────────────
 * That module refreshes the standings PAGES: it takes a registry
 * `LeagueDefinition`, and every one of its failure paths falls back to the
 * committed `data/<league>/mfl-feeds/<year>/standings.json` snapshot. Both
 * halves are unavailable here. A league this site does not run has no registry
 * entry and no committed feed, so there is nothing to fall back TO — its
 * honest answer is `null`, which the UI renders as "couldn't load" rather than
 * as an empty table.
 *
 * It also reads with the OWNER'S COOKIE, because an outside league's exports
 * are not ours to read anonymously. The host comes from `myleagues` and
 * `hostOf` has already constrained it to HTTPS `*.myfantasyleague.com` — the
 * request carries the owner's `MFL_USER_ID`, and a payload naming another
 * origin must never become a destination for that credential.
 *
 * ── THE ROWS ARE NEVER RE-SORTED ──────────────────────────────────────────
 * MFL returns standings in the league's official order with that league's
 * constitution tiebreaker chain already applied — Power Rank, Victory Points,
 * head-to-head. We cannot reproduce it, and homebrew tiebreakers miscredited
 * 22 AFL and 10 TheLeague division titles before the rule existed that forbids
 * this. `rank` here is the feed INDEX and nothing more.
 * `docs/claude/rules/standings-brackets-draft-order.md`.
 *
 * SERVER-SIDE ONLY.
 */

import type { LiveStandingsRow } from '../../types/live';
import type { BoardLeague } from '../sunday-ticket-selection';
import { buildMflExportUrl } from '../mfl-url';
import { mflFetch } from '../mfl-fetch';
import { franchiseInitials, identityIconAlt, resolveFranchiseIdentity } from '../mfl-live-identity';

/**
 * Serve a cached read for this long.
 *
 * Far longer than the board's 25s poll, and deliberately: a standing changes
 * when a game goes final, which is a handful of times a Sunday, while the
 * scores beside it change constantly. Re-reading this every poll would charge
 * every viewer an export per 25 seconds for a number that did not move.
 */
const TTL_MS = 120_000;
/** After a failure, don't hammer a league that is already unhappy. */
const FAILURE_COOLDOWN_MS = 30_000;
const FETCH_TIMEOUT_MS = 6_000;
/** One entry per league-year. An owner in 40 leagues is already an outlier. */
const MAX_ENTRIES = 64;

interface CacheEntry {
  rows: LiveStandingsRow[];
  atMs: number;
}

const cache = new Map<string, CacheEntry>();
const failureAtMs = new Map<string, number>();

/** MFL sends every number as a string, and an absent column as ''. */
function num(value: unknown): number {
  const parsed = Number.parseFloat(`${value ?? ''}`.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ReadLeagueStandingsInput {
  league: BoardLeague;
  /** SEASON year — standings are results-shaped. */
  year: number;
  /** The owner's MFL cookie (`AuthUser.id`). */
  mflUserCookie: string;
  /** The viewer's franchise in THIS league, for the row highlight. */
  viewerFranchiseId?: string | null;
  /**
   * Franchise names for a league with no committed brands, as
   * `readCrossLeagueLive` already resolved them. The feed's own `fname` is the
   * fallback — it is present in most exports but not all, and a blank name
   * would override a good one with nothing.
   */
  franchiseNames?: Record<string, string>;
  now?: () => number;
}

/**
 * Read a league's standings. Returns `null` on any failure — never throws, and
 * never an empty array, which would render as a league with no teams.
 */
export async function readLeagueStandings(
  input: ReadLeagueStandingsInput,
): Promise<LiveStandingsRow[] | null> {
  const { league, year, mflUserCookie, now = Date.now } = input;
  if (!mflUserCookie) return null;

  const key = `${league.id}:${year}`;
  const hit = cache.get(key);
  if (hit && now() - hit.atMs < TTL_MS) return decorate(hit.rows, input);

  const failedAt = failureAtMs.get(key);
  if (failedAt !== undefined && now() - failedAt < FAILURE_COOLDOWN_MS) {
    // Inside the cooldown a STALE read still beats nothing: a standing that is
    // a few minutes old is right about almost everything, and blanking the tab
    // over one bad request is the worse answer.
    return hit ? decorate(hit.rows, input) : null;
  }

  try {
    const url = buildMflExportUrl({
      type: 'leagueStandings',
      leagueId: league.id,
      year,
      // A registered league has no `host` on its board entry; the export API's
      // default host resolves it from the league id, which is what every
      // registry read already does.
      ...(league.host ? { host: league.host } : {}),
    });
    const response = await mflFetch({
      url,
      method: 'GET',
      mflUserCookie,
      timeoutMs: FETCH_TIMEOUT_MS,
    });

    // `res.ok` is not "the data is good": MFL answers errors with a 200, and a
    // throttled MFL answers with an HTML page under one. Read the SHAPE.
    const body = response.ok ? await response.json().catch(() => null) : null;
    const raw = (body as { leagueStandings?: { franchise?: unknown } } | null)
      ?.leagueStandings?.franchise;
    const feedRows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (feedRows.length === 0) {
      failureAtMs.set(key, now());
      return hit ? decorate(hit.rows, input) : null;
    }

    const rows: LiveStandingsRow[] = [];
    feedRows.forEach((entry, index) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const franchiseId = `${row.id ?? ''}`.trim().padStart(4, '0');
      if (!franchiseId || franchiseId === '0000') return;
      rows.push({
        franchiseId,
        // The FEED's position, 1-based. Not computed from the columns, and not
        // recomputed if this array is ever filtered — see the header.
        rank: index + 1,
        // Filled by `decorate`, which runs on a cache hit too so a name that
        // arrived late is not frozen into the cached rows.
        name: `${row.fname ?? ''}`.trim(),
        nameShort: '',
        initials: '',
        icon: '',
        iconAlt: '',
        rung: 'text',
        wins: num(row.h2hw),
        losses: num(row.h2hl),
        ties: num(row.h2ht),
        pointsFor: num(row.pf),
        isViewer: false,
      });
    });

    if (rows.length === 0) {
      failureAtMs.set(key, now());
      return hit ? decorate(hit.rows, input) : null;
    }

    failureAtMs.delete(key);
    cache.set(key, { rows, atMs: now() });
    if (cache.size > MAX_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].atMs - b[1].atMs)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return decorate(rows, input);
  } catch {
    failureAtMs.set(key, now());
    return hit ? decorate(hit.rows, input) : null;
  }
}

/**
 * Put each row's identity and the viewer flag on, OUTSIDE the cache.
 *
 * Two reasons it is not baked in at parse time. The viewer differs per
 * request and the cache is shared across them, so a cached `isViewer` would
 * highlight one owner's row for the next reader. And the identity ladder's
 * inputs — the registry's brands, the names `readCrossLeagueLive` resolved —
 * can arrive after the standings did.
 */
function decorate(
  rows: readonly LiveStandingsRow[],
  input: ReadLeagueStandingsInput,
): LiveStandingsRow[] {
  const { league, viewerFranchiseId = null, franchiseNames = {} } = input;
  const slug = league.registered?.slug ?? undefined;

  return rows.map((row) => {
    // The resolved name first, the feed's own `fname` second. Neither may be
    // blank: an empty string here would beat the ladder's own fallback.
    const franchiseName = franchiseNames[row.franchiseId]?.trim() || row.name || '';
    const identity = resolveFranchiseIdentity({
      franchiseId: row.franchiseId,
      franchiseName,
      // Rung 1 only for a league we run. An outside league drops to the NFL
      // club match and then to text — the same marks its cards already wear,
      // which is the point: two views of one league must not disagree about
      // who a franchise is.
      leagueSlug: slug,
    });
    return {
      ...row,
      name: identity.name,
      nameShort: identity.nameShort,
      initials: identity.initials || franchiseInitials(identity.name),
      icon: identity.icon,
      iconAlt: identityIconAlt(identity),
      rung: identity.rung,
      isViewer: viewerFranchiseId !== null && row.franchiseId === viewerFranchiseId,
    };
  });
}

/** Test seam. Never called in production — the TTL is the production story. */
export function __resetStandingsCache(): void {
  cache.clear();
  failureAtMs.clear();
}
