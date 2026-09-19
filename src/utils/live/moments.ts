/**
 * Scoring plays → ticker rows, for a board that is NOT viewer-relative.
 *
 * ── WHY THERE IS A SECOND BUILDER ─────────────────────────────────────────
 * `buildBroadcastMoments` only emits rows for the viewer's franchise and their
 * opponents — right for MFL Live, which is a board OF your teams, and wrong
 * for a league board, where most of the sixteen matchups are nobody's and
 * every one of their tickers would come back empty. This one credits EVERY
 * franchise on the board, and carries no `side` claim at all (see `LiveMoment`).
 *
 * ── DERIVED EVERY POLL, NEVER ACCUMULATED ─────────────────────────────────
 * `/api/nfl-game-detail` returns every scoring play in the slate on every
 * poll, so recomputing from the current payload is idempotent: a play cannot
 * be emitted twice and there is no seen-set to keep in sync. The ticker this
 * replaces accumulated instead — it inferred a fantasy "delta" by diffing each
 * starter's points between two 60s polls, so a stat correction could invent a
 * scoring event and a point swing spanning a poll boundary was attributed to
 * the wrong moment in the game.
 *
 * ── THE OWNER MAP IS A LIST, AND THE KEY CARRIES THE LEAGUE ───────────────
 * One NFL player can be started by several franchises at once. That is not
 * defensive padding: the AFL runs 24 franchises as duplicate-player
 * conferences, so 85 of 131 starters in a real AFL week are started twice, and
 * a `Map<playerId, fid>` keeps only the LAST one written — which reads as "his
 * touchdown didn't count" rather than as a bug. And both leagues have a
 * franchise `0001`, so the dedupe key names the league or one owner's
 * touchdown merges with another's.
 *
 * One row per play per FRANCHISE, not per credited player: a touchdown credits
 * several athletes (rusher + kicker), and an owner starting two of them would
 * otherwise see the identical line twice.
 */
import type { LiveMoment, LivePanel } from '../../types/live';
import type { LiveScoringPlay, PlayerMeta } from '../../types/live-scoring';
import { formatPlayClock } from '../live-scoring-view';

export function buildLiveMoments(
  plays: readonly LiveScoringPlay[],
  panels: readonly LivePanel[],
  meta: Record<string, PlayerMeta>,
): LiveMoment[] {
  const out: LiveMoment[] = [];
  const seen = new Set<string>();

  for (const panel of panels) {
    // MFL player id → every franchise in THIS league starting him, with the
    // franchise's own display name alongside.
    const owners = new Map<string, { id: string; name: string }[]>();
    for (const matchup of panel.matchups) {
      for (const team of matchup.sides) {
        for (const row of team.players) {
          const list = owners.get(row.id);
          const entry = { id: team.franchiseId, name: team.nameShort || team.name };
          if (list) {
            if (!list.some((o) => o.id === entry.id)) list.push(entry);
          } else {
            owners.set(row.id, [entry]);
          }
        }
      }
    }
    if (owners.size === 0) continue;

    for (const play of plays) {
      for (const playerId of play.playerIds) {
        for (const owner of owners.get(playerId) ?? []) {
          const key = `${play.playId}:${panel.leagueId}:${owner.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            key,
            playId: play.playId,
            leagueId: panel.leagueId,
            leagueName: panel.leagueName,
            franchiseId: owner.id,
            franchiseName: owner.name,
            playerId,
            playerName: meta[playerId]?.name ?? '',
            team: play.nflTeam,
            text: play.text,
            clock: formatPlayClock(play),
          });
        }
      }
    }
  }

  // Most recent first. The route hands the slate over in chronological order
  // (`comparePlaysChronologically`), so reversing is enough — and is why this
  // does NOT re-sort on `sequence`, which only orders within a single game.
  return out.reverse();
}
