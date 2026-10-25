/**
 * Owner Map — what each filter shows. Pure, so it is tested without a map.
 *
 * A view answers: which teams are on the map, what color ring each wears,
 * what small tag sits under a logo, which lines are drawn, and what the
 * legend and caption say. The MapLibre island (owner-map-client.ts) only
 * paints the answer.
 *
 * Colors are SLOTS (1-6), painted as `var(--chart-color-N)`; null means the
 * league accent. The same slot colors a division's ring, its pill and its
 * lines, so a color means one thing on the whole page.
 */
import { cityLabel, type OwnerMapData, type OwnerMapPin } from '../../../utils/owner-map';

export type MapMode = 'division' | 'conference' | 'mine' | 'rivalries' | 'champions' | 'playoffs' | 'tenure' | 'hometown';

export interface SubOption {
  id: string;
  label: string;
  slot?: number | null;
}

export interface MapLine {
  a: number;
  b: number;
  slot: number | null;
  /** 1 (a thin line) to 3 (the most meetings). */
  weight: number;
}

export interface LegendItem {
  label: string;
  slot: number | null;
  count?: number;
  kind: 'dot' | 'line';
}

export interface ViewResult {
  visible: number[];
  ring: Map<number, number | null>;
  tag: Map<number, string>;
  lines: MapLine[];
  legend: LegendItem[];
  caption: string;
  /** Zoom to the teams shown, rather than keeping the current area. */
  fit: boolean;
  /** The second line under a team's name in the tap card. */
  meta: (index: number) => string;
}

/** Playoff finishes, best first, each with its own slot. */
const FINISHES: { result: string; label: string; tag: string; slot: number }[] = [
  { result: 'champion', label: 'Champion', tag: '🏆', slot: 5 },
  { result: 'runner-up', label: 'Runner-up', tag: '2nd', slot: 1 },
  { result: 'third-place', label: 'Third place', tag: '3rd', slot: 3 },
  { result: 'playoffs', label: 'Made the playoffs', tag: '', slot: 6 },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every pair in a group, for drawing a division as a web of lines. */
function allPairs(indexes: number[], slot: number | null): MapLine[] {
  const lines: MapLine[] = [];
  for (let i = 0; i < indexes.length; i += 1) {
    for (let j = i + 1; j < indexes.length; j += 1) lines.push({ a: indexes[i], b: indexes[j], slot, weight: 1 });
  }
  return lines;
}

export function subOptions(data: OwnerMapData, mode: MapMode): SubOption[] {
  switch (mode) {
    case 'division':
      return [{ id: 'all', label: 'All' }, ...data.divisions.map((d, i) => ({ id: d, label: d, slot: i + 1 }))];
    case 'conference':
      return [{ id: 'all', label: 'All' }, ...data.conferences.map((c, i) => ({ id: c.short, label: c.name, slot: i + 1 }))];
    case 'playoffs':
      return data.seasons.map((year) => ({ id: String(year), label: String(year) }));
    case 'tenure':
      return [
        { id: 'all', label: 'All' },
        { id: 'original', label: `Since ${data.foundingYear}` },
        { id: 'later', label: 'Joined later' },
      ];
    default:
      return [];
  }
}

export const defaultSub = (data: OwnerMapData, mode: MapMode): string => subOptions(data, mode)[0]?.id ?? '';

export function computeView(data: OwnerMapData, mode: MapMode, sub: string, focus: number | null): ViewResult {
  const { pins } = data;
  // A team with no hometown yet has nowhere to be drawn.
  const all = pins.map((_, i) => i).filter((i) => pins[i].city);
  const divisionSlot = (pin: OwnerMapPin) => {
    const i = pin.division ? data.divisions.indexOf(pin.division) : -1;
    return i >= 0 ? i + 1 : null;
  };
  const byDivision = (indexes: number[]) => new Map(indexes.map((i) => [i, divisionSlot(pins[i])]));
  const inDivision = (division: string | null) => all.filter((i) => division !== null && pins[i].division === division);
  const divisionLegend = (indexes: number[]): LegendItem[] =>
    data.divisions
      .map((d, i) => ({ label: d, slot: i + 1, count: indexes.filter((x) => pins[x].division === d).length, kind: 'dot' as const }))
      .filter((item) => item.count > 0);
  const where = (pin: OwnerMapPin) => (pin.city ? `${pin.ownerName} · ${cityLabel(pin.city)}` : pin.ownerName);
  const base = { tag: new Map<number, string>(), lines: [] as MapLine[], fit: false, meta: (i: number) => where(pins[i]) };

  switch (mode) {
    case 'division': {
      if (sub !== 'all') {
        const visible = inDivision(sub);
        const slot = data.divisions.indexOf(sub) + 1 || null;
        return {
          ...base,
          visible,
          ring: byDivision(visible),
          lines: allPairs(visible, slot),
          legend: [],
          caption: `${sub}: ${plural(visible.length, 'team')}.`,
          fit: true,
          meta: (i) => `${where(pins[i])} · ${sub}`,
        };
      }
      // Tapping a team draws its own lines to the rest of its division.
      const focused = focus !== null && pins[focus]?.city ? pins[focus] : null;
      const lines = focused
        ? inDivision(focused.division)
            .filter((i) => i !== focus)
            .map((i) => ({ a: focus as number, b: i, slot: divisionSlot(focused), weight: 1 }))
        : [];
      return {
        ...base,
        visible: all,
        ring: byDivision(all),
        lines,
        legend: divisionLegend(all),
        caption: 'Tap a team to see its division, or pick one above.',
        meta: (i) => `${where(pins[i])} · ${pins[i].division ?? 'No division'}`,
      };
    }

    case 'conference': {
      if (sub !== 'all') {
        const visible = all.filter((i) => pins[i].conference === sub);
        const conference = data.conferences.find((c) => c.short === sub);
        return {
          ...base,
          visible,
          ring: byDivision(visible),
          legend: divisionLegend(visible),
          caption: `${conference?.name ?? sub}: ${plural(visible.length, 'team')}.`,
          fit: true,
          meta: (i) => `${where(pins[i])} · ${pins[i].division ?? ''}`,
        };
      }
      const slotOf = (pin: OwnerMapPin) => {
        const i = data.conferences.findIndex((c) => c.short === pin.conference);
        return i >= 0 ? i + 1 : null;
      };
      return {
        ...base,
        visible: all,
        ring: new Map(all.map((i) => [i, slotOf(pins[i])])),
        legend: data.conferences.map((c, i) => ({
          label: c.name,
          slot: i + 1,
          count: all.filter((x) => pins[x].conference === c.short).length,
          kind: 'dot' as const,
        })),
        caption: '',
        meta: (i) => `${where(pins[i])} · ${pins[i].conference ?? ''}`,
      };
    }

    case 'mine': {
      const me = pins.findIndex((p) => p.franchiseId === data.myFranchiseId);
      if (me < 0) return { ...base, visible: all, ring: byDivision(all), legend: [], caption: '' };
      if (!pins[me].city) {
        return { ...base, visible: inDivision(pins[me].division), ring: byDivision(all), legend: [], caption: 'Pick your hometown to put your team on the map.', fit: true };
      }
      const division = pins[me].division;
      const visible = inDivision(division);
      return {
        ...base,
        visible,
        ring: byDivision(visible),
        lines: visible.filter((i) => i !== me).map((i) => ({ a: me, b: i, slot: divisionSlot(pins[me]), weight: 2 })),
        legend: [],
        caption: `Your division${division ? `, the ${division}` : ''}: ${plural(visible.length, 'team')}.`,
        fit: true,
      };
    }

    case 'rivalries': {
      const indexOf = new Map(pins.map((p, i) => [p.franchiseId, i]));
      const most = Math.max(1, ...data.rivalries.map((r) => r.games));
      const lines = data.rivalries
        .map((r) => ({
          a: indexOf.get(r.a) ?? -1,
          b: indexOf.get(r.b) ?? -1,
          slot: null,
          weight: 1 + Math.round((r.games / most) * 2),
        }))
        .filter((line) => line.a >= 0 && line.b >= 0 && pins[line.a].city && pins[line.b].city)
        .filter((line) => focus === null || line.a === focus || line.b === focus);
      const rivalOf = (i: number) => {
        const id = pins[i].franchiseId;
        const own = data.rivalries.find((r) => r.a === id) ?? data.rivalries.find((r) => r.b === id);
        if (!own) return 'No rivalry yet';
        const flip = own.b === id;
        const rival = pins[indexOf.get(flip ? own.a : own.b) ?? -1];
        const [w, l] = flip ? [own.bWins, own.aWins] : [own.aWins, own.bWins];
        const record = own.ties ? `${w}-${l}-${own.ties}` : `${w}-${l}`;
        return `Biggest rival: ${rival?.teamName ?? 'unknown'}, ${record} in ${own.games} games`;
      };
      return {
        ...base,
        visible: all,
        ring: byDivision(all),
        lines,
        legend: [{ label: "Each team's biggest rival (thicker means more games)", slot: null, kind: 'line' }],
        caption: focus === null ? 'Tap a team to see only its rivalries.' : '',
        meta: rivalOf,
      };
    }

    case 'champions': {
      const visible = all.filter((i) => pins[i].titles.length > 0);
      const titles = visible.reduce((n, i) => n + pins[i].titles.length, 0);
      return {
        ...base,
        visible,
        ring: byDivision(visible),
        tag: new Map(visible.map((i) => [i, `🏆 ${pins[i].titles.length}`])),
        legend: divisionLegend(visible),
        caption: `${plural(visible.length, 'owner')} with a title, ${plural(titles, 'title')} between them. Counted for the current owner.`,
        meta: (i) => `${pins[i].ownerName} · Champion ${pins[i].titles.join(', ')}`,
      };
    }

    case 'playoffs': {
      const year = Number(sub) || data.seasons[0];
      const finish = (i: number) => pins[i].playoffs.find((p) => p.year === year)?.result;
      const visible = all.filter((i) => finish(i));
      const style = (i: number) => FINISHES.find((f) => f.result === finish(i)) ?? FINISHES[FINISHES.length - 1];
      return {
        ...base,
        visible,
        ring: new Map(visible.map((i) => [i, style(i).slot])),
        tag: new Map(visible.filter((i) => style(i).tag).map((i) => [i, style(i).tag])),
        legend: FINISHES.map((f) => ({
          label: f.label,
          slot: f.slot,
          count: visible.filter((i) => style(i).result === f.result).length,
          kind: 'dot' as const,
        })).filter((item) => item.count > 0),
        caption: `${year} playoff teams under their current owner: ${visible.length}.`,
        meta: (i) => `${pins[i].ownerName} · ${year}: ${style(i).label}`,
      };
    }

    case 'tenure': {
      const original = (i: number) => pins[i].ownerSince <= data.foundingYear;
      const visible = all.filter((i) => (sub === 'original' ? original(i) : sub === 'later' ? !original(i) : true));
      return {
        ...base,
        visible,
        ring: new Map(visible.map((i) => [i, original(i) ? 5 : 1])),
        tag: new Map(visible.map((i) => [i, String(pins[i].ownerSince)])),
        legend: [
          { label: `Original owners (${data.foundingYear})`, slot: 5, count: visible.filter(original).length, kind: 'dot' as const },
          { label: 'Joined later', slot: 1, count: visible.filter((i) => !original(i)).length, kind: 'dot' as const },
        ].filter((item) => item.count > 0),
        caption: '',
        meta: (i) => `${pins[i].ownerName} · Owner since ${pins[i].ownerSince}`,
      };
    }

    case 'hometown': {
      const missing = pins.filter((p) => !p.city);
      return {
        ...base,
        visible: all,
        ring: byDivision(all),
        legend: [],
        caption: missing.length
          ? `${all.length} of ${plural(pins.length, 'team')} have a hometown. Still to pick: ${missing.map((p) => p.teamName).join(', ')}.`
          : `Every team has a hometown.`,
      };
    }
  }
}

/**
 * Which part of the map a hometown belongs to, for grouping. Teams only stack
 * into one marker when they share an area, so Seattle never folds into Los
 * Angeles and Cleveland never into Florida, however far out the map is zoomed.
 * US cities go by state (Census divisions, with the Pacific split into the
 * Northwest and California); anywhere else by country. A whole-state or
 * whole-country pin stands alone.
 */
const STATE_AREA: Record<string, string> = {
  WA: 'northwest', OR: 'northwest', ID: 'northwest', AK: 'northwest',
  CA: 'california', NV: 'california', HI: 'california',
  AZ: 'southwest', NM: 'southwest',
  MT: 'mountain', WY: 'mountain', CO: 'mountain', UT: 'mountain',
  ND: 'plains', SD: 'plains', NE: 'plains', KS: 'plains', MN: 'plains', IA: 'plains', MO: 'plains',
  TX: 'south-central', OK: 'south-central', AR: 'south-central', LA: 'south-central',
  WI: 'great-lakes', MI: 'great-lakes', IL: 'great-lakes', IN: 'great-lakes', OH: 'great-lakes',
  KY: 'south', TN: 'south', MS: 'south', AL: 'south',
  FL: 'southeast', GA: 'southeast', SC: 'southeast', NC: 'southeast', VA: 'southeast',
  WV: 'southeast', MD: 'southeast', DE: 'southeast', DC: 'southeast',
  NY: 'mid-atlantic', NJ: 'mid-atlantic', PA: 'mid-atlantic',
  CT: 'new-england', RI: 'new-england', MA: 'new-england', VT: 'new-england', NH: 'new-england', ME: 'new-england',
};

export function pinArea(city: { name: string; region: string }): string {
  if (city.region === 'US' || city.region === '') return `whole:${city.name}`;
  return STATE_AREA[city.region] ?? `country:${city.region}`;
}

export interface ScreenPoint {
  index: number;
  x: number;
  y: number;
  area: string;
  lat: number;
  lng: number;
}

/** Teams farther apart than this on the ground never stack: about one metro area plus its suburbs. */
export const MAX_GROUP_KM = 200;

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Groups pins that would overlap on screen. A pin joins a group only when it
 * is within `radius` pixels of that group's FIRST pin, in the same area, and
 * within MAX_GROUP_KM of it on the ground (so Cleveland never folds into
 * Chicago, nor Spokane into Seattle, at a zoom where their icons touch);
 * measuring from the first pin rather than a moving middle keeps a group from
 * creeping across the map as it grows, which is how a cluster's marker ended
 * up a region away from every team in it.
 */
export function groupPins(points: ScreenPoint[], radius: number): number[][] {
  const groups: { anchor: ScreenPoint; members: number[] }[] = [];
  for (const point of points) {
    const group = groups.find(
      (g) =>
        g.anchor.area === point.area &&
        Math.hypot(g.anchor.x - point.x, g.anchor.y - point.y) <= radius &&
        kmBetween(g.anchor, point) <= MAX_GROUP_KM,
    );
    if (group) group.members.push(point.index);
    else groups.push({ anchor: point, members: [point.index] });
  }
  return groups.map((g) => g.members);
}
