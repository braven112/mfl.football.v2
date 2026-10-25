/**
 * Owner Map — the pins the page draws, one per CURRENT team.
 *
 * A pin is the city a TEAM REPRESENTS, which each owner chooses — usually
 * where they grew up, not where they live now (Brandon, 2026-10-24: his team
 * is from Spokane though he lives in Seattle). So a pin is never an address,
 * and a co-owned franchise (TheLeague's Cowboy Up) is one pin, not two.
 *
 * Hometowns live in Redis (src/utils/owner-hometowns.ts), never in this
 * public repo. A team with none saved yet has `city: null`: it is listed as
 * still to pick, and drawn nowhere, rather than placed on a made-up city.
 */
import type { OwnerTenuresFile } from '../types/owner-tenures';
import { canonicalRivalryPair, computeRivalEntries, type Matchup } from './rivalries';

export interface OwnerMapCity {
  name: string;
  /** Region shown after the city: a US state code or a country. */
  region: string;
  lat: number;
  lng: number;
}

export interface OwnerMapPin {
  franchiseId: string;
  /** Every current owner of the team, joined ("A & B" for a co-owned team). */
  ownerName: string;
  teamName: string;
  icon: string;
  href: string;
  /** Null until the owner or the commissioner picks one. */
  city: OwnerMapCity | null;
  /** The division the team plays in today. */
  division: string | null;
  /** The conference's short label (AL / NL), for a league that has conferences. */
  conference: string | null;
  /** Titles the CURRENT owner won, the same list their owner page shows. */
  titles: number[];
  /** Completed seasons this owner reached the playoffs, with how far they got. */
  playoffs: { year: number; result: string }[];
  /** First season of this owner in the league. */
  ownerSince: number;
}

/** A team and its biggest rival, by the same intensity the rivalry pages rank on. */
export interface OwnerMapRivalry {
  a: string;
  b: string;
  aWins: number;
  bWins: number;
  ties: number;
  games: number;
}

export interface OwnerMapConference {
  name: string;
  short: string;
  divisions: string[];
}

export interface OwnerMapData {
  pins: OwnerMapPin[];
  /** Today's divisions, in the league's own order. */
  divisions: string[];
  /** Empty for a league with no conferences (TheLeague). */
  conferences: OwnerMapConference[];
  rivalries: OwnerMapRivalry[];
  /** Completed seasons, newest first: the Playoffs view's season pills. */
  seasons: number[];
  /** The league's first season, which makes an owner an original. */
  foundingYear: number;
  /** The signed-in viewer's own team in this league, or null. */
  myFranchiseId: string | null;
}

/** Just the parts of franchise-history.json the map reads. */
export interface OwnerMapHistory {
  yearsCovered: number[];
  yearSummaries: Record<string, { year: number; seasonComplete: boolean }> | { year: number; seasonComplete: boolean }[];
  franchises: Record<
    string,
    {
      franchiseId: string;
      currentDivision: string | null;
      yearByYear?: { year: number; divisionId: string | null; divisionName: string | null }[];
      matchupHistory?: Record<string, Matchup[]>;
    }
  >;
}

export function buildOwnerMapData(
  data: OwnerTenuresFile,
  history: OwnerMapHistory,
  options: {
    leagueSlug: string;
    franchiseHref: (franchiseId: string) => string;
    conferences?: OwnerMapConference[];
    myFranchiseId?: string | null;
    /** Saved hometowns by franchise id. */
    hometowns?: Record<string, OwnerMapCity>;
  },
): OwnerMapData {
  const conferences = options.conferences ?? [];
  const cityOf = (h: OwnerMapCity | undefined): OwnerMapCity | null =>
    h ? { name: h.name, region: h.region, lat: h.lat, lng: h.lng } : null;
  const conferenceOf = (division: string | null) =>
    conferences.find((c) => division !== null && c.divisions.includes(division))?.short ?? null;

  const seasons = Object.values(history.yearSummaries)
    .filter((y) => y.seasonComplete)
    .map((y) => y.year)
    .sort((a, b) => b - a);
  const completed = new Set(seasons);

  const byTeam = new Map<string, OwnerTenuresFile['owners']>();
  for (const owner of data.owners) {
    if (!owner.isCurrent || !owner.currentFranchiseId) continue;
    const team = byTeam.get(owner.currentFranchiseId) ?? [];
    team.push(owner);
    byTeam.set(owner.currentFranchiseId, team);
  }

  const pins: OwnerMapPin[] = [...byTeam.entries()]
    .map(([franchiseId, owners]) => {
      // A co-owned team's record counts in full for every co-owner, so the
      // first owner's totals are the team's.
      const lead = owners[0];
      const division = history.franchises[franchiseId]?.currentDivision ?? null;
      const playoffs = lead.tenures
        .flatMap((t) => t.seasons)
        .filter((s) => completed.has(s.year) && s.playoffResult && s.playoffResult !== 'missed')
        .map((s) => ({ year: s.year, result: s.playoffResult }))
        .sort((a, b) => b.year - a.year);
      return {
        franchiseId,
        ownerName: owners.map((o) => o.displayName ?? o.title).join(' & '),
        teamName: lead.dominantName ?? lead.title,
        icon: lead.icon,
        href: options.franchiseHref(franchiseId),
        city: cityOf(options.hometowns?.[franchiseId]),
        division,
        conference: conferenceOf(division),
        titles: [...lead.totals.championships].sort((a, b) => b - a),
        playoffs,
        ownerSince: Math.min(...owners.map((o) => o.yearStart)),
      };
    })
    .sort((a, b) => a.teamName.localeCompare(b.teamName));

  const current = new Set(pins.map((p) => p.franchiseId));
  const rivalries: OwnerMapRivalry[] = [];
  const seen = new Set<string>();
  for (const pin of pins) {
    const top = computeRivalEntries(history.franchises[pin.franchiseId]?.matchupHistory, pin.franchiseId).find((r) =>
      current.has(r.opponentId),
    );
    if (!top) continue;
    const key = canonicalRivalryPair(pin.franchiseId, top.opponentId);
    if (seen.has(key)) continue;
    seen.add(key);
    rivalries.push({
      a: pin.franchiseId,
      b: top.opponentId,
      aWins: top.wins,
      bWins: top.losses,
      ties: top.ties,
      games: top.games,
    });
  }

  // MFL numbers divisions in the league's own order (00, 01, …).
  const divisionIds = new Map<string, string>();
  for (const f of Object.values(history.franchises)) {
    const latest = [...(f.yearByYear ?? [])].sort((a, b) => b.year - a.year)[0];
    if (latest?.divisionName && latest.divisionId) divisionIds.set(latest.divisionName, latest.divisionId);
  }
  const divisionIdOf = (name: string) => divisionIds.get(name) ?? name;
  const divisionOrder = conferences.length
    ? conferences.flatMap((c) => c.divisions)
    : [...new Set(pins.map((p) => p.division).filter((d): d is string => Boolean(d)))].sort(
        (a, b) => divisionIdOf(a).localeCompare(divisionIdOf(b)) || a.localeCompare(b),
      );

  return {
    pins,
    divisions: divisionOrder.filter((d) => pins.some((p) => p.division === d)),
    conferences,
    rivalries,
    seasons,
    foundingYear: Math.min(...history.yearsCovered),
    myFranchiseId: options.myFranchiseId && current.has(options.myFranchiseId) ? options.myFranchiseId : null,
  };
}

/** "Spokane, WA", "New Mexico" (a whole state), "London, United Kingdom". */
export const cityLabel = (city: OwnerMapCity): string => (city.region === 'US' ? city.name : `${city.name}, ${city.region}`);
