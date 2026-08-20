/**
 * ESPN scoreboard URL builder — one place that knows how ESPN numbers weeks.
 *
 * ESPN does NOT continue the regular-season week count into January: the
 * playoffs are `seasontype=3` with `week=1..4`, not weeks 19-22. Getting that
 * wrong returns a 200 with an empty or wrong slate, which reads as "no games"
 * rather than as a bug — so the rule lives here and every caller shares it.
 */

const SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** How ESPN addresses a given league week. */
export interface EspnSeasonSlot {
  /** 2 = regular season, 3 = postseason. */
  seasonType: 2 | 3;
  /** ESPN's own week number within that season type. */
  week: number;
}

/** The last week of the NFL regular season (17 games + 1 bye across 18 weeks). */
export const LAST_REGULAR_SEASON_WEEK = 18;

export function espnSeasonSlot(leagueWeek: number): EspnSeasonSlot {
  const week = Number.isFinite(leagueWeek) && leagueWeek > 0 ? Math.floor(leagueWeek) : 1;
  if (week > LAST_REGULAR_SEASON_WEEK) {
    return { seasonType: 3, week: week - LAST_REGULAR_SEASON_WEEK };
  }
  return { seasonType: 2, week };
}

export function buildEspnScoreboardUrl(slot: EspnSeasonSlot, year: number): string {
  return `${SCOREBOARD_BASE}?week=${slot.week}&seasontype=${slot.seasonType}&dates=${year}`;
}
