/**
 * Shared standings-cell formatters.
 *
 * Phase 6 consolidation: these helpers were copy-pasted (and had drifted) across
 * StandingsTable / LeagueStandingsTable / ConferenceLeagueStandingsTable /
 * TierAllPlayStandingsTable. They now live here, imported once by the unified
 * `standings/StandingsTable.astro`.
 *
 * The `deriveAllPlayWLT` guard is intentionally the STRICT one (`<= 0 → null`):
 * a zero all-play percentage with no recorded W-L-T means the feed predates
 * all-play tracking, and deriving `0-240-0` from it would fabricate a season.
 * Three of the four legacy copies already guarded this way; the fourth
 * (LeagueStandingsTable) did not, so TheLeague's Playoff-Standings view used to
 * render `0-240-0` for those historical rows. Unifying on the guard makes it
 * `N/A` everywhere — the single, owner-approved behavior change of Phase 6
 * (see docs/standings-table-design.md §2.3.1 / Q8). `standings-cells.test.ts`
 * locks the `pct === "0"` case.
 */

export interface WLT {
  w: number;
  l: number;
  t: number;
}

export function parseWLT(wlt: string | undefined): WLT {
  if (!wlt) return { w: 0, l: 0, t: 0 };
  const parts = wlt.split('-').map(Number);
  return { w: parts[0] || 0, l: parts[1] || 0, t: parts[2] || 0 };
}

/**
 * Derive an all-play W-L-T from a percentage when the record is missing.
 * NFL schedule: 16 weeks x 15 opponents = 240 games (2020 and earlier),
 *               17 weeks x 15 opponents = 255 games (2021+).
 * Returns null when there is no usable percentage — no data, NaN, or a zero
 * that would fabricate a full losing season (see module header).
 */
export function deriveAllPlayWLT(pct: string | undefined, seasonYear: number): WLT | null {
  if (!pct) return null; // No data available
  const TOTAL_GAMES = seasonYear >= 2021 ? 255 : 240;
  const percentage = parseFloat(pct);
  if (isNaN(percentage) || percentage <= 0) return null;
  const wins = Math.round(TOTAL_GAMES * percentage);
  const losses = TOTAL_GAMES - wins;
  return { w: wins, l: losses, t: 0 };
}

export function safeParseFloat(value: string | undefined, decimals: number): string {
  if (!value) return (0).toFixed(decimals);
  return parseFloat(value).toFixed(decimals);
}

export function safeParseInt(value: string | undefined): string {
  if (!value) return '0';
  return parseInt(value).toString();
}

/**
 * Format a record cell. `omitZeroTies` suppresses the tie segment when ties are
 * zero (`12-3` instead of `12-3-0`) — the AFL tier table's convention; every
 * other table renders the full `W-L-T`. Null records render `N/A`.
 */
export function formatRecord(rec: WLT | null, omitZeroTies = false): string {
  if (!rec) return 'N/A';
  if (omitZeroTies) return `${rec.w}-${rec.l}${rec.t > 0 ? `-${rec.t}` : ''}`;
  return `${rec.w}-${rec.l}-${rec.t}`;
}

/**
 * Resolve the all-play record for a team: use the recorded `all_play_wlt` if
 * present, otherwise derive it from `all_play_pct`.
 */
export function resolveAllPlayRecord(
  team: { all_play_wlt?: string; all_play_pct?: string },
  seasonYear: number
): WLT | null {
  return team.all_play_wlt ? parseWLT(team.all_play_wlt) : deriveAllPlayWLT(team.all_play_pct, seasonYear);
}

/**
 * Within-division games-back, computed off the best divisional record in the
 * supplied group. Matches the legacy division-view math exactly.
 */
export function calculateGamesBack(
  team: { divw: string; divl: string },
  allTeamsInGroup: Array<{ divw: string; divl: string }>
): number {
  if (allTeamsInGroup.length === 0) return 0;
  const best = allTeamsInGroup.reduce((prev, current) =>
    parseInt(current.divw) > parseInt(prev.divw) ? current : prev
  );
  const bestWins = parseInt(best.divw);
  const bestLosses = parseInt(best.divl);
  const teamWins = parseInt(team.divw);
  const teamLosses = parseInt(team.divl);
  return (bestWins - teamWins + (teamLosses - bestLosses)) / 2;
}

/** Games-back cell text: an em-dash for the leader(s), one decimal otherwise. */
export function formatGamesBack(gb: number): string {
  return gb === 0 ? '—' : gb.toFixed(1);
}
