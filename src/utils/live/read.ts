/**
 * ONE league's live board — every matchup in it, read anonymously.
 *
 * SERVER-SIDE ONLY.
 *
 * This is the league-board half of the live-scoring read. The cross-league
 * half (`cross-league-live.ts` → `readCrossLeagueLive`) answers a different
 * question and is deliberately left alone: it needs the owner's own MFL cookie
 * to discover which leagues they are in, and it reads only the matchups they
 * are IN. This needs neither — a league's own board is public, shows all
 * sixteen (or twenty-four) matchups, and highlights the viewer's only if there
 * is one.
 *
 * What the two share is everything below the league loop: the same
 * `loadLiveScoringPayload`, the same `loadLeagueWeekProjections`, the same
 * `computeTeamTotals`, the same identity ladder, and the same canonical model
 * (`src/types/live.ts`). They differ in AUTH and in SCOPE, which is exactly
 * the part that cannot be shared.
 *
 * ── THE ESPN LAYER IS NOT HERE ────────────────────────────────────────────
 * `games`, `moments` and `redZone` come back empty. They are per-NFL-GAME
 * rather than per league, are fetched without a cookie, and either can fail
 * without costing the scores — so they compose ON TOP of this rather than
 * inside it. That also keeps this module testable offline, which matters
 * because ESPN 403s the sandbox (Akamai WAF; `curl` gets 200, node's `fetch`
 * gets "Access Denied").
 */

import type { CanonicalLeagueSlug } from '../../config/leagues';
import { getLeagueBySlug } from '../../config/leagues';
import { getCurrentSeasonYear } from '../league-year';
import { loadLiveScoringPayload } from '../live-scoring-source';
import { hasLiveSignal, type LiveSnapshot } from '../live-scoring-snapshot';
import { computeTeamTotals } from '../live-scoring-view';
import { getPlayerMap } from '../player-map';
import { getLeagueTeamBrands } from '../league-team-brands';
import { franchiseInitials, resolveFranchiseIdentity } from '../mfl-live-identity';
import type { PlayerMeta } from '../../types/live-scoring';
import type { LiveBoard, LiveLeagueStatus, LiveMatchup, LivePanel } from '../../types/live';
import { loadLeagueWeekProjections } from './projections';
import { buildLiveMatchup, buildLiveTeam } from './model';
import { surfaceForLeague, type LiveSurface } from './surface';

export interface ReadLeagueLiveInput {
  slug: CanonicalLeagueSlug;
  week: number;
  /** SEASON year — everything here is results-shaped. */
  year?: number;
  /**
   * The viewer's franchise in THIS league, or null.
   *
   * The CALLER league-scopes it, and must: franchise ids collide across
   * leagues (all three registry leagues have an `0001`), so an AFL-only
   * session handed straight through would light up "YOUR MATCHUP" on an
   * unrelated TheLeague franchise. Two of the three live-scoring pages already
   * gate this as `authUser?.leagueId === league.leagueId ? … : undefined`;
   * TheLeague's did not, which was the drift.
   */
  viewerFranchiseId?: string | null;
  /**
   * Whose card the franchise colours are judged against. Defaults to this
   * league's own surface, which is what its own page renders on.
   */
  surface?: LiveSurface;
  /**
   * Per-franchise ART, overriding the registry's.
   *
   * This exists for THROWBACK WEEK, and for nothing else. `applyThrowbackToBoard`
   * dresses each franchise in a resolved legacy identity by mutating the
   * page's `configTeams`, and the board must show that rather than the club's
   * present-day mark — the whole feature is invisible otherwise.
   *
   * Only name, short name and icon. COLOURS are deliberately not overridable:
   * the pair is resolved against this surface's card ground, and an era's
   * palette has not been through that check. Throwback swaps art, not colour.
   */
  identityOverrides?: Record<string, { name?: string; nameShort?: string; icon?: string }>;
}

/** Which of the four honest states this league is in. */
function statusFor(ok: boolean, snapshot: LiveSnapshot | null, pairCount: number): LiveLeagueStatus {
  if (!ok || !snapshot) return 'unavailable';
  // Checked BEFORE the pairing count. A week nobody has played has pairings
  // AND zeros — every franchise present, every score "0.00", every player
  // `nonstarter` — so calling it "no matchup" would be a second wrong answer
  // on top of the first.
  if (!hasLiveSignal(snapshot)) return 'not-played';
  return pairCount > 0 ? 'ok' : 'no-matchup';
}

/**
 * A board with one panel and no matchups, saying WHY.
 *
 * A league with nothing to show still gets its place in the list. Dropping it
 * would re-order a cross-league board mid-afternoon and make an owner wonder
 * where a team went, and `ok` stays separate from `status` because "the feed
 * says nothing" and "we could not reach the feed" are different facts all the
 * way to the screen.
 */
function emptyBoard(input: {
  league: ReturnType<typeof getLeagueBySlug>;
  slug: CanonicalLeagueSlug;
  week: number;
  year: number;
  viewerFranchiseId: string | null;
  status: LiveLeagueStatus;
  ok: boolean;
}): LiveBoard {
  const { league, slug, week, year, viewerFranchiseId, status, ok } = input;
  return {
    ok,
    scope: 'league',
    week,
    year,
    fetchedAt: new Date().toISOString(),
    panels: [
      {
        leagueId: league?.id ?? '',
        leagueName: league?.name ?? '',
        slug: league ? slug : null,
        registered: Boolean(league),
        viewerFranchiseId,
        status,
        matchups: [],
      },
    ],
    games: [],
    moments: [],
    redZone: [],
    playerMeta: {},
  };
}

/**
 * Read one league's week and build its board.
 *
 * Best-effort throughout: a dead or throttled MFL yields `ok: false` with a
 * panel whose status is `unavailable`, never a throw and never an empty board
 * that reads as "no games". `res.ok` is not consulted — `loadLiveScoringPayload`
 * owns that distinction, because MFL answers a throttled request with an HTML
 * page under a 200 and that parses to exactly the offseason shape.
 */
export async function readLeagueLive(input: ReadLeagueLiveInput): Promise<LiveBoard> {
  const year = input.year ?? getCurrentSeasonYear();
  const { slug, week } = input;
  const surface = input.surface ?? surfaceForLeague(slug);
  const viewerFranchiseId = input.viewerFranchiseId ?? null;
  const league = getLeagueBySlug(slug);

  const empty = (status: LiveLeagueStatus, ok: boolean) =>
    emptyBoard({ league, slug, week, year, viewerFranchiseId, status, ok });

  if (!league) return empty('unavailable', false);
  // MFL serves no live scoring before the Week 1 Thursday, and
  // `getCurrentNFLWeek` returns 0 until then. Clamping that up to 1 is what
  // hides the gap — a week-1 request in the September pre-kickoff window fails
  // against a perfectly healthy league — so a falsy week is its own state.
  if (!Number.isFinite(week) || week <= 0) return empty('not-played', true);

  // Independent, so they overlap. Projections may reach MFL when the committed
  // feed is for another week, and this runs inside a page render.
  //
  // Neither of these throws on an upstream failure by contract, but this is
  // guarded anyway: it runs INSIDE the page render, and the difference between
  // `unavailable` and an unhandled rejection is a board that says so versus a
  // 500. `assembleLiveScoringData` makes the same promise for the same reason.
  let payload: Awaited<ReturnType<typeof loadLiveScoringPayload>>;
  let projections: Map<string, number>;
  try {
    [payload, projections] = await Promise.all([
      loadLiveScoringPayload({ leagueId: league.id, year, week }),
      loadLeagueWeekProjections(slug, week, year),
    ]);
  } catch {
    return empty('unavailable', false);
  }

  return buildBoardFromSnapshot({
    slug,
    week,
    year,
    ok: payload.ok,
    snapshot: payload,
    projections,
    viewerFranchiseId,
    surface,
    identityOverrides: input.identityOverrides,
  });
}

/* ── snapshot → board ────────────────────────────────────────────────────── */

export interface BuildBoardInput {
  slug: CanonicalLeagueSlug;
  week: number;
  /** SEASON year — everything here is results-shaped. */
  year: number;
  /** Did the READ succeed? Distinct from "is there anything in it". */
  ok: boolean;
  snapshot: LiveSnapshot;
  /** This league's own week-scoped projections. A projection belongs to a
   *  player IN A LEAGUE, so an empty map is correct for a league with none —
   *  never another league's. */
  projections: Map<string, number>;
  viewerFranchiseId?: string | null;
  surface?: LiveSurface;
  identityOverrides?: Record<string, { name?: string; nameShort?: string; icon?: string }>;
  /**
   * Player identity, when the caller already has it.
   *
   * The live read builds this from `getPlayerMap(year)`. The OFFSEASON SAMPLE
   * carries its own — it is a replay of a past week and the current player map
   * has since lost players who were on those rosters — so handing it through
   * is what keeps a bundled board from printing "Player 12345" for half its
   * rows. Omitted, the year's map is read.
   */
  playerMeta?: Record<string, PlayerMeta>;
}

/**
 * Build a league's board from a snapshot that is already in hand.
 *
 * Extracted from `readLeagueLive` so the two callers cannot drift: the live
 * read, and the OFFSEASON SAMPLE — which is a `LiveSnapshot` too, because MFL
 * turns the liveScoring feed off out of season and the bundled replay is
 * recorded in exactly that shape. Before this, the sample path built its own
 * board and would have had to re-derive the totals, the identity ladder, the
 * bench split and the four statuses.
 */
export function buildBoardFromSnapshot(input: BuildBoardInput): LiveBoard {
  const { slug, week, year, ok, snapshot, projections } = input;
  const surface = input.surface ?? surfaceForLeague(slug);
  const viewerFranchiseId = input.viewerFranchiseId ?? null;
  const league = getLeagueBySlug(slug);

  const empty = (status: LiveLeagueStatus, okFlag: boolean): LiveBoard =>
    emptyBoard({ league, slug, week, year, viewerFranchiseId, status, ok: okFlag });

  if (!league) return empty('unavailable', false);


  // Only pairings with BOTH sides. A one-sided element is a bye rather than a
  // matchup, and the canonical model states a pairing as two teams precisely
  // so nothing downstream has to null-check a side it is already rendering.
  const pairs = (snapshot.matchups ?? []).filter((m) => m.home && m.away);
  const status = statusFor(ok, ok ? snapshot : null, pairs.length);
  if (status !== 'ok') return empty(status, ok);

  // Identity for every row, STARTERS AND BENCH in one pass: the bench renders
  // the same row component, so a bench id missing here prints "Unknown Player"
  // with no headshot and no team code — the whole row, not a degraded one.
  const identity = input.playerMeta ? null : getPlayerMap(year);
  const playerMeta: Record<string, PlayerMeta> = input.playerMeta
    ? // The caller's map, copied rather than mutated — the offseason sample's
      // is a module-level constant and writing into it would leak one render's
      // rows into the next.
      { ...input.playerMeta }
    : {};
  for (const rows of [...Object.values(snapshot.players ?? {}), ...Object.values(snapshot.bench ?? {})]) {
    for (const row of rows) {
      if (playerMeta[row.id]) continue;
      const who = identity?.get(row.id);
      playerMeta[row.id] = {
        id: row.id,
        name: who?.name ?? `Player ${row.id}`,
        position: who?.position ?? '',
        nflTeam: who?.nflTeam ?? '',
        headshot: who?.headshot ?? '',
        // NEVER shipped for joining: it can hold a COLLEGE athlete id, and
        // college and NFL ids are both plain digits, so a bad join resolves a
        // DIFFERENT person rather than failing.
        espnId: null,
        // Deliberately 0 — scoring reads the per-league projections map. A
        // projection belongs to a player IN A LEAGUE.
        projected: 0,
      };
    }
  }

  // One lookup per league, not per franchise: `getLeagueTeamBrands` rebuilds
  // the whole Record per call, so calling it inside the loop would rebuild all
  // 24 AFL franchises to read one.
  let names: Record<string, string> = {};
  try {
    names = Object.fromEntries(
      Object.entries(getLeagueTeamBrands(slug)).map(([fid, brand]) => [fid, brand.name]),
    );
  } catch {
    // A league in the registry with no wired config — named by id rather than
    // by another league's crests.
  }

  const overrides = input.identityOverrides ?? {};

  const teamFor = (franchiseId: string) => {
    const franchiseName = names[franchiseId] ?? `Franchise ${franchiseId}`;
    // Rung 1 for every registry league, unconditionally: a real identity
    // outranks an inferred one, so a franchise called "Cowboys" keeps its own
    // crest rather than picking up Dallas's.
    const resolved = resolveFranchiseIdentity({ franchiseId, franchiseName, leagueSlug: slug });
    // Throwback art, when the caller supplied any. `initials` are RE-DERIVED
    // from the era name rather than carried over — they are the text rung's
    // fallback mark, and a 1997 name showing today's initials is the same
    // half-dressed board the override exists to prevent.
    const over = overrides[franchiseId];
    const who = over
      ? {
          ...resolved,
          name: over.name ?? resolved.name,
          nameShort: over.nameShort ?? over.name ?? resolved.nameShort,
          initials: franchiseInitials(over.name ?? resolved.name),
          icon: over.icon ?? resolved.icon,
        }
      : resolved;
    // STARTERS only. The bench lives in its own map precisely so nothing can
    // sum it by accident — a bench row here inflates the projected final and
    // the win-probability bar with points that cannot be scored.
    const starters = snapshot.players?.[franchiseId] ?? [];
    const totals = computeTeamTotals(starters, playerMeta, {
      score: snapshot.scores?.[franchiseId],
      yetToPlayFallback: snapshot.playersYetToPlay?.[franchiseId],
      projections,
    });
    return {
      identity: who,
      team: buildLiveTeam({
        identity: who,
        totals,
        players: starters,
        bench: snapshot.bench?.[franchiseId] ?? [],
        meta: playerMeta,
      }),
    };
  };

  const matchups: LiveMatchup[] = pairs.map((pair, index) => {
    const side0 = teamFor(pair.home);
    const side1 = teamFor(pair.away);
    return buildLiveMatchup({
      index,
      side0: side0.team,
      side1: side1.team,
      side0Colors: side0.identity.colors,
      side1Colors: side1.identity.colors,
      surface,
      viewerFranchiseId,
    });
  });

  const panel: LivePanel = {
    leagueId: league.id,
    leagueName: league.name,
    slug,
    registered: true,
    viewerFranchiseId,
    status: 'ok',
    matchups,
  };

  return {
    ok,
    scope: 'league',
    week,
    year,
    fetchedAt: new Date().toISOString(),
    panels: [panel],
    games: [],
    moments: [],
    redZone: [],
    playerMeta,
  };
}
