/**
 * NFL bye week by team, for one season, keyed so that EITHER dialect of team
 * code finds it.
 *
 * `data/nfl/bye-weeks.json` comes from MFL and speaks MFL's codes (GBP, KCC,
 * JAC, WAS). Player rows speak whichever dialect their feed did: TheLeague's
 * Free Agents rows carry MFL's, the AFL's derived snapshot carries ESPN's (GB,
 * KC, JAX). A lookup on the raw string silently reads "no bye" for eight teams
 * — indistinguishable from a player who genuinely has none (see
 * draft-broadcast-server.ts#loadByeWeeks, which hit exactly that). So every
 * week is stored under its raw code AND its normalized one, and the result is
 * a plain object that can cross into a `define:vars` script, where the row
 * builder cannot import `normalizeTeamCode`.
 *
 * The season is the CALENDAR year of `now`: the NFL season that year's byes
 * belong to. From Labor Day to New Year that is the season being played; from
 * the schedule release (May) to Labor Day it is the upcoming one, which is the
 * bye an owner adding a player wants. Before the release the file has no entry
 * for that year and the map comes back empty — a dash, rather than last
 * season's week presented as this one's.
 */
import { normalizeTeamCode } from './nfl-logo';

type ByeFile = { seasons?: Record<string, Record<string, number | string>> } | null | undefined;

export function byeWeeksByTeam(file: ByeFile, now: Date): Record<string, number> {
  const season = file?.seasons?.[String(now.getFullYear())] ?? {};
  const out: Record<string, number> = {};
  for (const [team, raw] of Object.entries(season)) {
    const week = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (!Number.isFinite(week)) continue;
    out[team.toUpperCase()] = week;
    out[normalizeTeamCode(team)] = week;
  }
  return out;
}
