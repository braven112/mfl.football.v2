/**
 * The idle player spotlight: the takeover, between plays.
 *
 * A reveal only fires on a fresh score by a starter, so a one-game Thursday
 * can go a whole half without the board's best screen ever appearing — the
 * owner watching it reported exactly that ("I never saw a player"). While a
 * game is live and nothing is revealing, the board now takes the field itself
 * every so often with one of the owner's OWN starters who is playing right
 * now, cycling through them across every league.
 *
 * Pure, so the cadence and the eligibility are pinned without a DOM.
 *
 *  - **Mine only.** The full field of color is the board's "this is yours"
 *    signal; spending it on an opponent's man between plays would teach the
 *    room the wrong thing. Opponents' scores still interrupt as lower thirds.
 *  - **In-progress games only.** A player whose game has not kicked off has
 *    nothing to show, and a final one is history the strip already carries.
 *  - **Never a fabricated play.** The copy is the player's points, his real
 *    box-score line and his real game clock; there is no ESPN play to quote.
 */
import type { BroadcastMoment } from './broadcast-moments';
import type { StripPage, StripRow } from './broadcast-layout';

/** How long one spotlight holds — a mine reveal's own hold, plus a beat. */
export const SPOTLIGHT_HOLD_MS = 12_000;
/** The scoreboard's turn between spotlights. */
export const SPOTLIGHT_GAP_MS = 30_000;

/** The owner's own players who are on the field right now, strip order, once each. */
export function spotlightCandidates(pages: StripPage[]): StripRow[] {
  const seen = new Set<string>();
  const out: StripRow[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      if (row.side !== 'mine' || row.state !== 'in-progress' || seen.has(row.key)) continue;
      seen.add(row.key);
      out.push(row);
    }
  }
  return out;
}

/**
 * Points first, then the box score: "18.4 pts · 6 rec (8 tgt), 84 yds, 1 TD".
 *
 * The stat line is ESPN's box score already joined to MFL ids server-side
 * (`formatStatLine`); a player with no touches yet has none, and gets the
 * points alone rather than an invented zero line.
 */
export function spotlightText(points: number, statLine: string): string {
  const pts = `${points.toFixed(1)} pts`;
  return statLine ? `${pts} \u00b7 ${statLine}` : `${pts} so far`;
}

/**
 * A strip row dressed as a moment, so the takeover can draw it unchanged.
 *
 * `franchiseId` is the owner's franchise in the row's league — a strip row
 * does not carry it, and the takeover needs it to find the club's colors.
 * `wallclock` stays empty, so this can never be mistaken for a fresh play by
 * anything that asks `isMomentFresh`.
 */
export function spotlightMoment(
  row: StripRow,
  franchiseId: string,
  franchiseName: string,
  statLine = '',
): BroadcastMoment {
  return {
    key: `spotlight:${row.key}`,
    playId: '',
    leagueId: row.leagueId,
    leagueName: row.leagueName,
    franchiseId,
    franchiseName,
    side: 'mine',
    kind: 'big-play',
    playerId: row.playerId,
    playerName: row.name,
    team: row.nflTeam,
    text: spotlightText(row.points, statLine),
    clock: row.clock,
    wallclock: '',
    scoreValue: 0,
    yards: 0,
  };
}
