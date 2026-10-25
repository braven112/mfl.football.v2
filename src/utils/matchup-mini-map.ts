/**
 * Matchup mini map — a still picture of the Owner Map cropped to one game's
 * two hometowns, drawn on the server as SVG paths.
 *
 * The Matchup Preview article is public and shows a card per game, so it
 * cannot afford MapLibre (~220 KB + WebGL) on every card. This draws the same
 * bundled Natural Earth / US Census outlines the Owner Map paints, projected
 * with the same Web Mercator, so a card looks like a screenshot of the map
 * without loading it. The colors stay CSS tokens in the component, so it
 * follows the league theme and light/dark like the map does.
 *
 * Only the outlines near the frame are emitted: shapes outside it are dropped
 * by bounding box, and the points that remain are clamped to a margin just
 * past the frame and thinned to one per pixel, which keeps a card's paths to a
 * few KB instead of the whole world's.
 * Coordinates are whole viewBox units: a card is drawn about as wide as its
 * viewBox, so finer detail would not show.
 */
import { feature, mesh } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldTopo from 'world-atlas/countries-50m.json';
import usTopo from 'us-atlas/states-10m.json';

export const MINI_MAP_WIDTH = 320;
export const MINI_MAP_HEIGHT = 180;
/** Room around each pin so a 36px badge never touches the frame. */
const PAD = 34;
/** Pins closer than this (viewBox units, about a badge wide) are pushed apart. */
const MIN_PIN_GAP = 40;
/**
 * The smallest stretch of map a card shows, in Mercator units (the world is
 * 1 wide). About a 500-mile-wide frame at US latitudes: two teams from the
 * same city still get a map with a state line or a coast to place it, not a
 * blank patch of land.
 */
const MIN_SPAN = 1 / 2 ** 6;
/** Clamp margin past the frame, so a clamped edge is never inside the picture. */
const CLAMP = 8;
/** A point closer than this to the last one kept is dropped (viewBox units, about CSS px on a phone card). */
const MIN_STEP = 2;
const EARTH_RADIUS_MILES = 3958.8;
const ANTARCTICA_ID = '010';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MiniMapPin {
  /** Percent of the frame's width and height, so HTML badges can sit on top. */
  left: number;
  top: number;
  /** The same point in viewBox units, for the SVG line. */
  x: number;
  y: number;
}

export interface MiniMap {
  width: number;
  height: number;
  /** Country shapes, stroked for their coastlines and borders (one path, not a fill plus a mesh). */
  land: string;
  states: string;
  /** A gentle arc from A to B, the way the Owner Map's lines read. */
  route: string;
  a: MiniMapPin;
  b: MiniMapPin;
  miles: number;
}

type Ring = [number, number][];
interface Shape {
  bbox: [number, number, number, number];
  rings: Ring[];
}

/** Web Mercator, the world as a unit square (MapLibre's projection). */
function mercator(lng: number, lat: number): [number, number] {
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

function shapeOf(rings: Ring[]): Shape {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const projected = rings.map((ring) =>
    ring.map(([lng, lat]) => {
      const [x, y] = mercator(lng, lat);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      return [x, y] as [number, number];
    }),
  );
  return { bbox: [x0, y0, x1, y1], rings: projected };
}

/** Polygon rings (land) or line strings (borders), one Shape per part. */
function shapesOf(geometry: GeoJSON.Geometry | null): Shape[] {
  if (!geometry) return [];
  switch (geometry.type) {
    case 'Polygon':
      return [shapeOf(geometry.coordinates as Ring[])];
    case 'MultiPolygon':
      return geometry.coordinates.map((poly) => shapeOf(poly as Ring[]));
    case 'LineString':
      return [shapeOf([geometry.coordinates as Ring])];
    case 'MultiLineString':
      // One shape per line, so a crop keeps only the lines near it.
      return geometry.coordinates.map((line) => shapeOf([line as Ring]));
    default:
      return [];
  }
}

interface Geo {
  land: Shape[];
  states: Shape[];
}

let geo: Geo | null = null;

/** Decoded once per server instance; every card after the first is just a crop. */
function loadGeo(): Geo {
  if (geo) return geo;
  const world = worldTopo as unknown as Topology;
  const us = usTopo as unknown as Topology;
  const countries = feature(world, world.objects.countries as never) as unknown as GeoJSON.FeatureCollection;
  geo = {
    land: countries.features
      .filter((f) => String(f.id) !== ANTARCTICA_ID)
      .flatMap((f) => shapesOf(f.geometry)),
    // Interior state lines only, as on the Owner Map: the outer US border is a country line.
    states: shapesOf(mesh(us, us.objects.states as never, (a: unknown, b: unknown) => a !== b)),
  };
  return geo;
}

interface Frame {
  x0: number;
  y0: number;
  scale: number;
}

function toPath(shapes: Shape[], frame: Frame, closed: boolean): string {
  const { x0, y0, scale } = frame;
  const vx1 = x0 + MINI_MAP_WIDTH / scale;
  const vy1 = y0 + MINI_MAP_HEIGHT / scale;
  const parts: string[] = [];
  for (const shape of shapes) {
    const [bx0, by0, bx1, by1] = shape.bbox;
    if (bx1 < x0 || bx0 > vx1 || by1 < y0 || by0 > vy1) continue;
    for (const ring of shape.rings) {
      let d = '';
      let px = NaN, py = NaN, count = 0;
      for (const [mx, my] of ring) {
        const x = Math.round(Math.max(-CLAMP, Math.min(MINI_MAP_WIDTH + CLAMP, (mx - x0) * scale)));
        const y = Math.round(Math.max(-CLAMP, Math.min(MINI_MAP_HEIGHT + CLAMP, (my - y0) * scale)));
        if (Math.abs(x - px) < MIN_STEP && Math.abs(y - py) < MIN_STEP) continue;
        d += `${count ? 'L' : 'M'}${x} ${y}`;
        px = x;
        py = y;
        count++;
      }
      if (count < 2) continue;
      parts.push(closed ? `${d}Z` : d);
    }
  }
  return parts.join('');
}

/** Great-circle distance, rounded to the mile. */
export function milesBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * The frame that holds both pins with room for their badges, never zoomed in
 * past MIN_SPAN. Centered on the pair, so the line sits in the middle.
 */
function frameFor(pa: [number, number], pb: [number, number]): Frame {
  const spanX = Math.max(Math.abs(pa[0] - pb[0]), MIN_SPAN);
  const spanY = Math.max(Math.abs(pa[1] - pb[1]), MIN_SPAN * (MINI_MAP_HEIGHT / MINI_MAP_WIDTH));
  const scale = Math.min((MINI_MAP_WIDTH - PAD * 2) / spanX, (MINI_MAP_HEIGHT - PAD * 2) / spanY);
  const cx = (pa[0] + pb[0]) / 2;
  const cy = (pa[1] + pb[1]) / 2;
  return { x0: cx - MINI_MAP_WIDTH / 2 / scale, y0: cy - MINI_MAP_HEIGHT / 2 / scale, scale };
}

function pin(x: number, y: number): MiniMapPin {
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    left: Math.round((x / MINI_MAP_WIDTH) * 1000) / 10,
    top: Math.round((y / MINI_MAP_HEIGHT) * 1000) / 10,
  };
}

/** Everything a card needs to draw one game's map, or null without both hometowns. */
export function buildMiniMap(a: LatLng | null | undefined, b: LatLng | null | undefined): MiniMap | null {
  if (!a || !b || ![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;
  // The shorter way round: a Seattle team playing a Sydney one crosses the
  // Pacific, not the Atlantic.
  let bLng = b.lng;
  if (bLng - a.lng > 180) bLng -= 360;
  else if (a.lng - bLng > 180) bLng += 360;
  const pa = mercator(a.lng, a.lat);
  const pb = mercator(bLng, b.lat);
  const frame = frameFor(pa, pb);
  const { land, states } = loadGeo();

  let ax = (pa[0] - frame.x0) * frame.scale;
  let ay = (pa[1] - frame.y0) * frame.scale;
  let bx = (pb[0] - frame.x0) * frame.scale;
  let by = (pb[1] - frame.y0) * frame.scale;
  // Two teams from one city (or next door) would stack their badges: push
  // them apart along their own line, sideways when they share a point.
  const gap = Math.hypot(bx - ax, by - ay);
  if (gap < MIN_PIN_GAP) {
    const ux = gap > 0.5 ? (bx - ax) / gap : 1;
    const uy = gap > 0.5 ? (by - ay) / gap : 0;
    const push = (MIN_PIN_GAP - gap) / 2;
    ax -= ux * push;
    ay -= uy * push;
    bx += ux * push;
    by += uy * push;
  }

  // The arc bows a little to one side of the straight line, like a flight path.
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const len = Math.hypot(bx - ax, by - ay);
  const bow = Math.min(len * 0.18, 28);
  const nx = len ? -(by - ay) / len : 0;
  const ny = len ? (bx - ax) / len : 0;
  // Bow upward (toward the top of the frame) whichever way the pair runs.
  const sign = ny > 0 ? -1 : 1;
  const qx = mx + nx * bow * sign;
  const qy = my + ny * bow * sign;
  const f = (n: number) => (Math.round(n * 10) / 10).toString();

  return {
    width: MINI_MAP_WIDTH,
    height: MINI_MAP_HEIGHT,
    land: toPath(land, frame, true),
    states: toPath(states, frame, false),
    route: `M${f(ax)} ${f(ay)}Q${f(qx)} ${f(qy)} ${f(bx)} ${f(by)}`,
    a: pin(ax, ay),
    b: pin(bx, by),
    miles: milesBetween(a, b),
  };
}
