/**
 * MFL Live's board → the canonical model.
 *
 * A transitional adapter, deliberately. `assembleMflLiveBoard` already does the
 * expensive, correct work — the cross-league fan-out, the three-rung identity
 * ladder, the per-league projections, the four honest statuses — and none of
 * that needs redoing to render through the shared kit. Rewriting the assembler
 * and swapping the UI in one step would put both changes in one unreviewable
 * diff; this lets the UI move first and the assembler follow.
 *
 * The two shapes differ in exactly one idea. `MflLiveMatchup` names its sides
 * `mine`/`opponent`, which is true on a board that only ever shows the
 * viewer's own matchups and a LIE on a league board showing the seven he is not
 * in. The canonical model states the pairing as an ordered pair carrying no
 * claim, plus a nullable `viewerSide` index. Converting is therefore lossless
 * in this direction and would not be in the other: every MFL Live matchup has
 * a viewer by construction, so `viewerSide` is always 0.
 */

import type { BroadcastMoment } from '../broadcast-moments';
import type { LiveBoard, LiveMatchup, LiveMoment, LivePanel, LiveTeam } from '../../types/live';
import type { MflLiveBoard, MflLiveMatchup, MflLiveTeam } from '../../types/mfl-live';
import type { CanonicalLeagueSlug } from '../../config/leagues';

/**
 * `MflLiveTeam` carries no `remainingPoints`, but it is not missing — it is
 * `projectedFinal - live` by definition (the projection still tied to unplayed
 * game-time). Deriving it here keeps the canonical model's win-probability
 * spread exact rather than approximated.
 */
function toTeam(team: MflLiveTeam): LiveTeam {
  return {
    franchiseId: team.franchiseId,
    name: team.name,
    nameShort: team.nameShort,
    initials: team.initials,
    icon: team.icon,
    iconAlt: team.iconAlt,
    rung: team.rung,
    live: team.live,
    projectedFinal: team.projectedFinal,
    remainingPoints: Math.max(0, team.projectedFinal - team.live),
    yetToPlay: team.yetToPlay,
    players: team.players,
    bench: team.bench,
  };
}

/**
 * The colour custom properties, renamed from viewer-relative to side-indexed.
 *
 * `--tm-*` (mine) becomes `--t0-*` and `--to-*` (opponent) becomes `--t1-*`,
 * which is consistent because `mine` always lands on side 0 here. The VALUES
 * are untouched: they were already resolved server-side, once per theme,
 * against MFL Live's own card.
 */
function toColorVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    out[key.replace(/^--tm-/, '--t0-').replace(/^--to-/, '--t1-')] = value;
  }
  return out;
}

function toMatchup(matchup: MflLiveMatchup): LiveMatchup {
  return {
    index: matchup.index,
    sides: [toTeam(matchup.mine), toTeam(matchup.opponent)],
    // Always 0: this board exists to show the viewer's own matchups, so every
    // one of them has him on the side it calls `mine`.
    viewerSide: 0,
    // `winProbability` is stated from the viewer, and the viewer is side 0 —
    // so it is already `p0` and needs no complement.
    p0: matchup.winProbability,
    colorVars: toColorVars(matchup.colorVars),
  };
}

export function fromMflLiveBoard(board: MflLiveBoard): LiveBoard {
  const panels: LivePanel[] = board.leagues.map((panel) => ({
    leagueId: panel.leagueId,
    leagueName: panel.leagueName,
    slug: (panel.slug as CanonicalLeagueSlug | null) ?? null,
    registered: panel.registered,
    viewerFranchiseId: panel.franchiseId,
    status: panel.status,
    matchups: panel.matchups.map(toMatchup),
  }));

/**
 * Drop the viewer-relative `side`.
 *
 * MFL Live's assembler emits `BroadcastMoment`, whose `side` is 'mine' or
 * 'opponent'. Every moment on THAT board genuinely is one of the two, so
 * nothing is lost here — but the kit's board also serves a league board where
 * most matchups are nobody's, and a moment that must claim a side there would
 * be the same lie the canonical matchup avoids with a nullable `viewerSide`.
 * A caller that wants the relationship asks the PANEL who the viewer is.
 *
 * Listed field by field rather than spread, so a field added to either type is
 * a compile error here instead of a silent drop.
 */
function toMoment(moment: BroadcastMoment): LiveMoment {
  return {
    key: moment.key,
    playId: moment.playId,
    leagueId: moment.leagueId,
    leagueName: moment.leagueName,
    franchiseId: moment.franchiseId,
    franchiseName: moment.franchiseName,
    playerId: moment.playerId,
    playerName: moment.playerName,
    team: moment.team,
    text: moment.text,
    clock: moment.clock,
  };
}

  return {
    ok: board.ok,
    scope: 'cross-league',
    week: board.week,
    year: board.year,
    fetchedAt: board.fetchedAt,
    panels,
    games: board.games,
    moments: board.moments.map(toMoment),
    redZone: board.redZone,
    playerMeta: board.playerMeta,
  };
}
