/**
 * Owner Map — the pins the page draws, one per CURRENT team.
 *
 * A pin is the city a TEAM REPRESENTS, which each owner chooses — usually
 * where they grew up, not where they live now (Brandon, 2026-10-24: his team
 * is from Spokane though he lives in Seattle). So a pin is never an address,
 * and a co-owned franchise (TheLeague's Cowboy Up) is one pin, not two.
 *
 * Hometowns are SAMPLE data for now: none is stored anywhere yet. Until owners
 * pick theirs, every team is placed on a sample city so the map can be judged.
 * The page says so on screen; `isSample` is what it reads.
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
  city: OwnerMapCity;
  isSample: boolean;
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

/**
 * Sample cities. Weighted to the west coast where most teams plausibly are,
 * with near neighbors (Seattle, Tacoma, Bellevue) so grouping can be seen, and
 * a few abroad so the world view has something to show.
 */
export const SAMPLE_CITIES: readonly OwnerMapCity[] = [
  { name: 'Seattle', region: 'WA', lat: 47.6062, lng: -122.3321 },
  { name: 'Tacoma', region: 'WA', lat: 47.2529, lng: -122.4443 },
  { name: 'Bellevue', region: 'WA', lat: 47.6101, lng: -122.2015 },
  { name: 'Spokane', region: 'WA', lat: 47.6588, lng: -117.426 },
  { name: 'Portland', region: 'OR', lat: 45.5152, lng: -122.6784 },
  { name: 'Boise', region: 'ID', lat: 43.615, lng: -116.2023 },
  { name: 'Sacramento', region: 'CA', lat: 38.5816, lng: -121.4944 },
  { name: 'San Jose', region: 'CA', lat: 37.3382, lng: -121.8863 },
  { name: 'Los Angeles', region: 'CA', lat: 34.0522, lng: -118.2437 },
  { name: 'San Diego', region: 'CA', lat: 32.7157, lng: -117.1611 },
  { name: 'Las Vegas', region: 'NV', lat: 36.1699, lng: -115.1398 },
  { name: 'Phoenix', region: 'AZ', lat: 33.4484, lng: -112.074 },
  { name: 'Denver', region: 'CO', lat: 39.7392, lng: -104.9903 },
  { name: 'Dallas', region: 'TX', lat: 32.7767, lng: -96.797 },
  { name: 'Austin', region: 'TX', lat: 30.2672, lng: -97.7431 },
  { name: 'Des Moines', region: 'IA', lat: 41.5868, lng: -93.625 },
  { name: 'Minneapolis', region: 'MN', lat: 44.9778, lng: -93.265 },
  { name: 'Chicago', region: 'IL', lat: 41.8781, lng: -87.6298 },
  { name: 'Nashville', region: 'TN', lat: 36.1627, lng: -86.7816 },
  { name: 'Atlanta', region: 'GA', lat: 33.749, lng: -84.388 },
  { name: 'New York', region: 'NY', lat: 40.7128, lng: -74.006 },
  { name: 'Toronto', region: 'Canada', lat: 43.6532, lng: -79.3832 },
  { name: 'London', region: 'United Kingdom', lat: 51.5072, lng: -0.1276 },
  { name: 'Tokyo', region: 'Japan', lat: 35.6762, lng: 139.6503 },
];

/** Stable string hash, so a team keeps the same sample city across builds. */
function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

export function sampleCityFor(franchiseId: string, leagueSlug: string): OwnerMapCity {
  return SAMPLE_CITIES[hashString(`${leagueSlug}:${franchiseId}`) % SAMPLE_CITIES.length];
}

export function buildOwnerMapData(
  data: OwnerTenuresFile,
  history: OwnerMapHistory,
  options: {
    leagueSlug: string;
    franchiseHref: (franchiseId: string) => string;
    conferences?: OwnerMapConference[];
    myFranchiseId?: string | null;
  },
): OwnerMapData {
  const conferences = options.conferences ?? [];
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
        city: sampleCityFor(franchiseId, options.leagueSlug),
        isSample: true,
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

export const cityLabel = (city: OwnerMapCity): string => `${city.name}, ${city.region}`;
