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

export function buildOwnerMapPins(
  data: OwnerTenuresFile,
  leagueSlug: string,
  franchiseHref: (franchiseId: string) => string,
): OwnerMapPin[] {
  const byTeam = new Map<string, OwnerTenuresFile['owners']>();
  for (const owner of data.owners) {
    if (!owner.isCurrent || !owner.currentFranchiseId) continue;
    const team = byTeam.get(owner.currentFranchiseId) ?? [];
    team.push(owner);
    byTeam.set(owner.currentFranchiseId, team);
  }
  return [...byTeam.entries()]
    .map(([franchiseId, owners]) => ({
      franchiseId,
      ownerName: owners.map((o) => o.displayName ?? o.title).join(' & '),
      teamName: owners[0].dominantName ?? owners[0].title,
      icon: owners[0].icon,
      href: franchiseHref(franchiseId),
      city: sampleCityFor(franchiseId, leagueSlug),
      isSample: true,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

export const cityLabel = (city: OwnerMapCity): string => `${city.name}, ${city.region}`;
