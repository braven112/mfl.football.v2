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
import { resolveFranchiseIdentity } from '../mfl-live-identity';
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

  const empty = (status: LiveLeagueStatus, ok: boolean): LiveBoard => ({
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
  });

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

  const ok = payload.ok;
  const snapshot: LiveSnapshot = payload;

  // Only pairings with BOTH sides. A one-sided element is a bye rather than a
  // matchup, and the canonical model states a pairing as two teams precisely
  // so nothing downstream has to null-check a side it is already rendering.
  const pairs = (snapshot.matchups ?? []).filter((m) => m.home && m.away);
  const status = statusFor(ok, ok ? snapshot : null, pairs.length);
  if (status !== 'ok') return empty(status, ok);

  // Identity for every row, STARTERS AND BENCH in one pass: the bench renders
  // the same row component, so a bench id missing here prints "Unknown Player"
  // with no headshot and no team code — the whole row, not a degraded one.
  const identity = getPlayerMap(year);
  const playerMeta: Record<string, PlayerMeta> = {};
  for (const rows of [...Object.values(snapshot.players ?? {}), ...Object.values(snapshot.bench ?? {})]) {
    for (const row of rows) {
      if (playerMeta[row.id]) continue;
      const who = identity.get(row.id);
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

  const teamFor = (franchiseId: string) => {
    const franchiseName = names[franchiseId] ?? `Franchise ${franchiseId}`;
    // Rung 1 for every registry league, unconditionally: a real identity
    // outranks an inferred one, so a franchise called "Cowboys" keeps its own
    // crest rather than picking up Dallas's.
    const who = resolveFranchiseIdentity({ franchiseId, franchiseName, leagueSlug: slug });
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
