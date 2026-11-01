/**
 * Drive stakes: what a red-zone drive is worth to the viewer, league by league.
 *
 * For every player in a red-zone alert this asks one "what if": if HE scores
 * on this drive, where does the viewer's win chance in that matchup go? The
 * board's banner and the Google TV overlay's corner box both print the answer
 * ("54% → 68%"), so it is computed once, here, on the server, and neither
 * client does any math of its own.
 *
 * PURE apart from the rules, which the assembler reads and hands in.
 *
 * ── WHAT "SCORES" MEANS PER POSITION ─────────────────────────────────────
 * One event per position, the one a red-zone drive most often ends in for
 * that player: a passing TD for a QB, a rushing TD for a RB, a receiving TD
 * for a WR or TE, a field goal for a kicker. Everyone else (a defense, an
 * IDP) is not on the offense that has the ball and gets no stake.
 *
 * ── THE NUMBER IS A WHAT-IF, NOT A FORECAST ──────────────────────────────
 * The player's full touchdown value is added to his team's projected final.
 * His projection already expects some scoring, so this slightly overstates the
 * swing; it reads as "what this drive could do", which is what the banner
 * says. Never present it as a probability of scoring.
 */

import { winProbability } from './live-win-probability';
import type { RedZoneAlert } from './broadcast-moments';
import type { PositionRuleSet } from './live/scoring-rules';
import type { BroadcastLeagueScore } from '../types/live-broadcast';

/** The matchup a stake belongs to, and the viewer's win chance either side of the score. */
export interface DriveStake {
  /** Index into the league's `winProbability` (a doubleheader has two). */
  matchupIndex: number;
  /** The viewer's win chance now, 0-1. */
  before: number;
  /** The viewer's win chance if this player scores on this drive, 0-1. */
  after: number;
  /** The fantasy points the score is worth under this league's rules. */
  points: number;
}

/** The slice of `LeagueViewer` a stake needs. */
export interface StakeViewer {
  leagueId: string;
  franchiseId: string;
  /** In `findOwnerMatchups` order, the same order as `winProbability`. */
  opponentIds: string[];
}

/** A field goal from inside the 20 is a 20-38 yarder; 30 is the middle of that. */
export const RED_ZONE_FG_YARDS = 30;

interface ScoreEvent {
  code: '#P' | '#R' | '#C' | 'FG';
  /** Used when the league publishes no rule for this event. */
  fallback: number;
}

/** MFL's rules say `PK` and `Def`; rows can carry `K`, `DEF`, `DST`. */
function canonPosition(raw: string): string {
  const p = raw.trim().toUpperCase();
  if (p === 'K') return 'PK';
  if (p === 'DST' || p === 'D/ST' || p === 'TMDEF') return 'DEF';
  return p;
}

/** The event a red-zone drive ends in for this position, or null when it gets no stake. */
export function scoreEventFor(position: string): ScoreEvent | null {
  switch (canonPosition(position)) {
    case 'QB':
      return { code: '#P', fallback: 4 };
    case 'RB':
      return { code: '#R', fallback: 6 };
    case 'WR':
    case 'TE':
      return { code: '#C', fallback: 6 };
    case 'PK':
      return { code: 'FG', fallback: 3 };
    default:
      return null;
  }
}

/**
 * What one score is worth to this position under this league's rules.
 *
 * Every rule that names the event counts (a league may pay a base TD and a
 * separate bonus on the same code), evaluated at one touchdown — or, for a
 * field goal, at one kick of `RED_ZONE_FG_YARDS`. No rule for the event, or no
 * published rules at all, falls back to the standard value; a rule that pays
 * 0 (or less) is kept as published.
 */
export function scoreValue(
  rules: readonly PositionRuleSet[] | null | undefined,
  position: string,
): number | null {
  const event = scoreEventFor(position);
  if (!event) return null;
  if (!rules) return event.fallback;

  const pos = canonPosition(position);
  const value = event.code === 'FG' ? RED_ZONE_FG_YARDS : 1;
  let points = 0;
  let matched = false;
  for (const block of rules) {
    if (!block.positions.some((p) => canonPosition(p) === pos)) continue;
    for (const rule of block.rules) {
      if (!rule.event.includes(event.code)) continue;
      matched = true;
      if (value < rule.lo || value > rule.hi) continue;
      points += rule.kind === 'per' ? Math.floor(value / rule.every) * rule.points : rule.points;
    }
  }
  // A published rule is the league's answer even when it pays nothing for
  // one score; only a league with no rule for the event gets the standard.
  return matched ? points : event.fallback;
}

/**
 * The stake for one red-zone player in each matchup he can move, or [] when
 * there is none (a bye, a feed that could not be read, a position that is not
 * on the field for this drive).
 *
 * His score is added to EVERY team in the matchup that starts him: an AFL
 * player is routinely rostered in both conferences, and when he starts for
 * both sides his touchdown moves both totals and the margin not at all.
 *
 * `before` is recomputed from the same projected finals and the same model
 * as `after`, never read from the board's bar. On the live board the two are
 * identical (`scoreLeague` computes exactly this); a caller with its own curve
 * (the demo) would otherwise compare two models and could show a viewer's own
 * touchdown lowering his chance.
 */
export function stakesFor(
  player: Pick<RedZoneAlert['players'][number], 'side' | 'franchiseId' | 'position' | 'playerId'>,
  score: BroadcastLeagueScore | undefined,
  viewer: StakeViewer | undefined,
  rules: readonly PositionRuleSet[] | null | undefined,
): DriveStake[] {
  if (!score?.ok || !viewer) return [];
  const points = scoreValue(rules, player.position);
  if (points === null) return [];

  const mine = score.teams[viewer.franchiseId];
  if (!mine) return [];
  const starts = (team: BroadcastLeagueScore['teams'][string]) =>
    (team.players ?? []).some((row) => row.id === player.playerId);

  const out: DriveStake[] = [];
  viewer.opponentIds.forEach((opponentId, matchupIndex) => {
    const theirs = score.teams[opponentId];
    if (!theirs) return;
    // Rows are the authority on who he starts for; the alert's side is the
    // fallback for a payload that carries no rows.
    const rowsKnown = (mine.players?.length ?? 0) > 0 || (theirs.players?.length ?? 0) > 0;
    const forMine = rowsKnown ? starts(mine) : player.side === 'mine';
    const forTheirs = rowsKnown
      ? starts(theirs)
      : player.side === 'opponent' && opponentId === player.franchiseId;
    if (!forMine && !forTheirs) return;

    const remaining = mine.remainingPoints + theirs.remainingPoints;
    const before = winProbability(mine.projectedFinal, theirs.projectedFinal, remaining);
    const after = winProbability(
      mine.projectedFinal + (forMine ? points : 0),
      theirs.projectedFinal + (forTheirs ? points : 0),
      remaining,
    );
    out.push({ matchupIndex, before, after, points });
  });
  return out;
}

/** The matchup a player moves most: the one the board's card shows. */
export function biggestStake(stakes: readonly DriveStake[]): DriveStake | null {
  let best: DriveStake | null = null;
  for (const s of stakes) {
    if (!best || Math.abs(s.after - s.before) > Math.abs(best.after - best.before)) best = s;
  }
  return best;
}

/**
 * Every red-zone player with his drive's stakes attached: `stakes` for each
 * matchup he moves (the overlay shows the one its box is on), `stake` for the
 * biggest of them (the board's card).
 */
export function attachDriveStakes(
  alerts: readonly RedZoneAlert[],
  scores: readonly BroadcastLeagueScore[],
  viewers: readonly StakeViewer[],
  rulesByLeague: ReadonlyMap<string, readonly PositionRuleSet[] | null>,
): RedZoneAlert[] {
  const scoreBy = new Map(scores.map((s) => [s.leagueId, s]));
  const viewerBy = new Map(viewers.map((v) => [v.leagueId, v]));
  return alerts.map((alert) => ({
    ...alert,
    players: alert.players.map((p) => {
      const stakes = stakesFor(p, scoreBy.get(p.leagueId), viewerBy.get(p.leagueId), rulesByLeague.get(p.leagueId));
      const stake = biggestStake(stakes);
      return stake ? { ...p, stake, stakes } : p;
    }),
  }));
}

/** Win-chance points the score moves, signed for the viewer: +14 helps, −9 hurts. */
export function stakeSwing(stake: Pick<DriveStake, 'before' | 'after'>): number {
  return Math.round(stake.after * 100) - Math.round(stake.before * 100);
}

/**
 * The stakes worth printing, biggest swing first. A swing that rounds to 0 is
 * dropped: "54% → 54%" tells a room nothing.
 */
export function rankedStakes(alerts: readonly RedZoneAlert[]): (RedZoneAlert['players'][number] & {
  stake: DriveStake;
  team: string;
})[] {
  return alerts
    .flatMap((a) => a.players.map((p) => ({ ...p, team: a.team })))
    .filter((p): p is typeof p & { stake: DriveStake } => !!p.stake && stakeSwing(p.stake) !== 0)
    .sort((a, b) => Math.abs(stakeSwing(b.stake)) - Math.abs(stakeSwing(a.stake)));
}
