/**
 * AFL per-season division/conference structure readers.
 *
 * The AFL's structure changed over time: 2003–2012 ran SIX divisions
 * (AL North/Central/South, NL East/West/Pacific — "Pacific" was briefly
 * "Atlantic" in 2006), four teams each; 2013+ runs the current FOUR
 * (AL North/South, NL East/West), six teams each. The AL/NL conference split
 * has existed since 2003 — only division count, names, and membership moved.
 *
 * afl.config.json only knows the CURRENT structure, so grouping a historical
 * season by it produces wrong divisions, wrong winners, and wrong seeds. The
 * per-year ground truth is each season's MFL league feed
 * (data/afl-fantasy/mfl-feeds/{year}/league.json): `league.divisions.division`
 * (id, name, conference) and each franchise's `division` id. These helpers
 * extract that season's structure from the feed and overlay it onto the league
 * config so the standings grouping utilities (src/utils/standings.ts) group by
 * THAT season's makeup — the same pattern tier-history.json + getTierMembership
 * (src/utils/afl-tier.ts) use for per-season tier membership.
 *
 * Pure functions, no JSON imports — callers load the feed (pages already glob
 * mfl-feeds) and pass it in.
 */

// MFL single-item quirk: one-element collections may arrive as a bare object.
import { asArray as toArray } from './mfl-normalize';

export interface SeasonConference {
  id: string;
  name: string;
}

export interface SeasonDivision {
  id: string;
  name: string;
  conferenceId: string;
}

export interface SeasonStructure {
  /** Conferences in feed order (AL '00' / NL '01' for every AFL season). */
  conferences: SeasonConference[];
  /** Divisions in feed order (already grouped by conference in MFL feeds). */
  divisions: SeasonDivision[];
  /** franchiseId → that season's division id. */
  franchiseDivisions: Record<string, string>;
}

/** Minimal league-config shape the overlay rewrites (see standings.ts LeagueConfig). */
interface StructuredLeagueConfig {
  teams: Array<{
    franchiseId: string;
    division?: string;
    conference?: string;
    [key: string]: unknown;
  }>;
  divisions?: string[];
  conferences?: Array<{
    name: string;
    code: string;
    divisions: string[];
  }>;
  divisionToConference?: Record<string, string>;
}

/**
 * Extract a season's division/conference structure from its MFL league feed
 * (the parsed data/afl-fantasy/mfl-feeds/{year}/league.json). Returns null when
 * the feed is missing or doesn't carry a usable structure (error feeds, or a
 * hypothetical future season MFL hasn't materialized) — callers then fall back
 * to the static config structure.
 */
export function extractSeasonStructure(leagueFeed: unknown): SeasonStructure | null {
  const league = (leagueFeed as { league?: Record<string, any> } | null | undefined)?.league;
  if (!league) return null;

  const rawDivisions = toArray<Record<string, unknown>>(league.divisions?.division);
  const rawConferences = toArray<Record<string, unknown>>(league.conferences?.conference);
  const rawFranchises = toArray<Record<string, unknown>>(league.franchises?.franchise);
  if (!rawDivisions.length || !rawFranchises.length) return null;

  const divisions: SeasonDivision[] = [];
  for (const d of rawDivisions) {
    const id = d.id != null ? String(d.id) : '';
    const name = typeof d.name === 'string' ? d.name.trim() : '';
    const conferenceId = d.conference != null ? String(d.conference) : '';
    if (!id || !name) return null; // malformed feed — don't half-apply a structure
    divisions.push({ id, name, conferenceId });
  }

  const conferences: SeasonConference[] = rawConferences
    .map((c) => ({
      id: c.id != null ? String(c.id) : '',
      name: typeof c.name === 'string' ? c.name.trim() : '',
    }))
    .filter((c) => c.id !== '' && c.name !== '');

  const franchiseDivisions: Record<string, string> = {};
  for (const f of rawFranchises) {
    const id = typeof f.id === 'string' ? f.id : f.id != null ? String(f.id) : '';
    const division = f.division != null ? String(f.division) : '';
    if (id && division) franchiseDivisions[id] = division;
  }
  if (!Object.keys(franchiseDivisions).length) return null;

  return { conferences, divisions, franchiseDivisions };
}

/**
 * Overlay a season's structure onto a league config: rewrites each team's
 * `division` (and `conference`) to that season's assignment and rebuilds
 * `divisions`, `conferences`, and `divisionToConference` to that season's
 * layout. The result drops straight into getDivisionStandings /
 * getConferenceStandings / getLeagueStandings.
 *
 * Division names are the join key downstream (standings.ts groups by name),
 * which is safe because AFL division names have always been unique across the
 * two conferences (same assumption as compute-afl-awards.mjs).
 *
 * Pass the identity-resolved config (resolveConfigForYear) in, so a page gets
 * era-correct names/icons AND era-correct structure from one config object.
 * A null structure returns the config unchanged (current-structure fallback).
 */
export function applySeasonStructure<T extends StructuredLeagueConfig>(
  config: T,
  structure: SeasonStructure | null
): T {
  if (!structure) return config;

  const divisionNameById = new Map(structure.divisions.map((d) => [d.id, d.name]));

  const divisionToConference: Record<string, string> = {};
  for (const d of structure.divisions) {
    divisionToConference[d.name] = d.conferenceId;
  }

  // Fall back to the config's conference names (matched by code) if a feed ever
  // omits the conferences block; ids '00'/'01' have been stable since 2003.
  const conferenceName = (id: string): string =>
    structure.conferences.find((c) => c.id === id)?.name ??
    config.conferences?.find((c) => c.code === id)?.name ??
    id;

  const conferenceIds = [...new Set(structure.divisions.map((d) => d.conferenceId))];
  const conferences = conferenceIds.map((id) => ({
    name: conferenceName(id),
    code: id,
    divisions: structure.divisions.filter((d) => d.conferenceId === id).map((d) => d.name),
  }));

  return {
    ...config,
    teams: config.teams.map((team) => {
      const divisionId = structure.franchiseDivisions[team.franchiseId];
      const divisionName = divisionId != null ? divisionNameById.get(divisionId) : undefined;
      // A franchise the season's feed doesn't place (shouldn't happen — every
      // AFL season fields all 24 slots) keeps its config division.
      if (!divisionName) return team;
      return {
        ...team,
        division: divisionName,
        conference: divisionToConference[divisionName] ?? team.conference,
      };
    }),
    divisions: structure.divisions.map((d) => d.name),
    conferences,
    divisionToConference,
  };
}
