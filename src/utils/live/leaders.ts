/**
 * The week's top scorers in one league — teams and individuals.
 *
 * PURE, and derived from the board that is already assembled. The snapshot
 * behind a league board carries every franchise's starters, so this costs no
 * request: it is a read of numbers already on screen. That is also what keeps
 * it honest — a strip built from a second source could disagree with the cards
 * above it, and the one nobody checks is the one that drifts.
 *
 * Four rules, each of which is a way this goes wrong:
 *
 *  - **STARTERS only.** `LiveTeam.players` is "the rows that score this
 *    matchup" and the bench travels in its own array precisely so nothing can
 *    fold it in. A bench row here would credit an owner points that cannot be
 *    scored — the same defect that inflates a projection, moved to a
 *    leaderboard where it is harder to spot. `docs/claude/rules/live-scoring.md`.
 *  - **A performance is keyed by FRANCHISE AND PLAYER, never by player.** In
 *    the AFL a player is routinely started in both conferences, and both sides
 *    of one matchup can start him. Those are different owners' points and
 *    belong on separate rows; collapsing them drops the credit from every
 *    roster but one.
 *  - **Zero is never a leader.** An unplayed week is a well-formed payload of
 *    zeros, so a strip that does not filter renders ten rows of "0.0" as this
 *    week's best performances. Only positive scores rank.
 *  - **Ties break on a stable key.** This re-derives on every poll, and a tie
 *    broken by array order reshuffles the strip under the reader's thumb on a
 *    board that did not change. Same reason `orderPanelMatchups` breaks its
 *    ties on the pairing key.
 */

import type { LiveLeaderPlayer, LiveLeaders, LiveLeaderTeam, LivePanel } from '../../types/live';

/** How many rows each strip carries. Enough to scan, short enough for a phone. */
export const LEADER_TEAM_LIMIT = 5;
export const LEADER_PLAYER_LIMIT = 10;

export interface BuildLeadersOptions {
  teamLimit?: number;
  playerLimit?: number;
}

/**
 * Round to the tenth before comparing.
 *
 * MFL sends scores as strings with two decimals and the totals are summed in
 * floating point, so two genuinely equal scores can differ in the fifteenth
 * place — enough to order them, not enough for the difference to be real. The
 * strip prints one decimal, so ranking on anything finer sorts by a digit the
 * reader cannot see and has no way to explain.
 */
function rank(points: number): number {
  return Math.round(points * 10);
}

export function buildLeaders(panel: LivePanel, options: BuildLeadersOptions = {}): LiveLeaders {
  const teamLimit = options.teamLimit ?? LEADER_TEAM_LIMIT;
  const playerLimit = options.playerLimit ?? LEADER_PLAYER_LIMIT;

  const teams: LiveLeaderTeam[] = [];
  const players: LiveLeaderPlayer[] = [];
  /**
   * A FRANCHISE is counted once, however many matchups it appears in.
   *
   * The board is a list of matchups, and a DOUBLEHEADER week puts every
   * franchise in two of them — TheLeague's own schedule does this — so walking
   * the pairings without this counts each roster twice. It shipped visibly on
   * the first cut: Josh Allen at #1 and #2 of the same league's top
   * performances, same owner, same score, and the top-teams list would have
   * read as sixteen teams tied with themselves.
   *
   * The gate is on the franchise, not on the row, because both strips are
   * per-roster: the same roster in two matchups is one team and one set of
   * starters. It does NOT collapse the same PLAYER started by two different
   * franchises — those are different ids, different owners, and two
   * legitimate rows.
   */
  const seen = new Set<string>();

  for (const matchup of panel.matchups) {
    for (const side of matchup.sides) {
      if (seen.has(side.franchiseId)) continue;
      seen.add(side.franchiseId);

      if (side.live > 0) {
        teams.push({
          franchiseId: side.franchiseId,
          name: side.name,
          nameShort: side.nameShort,
          initials: side.initials,
          icon: side.icon,
          iconAlt: side.iconAlt,
          rung: side.rung,
          live: side.live,
          yetToPlay: side.yetToPlay,
        });
      }

      // STARTERS. `side.bench` is deliberately not read here — see the header.
      for (const row of side.players) {
        if (!(row.live > 0)) continue;
        players.push({
          playerId: row.id,
          franchiseId: side.franchiseId,
          franchiseName: side.nameShort,
          points: row.live,
          secondsRemaining: row.secondsRemaining,
        });
      }
    }
  }

  teams.sort((a, b) => {
    const diff = rank(b.live) - rank(a.live);
    return diff !== 0 ? diff : a.franchiseId.localeCompare(b.franchiseId);
  });

  players.sort((a, b) => {
    const diff = rank(b.points) - rank(a.points);
    if (diff !== 0) return diff;
    // Franchise before player: two owners tied on the same player read better
    // grouped by owner than interleaved, and the pair is unique either way.
    const byFranchise = a.franchiseId.localeCompare(b.franchiseId);
    return byFranchise !== 0 ? byFranchise : a.playerId.localeCompare(b.playerId);
  });

  return { teams: teams.slice(0, teamLimit), players: players.slice(0, playerLimit) };
}
