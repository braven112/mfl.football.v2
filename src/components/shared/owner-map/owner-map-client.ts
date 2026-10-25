/**
 * Owner Map — the MapLibre island.
 *
 * Everything the map draws is bundled with the site: country outlines from
 * `world-atlas` and US state lines from `us-atlas` (Natural Earth / US Census
 * data), emitted as hashed static assets by Vite. There is no tile server and
 * no API key, so the map has no third-party dependency at runtime. It also has
 * no text layers, because MapLibre text needs a glyph server; every label on
 * the map is an HTML marker instead.
 *
 * The map's colors are read from the page's own tokens (`--card-bg`,
 * `--content-border`, …) when it is built, and rebuilt when `html.dark`
 * toggles, so it follows the league theme and the light/dark switch without a
 * second copy of the palette in a style file.
 *
 * Grouping: teams whose pins would overlap are drawn as one stacked marker
 * with a count, but only within one part of the map (groupPins, pinArea in
 * owner-map-views.ts). MapLibre's own clustering chained far-apart teams into
 * one marker placed at their average, which put Cleveland in the Southeast.
 * The markers are HTML so team icons render as real images.
 *
 * Filters (divisions, rivalries, champions, …) are decided in
 * owner-map-views.ts; this file paints what a view returns.
 */
import type { Map as MlMap, Marker, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import type { Topology } from 'topojson-specification';
import type { OwnerMapData, OwnerMapPin } from '../../../utils/owner-map';
import { computeView, defaultSub, groupPins, pinArea, subOptions, type MapMode, type ViewResult } from './owner-map-views';
import countriesUrl from 'world-atlas/countries-50m.json?url';
import statesUrl from 'us-atlas/states-10m.json?url';

type View = 'us' | 'world';

export type Bounds = [[number, number], [number, number]];
/** Lower 48, framed so it fills a phone-width map as well as a desktop one. */
export const US_BOUNDS: Bounds = [[-125, 24], [-66.5, 49.5]];
const WORLD_BOUNDS: Bounds = [[-165, -50], [170, 72]];
/** Room for half a 40px marker at the edge of the frame. */
const FIT_PADDING = 28;
/** The closest the map zooms. Pins are a hometown city, so street level has nothing to show. */
const MAX_ZOOM = 8;
/** Pins closer than this on screen (about one marker wide) stack into one. */
const GROUP_RADIUS = 44;
/** Below this zoom (the whole country) markers draw smaller (`owner-map--far`), so they stack sooner. */
const FAR_ZOOM = 4;
const FAR_GROUP_RADIUS = 34;

const ANTARCTICA_ID = '010';

interface Geo {
  countries: GeoJSON.FeatureCollection;
  borders: GeoJSON.FeatureCollection;
  states: GeoJSON.FeatureCollection;
}

let geoPromise: Promise<Geo> | null = null;

function lineCollection(geometry: GeoJSON.Geometry): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
}

/**
 * A ring that wraps the antimeridian (Russia's Chukotka, Fiji) jumps from
 * +180 to -180 inside one polygon, which fills as a sliver across the whole
 * map. Moving that ring's western points past +180 keeps it one shape; the
 * moved part sits just off the right edge, which a map that does not repeat
 * the world never shows.
 */
function unwrapAntimeridian(feature: GeoJSON.Feature): GeoJSON.Feature {
  const g = feature.geometry;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return feature;
  const fixRing = (ring: GeoJSON.Position[]) => {
    const wraps = ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180);
    return wraps ? ring.map(([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat]) : ring;
  };
  const geometry: GeoJSON.Geometry =
    g.type === 'Polygon'
      ? { type: 'Polygon', coordinates: g.coordinates.map(fixRing) }
      : { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map(fixRing)) };
  return { ...feature, geometry };
}

function splitAtAntimeridian(lines: GeoJSON.MultiLineString): GeoJSON.MultiLineString {
  const out: GeoJSON.Position[][] = [];
  for (const line of lines.coordinates) {
    let current: GeoJSON.Position[] = [];
    for (const point of line) {
      const prev = current[current.length - 1];
      if (prev && Math.abs(point[0] - prev[0]) > 180) {
        if (current.length > 1) out.push(current);
        current = [];
      }
      current.push(point);
    }
    if (current.length > 1) out.push(current);
  }
  return { type: 'MultiLineString', coordinates: out };
}

export function loadGeo(): Promise<Geo> {
  geoPromise ??= (async () => {
    const { feature, mesh } = await import('topojson-client');
    const [world, us] = await Promise.all([
      fetch(countriesUrl).then((r) => r.json() as Promise<Topology>),
      fetch(statesUrl).then((r) => r.json() as Promise<Topology>),
    ]);
    const all = feature(world, world.objects.countries as never) as unknown as GeoJSON.FeatureCollection;
    // Antarctica's ring runs to the pole and fills as a band across the
    // bottom of a Mercator map; nobody's team is from there.
    const countries: GeoJSON.FeatureCollection = {
      ...all,
      features: all.features.filter((f) => String(f.id) !== ANTARCTICA_ID).map(unwrapAntimeridian),
    };
    // Borders are drawn as lines from the mesh, split wherever a segment wraps
    // the antimeridian (Russia, Fiji, the Aleutians): unsplit, each one draws a straight line
    // across the whole map.
    const borders = splitAtAntimeridian(
      mesh(world, world.objects.countries as never, (a: unknown) => (a as { id?: string }).id !== ANTARCTICA_ID),
    );
    // Interior state borders only: the outer US border already comes from the country lines.
    const stateLines = splitAtAntimeridian(mesh(us, us.objects.states as never, (a: unknown, b: unknown) => a !== b));
    return {
      countries,
      borders: lineCollection(borders),
      states: lineCollection(stateLines),
    };
  })();
  return geoPromise;
}

/**
 * A token resolved to a solid color MapLibre can paint. Tokens can be a var()
 * chain, a color-mix(), or (card backgrounds in some themes) a gradient, so the
 * browser resolves it on a probe inside the map frame, where the frame's own
 * tokens apply. A gradient is not a valid background-color and computes to
 * transparent, which moves on to the next candidate. The result is painted to
 * a 1px canvas and read back as rgb(), the one form MapLibre always parses
 * (Chrome reports a color-mix() as `color(srgb …)`).
 */
function solidToken(scope: HTMLElement, names: string[], fallback: string): string {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  scope.appendChild(probe);
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  try {
    for (const name of names) {
      probe.style.backgroundColor = '';
      probe.style.backgroundColor = `var(${name})`;
      const color = getComputedStyle(probe).backgroundColor;
      if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') continue;
      if (!ctx) return color;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    }
    return fallback;
  } finally {
    probe.remove();
  }
}

export function buildStyle(scope: HTMLElement, geo: Geo): StyleSpecification {
  // Land is the content surface lifted toward the text color, so it reads
  // against the water in every theme without a hand-picked pair per league.
  const water = solidToken(scope, ['--content-bg', '--content-bg-muted'], '#ffffff');
  const land = solidToken(scope, ['--om-land'], '#eef1f5');
  const border = solidToken(scope, ['--om-border', '--content-border'], '#c5cad3');
  return {
    version: 8,
    sources: {
      countries: { type: 'geojson', data: geo.countries },
      borders: { type: 'geojson', data: geo.borders },
      states: { type: 'geojson', data: geo.states },
    },
    layers: [
      { id: 'water', type: 'background', paint: { 'background-color': water } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': land } },
      { id: 'country-lines', type: 'line', source: 'borders', paint: { 'line-color': border, 'line-width': 0.8 } },
      {
        id: 'state-lines',
        type: 'line',
        source: 'states',
        paint: { 'line-color': border, 'line-width': 0.5, 'line-opacity': 0.8 },
      },
    ],
  };
}

const slotVar = (slot: number | null | undefined) => (slot ? `var(--chart-color-${slot})` : 'var(--league-accent)');

/**
 * Pins arrive as JSON text from the page, so every URL in one is re-checked
 * before it reaches an attribute: only a same-origin path or an https URL is
 * used, never a `javascript:` or `data:` one.
 */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'https:' || url.origin === window.location.origin) return url.href;
  } catch {
    // fall through
  }
  return '';
}

function iconImg(pin: OwnerMapPin, className?: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = safeUrl(pin.icon);
  img.alt = '';
  img.decoding = 'async';
  if (className) img.className = className;
  return img;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * The round badge is the WRAPPER, not the img: seasonal themes restyle team
 * icons by their src (Halloween squares some of them off), and the badge must
 * stay a circle whatever the art does.
 */
function iconBadge(pin: OwnerMapPin, slot: number | null | undefined): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'om-marker__icon';
  badge.style.setProperty('--om-ring', slotVar(slot));
  badge.appendChild(iconImg(pin));
  return badge;
}

function panelRow(pin: OwnerMapPin, meta: string): HTMLAnchorElement {
  const row = document.createElement('a');
  row.className = 'om-pop__row';
  row.href = safeUrl(pin.href);
  row.appendChild(iconImg(pin, 'om-pop__icon'));
  const text = span('om-pop__text', '');
  text.append(
    span('om-pop__team', pin.teamName),
    span('om-pop__meta', meta),
  );
  row.appendChild(text);
  return row;
}

function pillButton(label: string, pressed: boolean, slot?: number | null): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-pill';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(pressed));
  if (slot) button.style.setProperty('--ui-pill-tone', slotVar(slot));
  return button;
}

function legendItem(item: ViewResult['legend'][number]): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'om-legend__item';
  const mark = span(item.kind === 'line' ? 'om-legend__line' : 'om-legend__swatch', '');
  mark.style.setProperty('--om-ring', slotVar(item.slot));
  li.append(mark, span('', item.label));
  if (item.count !== undefined) li.append(span('om-legend__count', String(item.count)));
  return li;
}

export async function mountOwnerMap(root: HTMLElement): Promise<() => void> {
  const canvasEl = root.querySelector<HTMLElement>('[data-owner-map-canvas]');
  const dataEl = root.querySelector<HTMLScriptElement>('[data-owner-map-data]');
  if (!canvasEl || !dataEl) return () => {};
  const data = JSON.parse(dataEl.textContent || '{}') as OwnerMapData;
  const { pins } = data;
  const panel = root.querySelector<HTMLElement>('[data-owner-map-panel]');
  const panelRows = root.querySelector<HTMLElement>('[data-owner-map-panel-rows]');
  const panelClose = root.querySelector<HTMLButtonElement>('[data-owner-map-panel-close]');
  const subBar = root.querySelector<HTMLElement>('[data-owner-map-sub]');
  const legendEl = root.querySelector<HTMLElement>('[data-owner-map-legend]');
  const captionEl = root.querySelector<HTMLElement>('[data-owner-map-caption]');
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-owner-map-row]'));

  // MapLibre 5 draws with WebGL 2 only; say so plainly rather than let the
  // constructor fail with a GL error.
  if (!document.createElement('canvas').getContext('webgl2')) {
    throw new Error('This browser has WebGL 2 turned off or unsupported, which the map needs.');
  }

  // MapLibre's stylesheet is imported by OwnerMapPage.astro, not here: a
  // dynamic import() of a .css file built to a manifest entry naming a JS
  // chunk that was never emitted, so on Vercel it 404'd and the map never
  // started.
  const [{ default: maplibregl }, geo] = await Promise.all([import('maplibre-gl'), loadGeo()]);

  const map: MlMap = new maplibregl.Map({
    container: canvasEl,
    style: buildStyle(canvasEl, geo),
    bounds: US_BOUNDS,
    fitBoundsOptions: { padding: FIT_PADDING },
    maxZoom: MAX_ZOOM,
    renderWorldCopies: false,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(
    new maplibregl.AttributionControl({ compact: true, customAttribution: 'Natural Earth · US Census' }),
    'bottom-right',
  );

  let mode: MapMode = 'division';
  let sub = defaultSub(data, mode);
  let focus: number | null = null;
  // `?division=North` opens on that division (the franchise pages link here).
  const wantedDivision = new URLSearchParams(window.location.search).get('division');
  if (wantedDivision && data.divisions.includes(wantedDivision)) sub = wantedDivision;
  let view = computeView(data, mode, sub, focus);

  const markers = new Map<string, Marker>();
  const clearMarkers = () => {
    markers.forEach((marker) => marker.remove());
    markers.clear();
  };

  // The selected team(s) show in a card pinned to the bottom of the map
  // rather than a MapLibre popup: a popup anchored to a marker near the edge
  // of a phone-width map runs off the frame.
  function openPanel(group: number[]) {
    if (!panel || !panelRows) return;
    panelRows.replaceChildren(...group.map((i) => panelRow(pins[i], view.meta(i))));
    panel.hidden = false;
  }
  function closePanel() {
    if (panel) panel.hidden = true;
    if (focus !== null) {
      focus = null;
      render(false);
    }
  }
  panelClose?.addEventListener('click', closePanel);
  map.on('click', closePanel);

  // Line colors must be solid for MapLibre, so each slot is resolved once per
  // theme, like the land and water.
  let lineColors = new Map<string, string>();
  const resolveLineColors = () => {
    lineColors = new Map();
    lineColors.set('accent', solidToken(canvasEl, ['--league-accent', '--color-primary'], '#3b6b9a'));
    for (let slot = 1; slot <= 6; slot += 1) {
      lineColors.set(String(slot), solidToken(canvasEl, [`--chart-color-${slot}`], '#3b6b9a'));
    }
  };
  resolveLineColors();

  function linesGeoJson(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
    return {
      type: 'FeatureCollection',
      features: view.lines.map((line) => ({
        type: 'Feature',
        properties: {
          color: lineColors.get(line.slot ? String(line.slot) : 'accent'),
          width: 1 + line.weight,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [pins[line.a].city!.lng, pins[line.a].city!.lat],
            [pins[line.b].city!.lng, pins[line.b].city!.lat],
          ],
        },
      })),
    };
  }

  function addPinLayer() {
    if (map.getSource('links')) return;
    map.addSource('links', { type: 'geojson', data: linesGeoJson() });
    map.addLayer({
      id: 'links',
      type: 'line',
      source: 'links',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.85 },
    });
  }

  /**
   * Draws the visible teams as markers, stacking the ones that would overlap
   * at this zoom (groupPins). Regrouped when the zoom settles, not on every
   * frame: panning never changes which pins overlap.
   */
  function syncMarkers() {
    const far = map.getZoom() < FAR_ZOOM;
    if (root.classList.contains('owner-map--far') !== far) {
      root.classList.toggle('owner-map--far', far);
      clearMarkers();
    }
    const points = view.visible.map((index) => {
      const city = pins[index].city!;
      const { x, y } = map.project([city.lng, city.lat]);
      return { index, x, y, area: pinArea(city), lat: city.lat, lng: city.lng };
    });
    const seen = new Set<string>();
    for (const group of groupPins(points, far ? FAR_GROUP_RADIUS : GROUP_RADIUS)) {
      const key = group.join(',');
      seen.add(key);
      if (markers.has(key)) continue;
      const lng = group.reduce((sum, i) => sum + pins[i].city!.lng, 0) / group.length;
      const lat = group.reduce((sum, i) => sum + pins[i].city!.lat, 0) / group.length;

      const el = document.createElement('button');
      el.type = 'button';
      if (group.length > 1) {
        el.className = 'om-marker om-marker--group';
        el.setAttribute('aria-label', `${group.length} teams: ${group.map((i) => pins[i].teamName).join(', ')}`);
        group.slice(0, 3).forEach((i) => el.appendChild(iconBadge(pins[i], view.ring.get(i))));
        const count = document.createElement('span');
        count.className = 'om-marker__count';
        count.textContent = String(group.length);
        el.appendChild(count);
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const sameSpot = group.every(
            (i) => pins[i].city!.lng === pins[group[0]].city!.lng && pins[i].city!.lat === pins[group[0]].city!.lat,
          );
          // Teams from the SAME city never separate; list them instead of zooming forever.
          if (sameSpot || map.getZoom() >= MAX_ZOOM - 0.5) {
            openPanel(group);
            return;
          }
          let [w, s, e, n] = [180, 90, -180, -90];
          for (const i of group) {
            const city = pins[i].city!;
            [w, s, e, n] = [Math.min(w, city.lng), Math.min(s, city.lat), Math.max(e, city.lng), Math.max(n, city.lat)];
          }
          map.fitBounds([[w, s], [e, n]], { padding: FIT_PADDING * 3, maxZoom: MAX_ZOOM, speed: 1.6 });
        });
      } else {
        const index = group[0];
        const pin = pins[index];
        el.className = pin.franchiseId === data.myFranchiseId ? 'om-marker om-marker--mine' : 'om-marker';
        el.setAttribute('aria-label', `${pin.teamName}, ${pin.city?.name ?? ''}`);
        el.appendChild(iconBadge(pin, view.ring.get(index)));
        const tag = view.tag.get(index);
        if (tag) el.appendChild(span('om-marker__tag', tag));
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          // Divisions and rivalries draw the tapped team's own lines.
          if (focus !== index) {
            focus = index;
            render(false);
          }
          openPanel([index]);
        });
      }
      markers.set(key, new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
    }
    for (const [key, marker] of markers) {
      if (!seen.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
  }

  map.on('load', () => {
    addPinLayer();
    if (view.fit) fitToVisible();
    syncMarkers();
  });
  map.on('zoomend', syncMarkers);

  function fitToVisible() {
    if (view.visible.length < 2) return;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const i of view.visible) {
      const { lng, lat } = pins[i].city!;
      w = Math.min(w, lng);
      e = Math.max(e, lng);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: FIT_PADDING * 2, maxZoom: 6, speed: 1.6 },
    );
  }

  function renderControls() {
    root.querySelectorAll<HTMLButtonElement>('[data-owner-map-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.ownerMapMode === mode));
    });
    subBar?.replaceChildren(
      ...subOptions(data, mode).map((option) => {
        const button = pillButton(option.label, option.id === sub, option.slot);
        button.addEventListener('click', () => {
          sub = option.id;
          focus = null;
          render(true);
        });
        return button;
      }),
    );
    legendEl?.replaceChildren(...view.legend.map(legendItem));
    if (captionEl) captionEl.textContent = view.caption;
    const shown = new Set(view.visible.map((i) => pins[i].franchiseId));
    rows.forEach((row) => {
      row.hidden = !shown.has(row.dataset.ownerMapRow ?? '');
    });
  }

  /** Recompute the view and repaint. `refit` moves the map to the teams shown. */
  function render(refit: boolean) {
    view = computeView(data, mode, sub, focus);
    const linkSource = map.getSource('links') as GeoJSONSource | undefined;
    if (map.loaded()) {
      clearMarkers();
      syncMarkers();
    }
    linkSource?.setData(linesGeoJson());
    if (focus === null) renderControls();
    if (refit && view.fit) fitToVisible();
    else if (refit) setView(currentArea, false);
  }

  const onModeClick = (event: Event) => {
    closePanelOnly();
    mode = (event.currentTarget as HTMLButtonElement).dataset.ownerMapMode as MapMode;
    sub = defaultSub(data, mode);
    focus = null;
    render(true);
  };
  const modeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-owner-map-mode]'));
  modeButtons.forEach((button) => button.addEventListener('click', onModeClick));
  function closePanelOnly() {
    if (panel) panel.hidden = true;
  }
  renderControls();

  // Rebuild the colors when the theme flips. setStyle drops every source, so
  // the pin and line sources are re-added once the new style is in.
  const themeKey = () =>
    `${document.documentElement.classList.contains('dark')}|${document.documentElement.dataset.league ?? ''}`;
  let lastTheme = themeKey();
  const themeObserver = new MutationObserver(() => {
    const next = themeKey();
    if (next === lastTheme) return;
    lastTheme = next;
    resolveLineColors();
    clearMarkers();
    map.setStyle(buildStyle(canvasEl, geo));
    map.once('styledata', () => {
      addPinLayer();
      syncMarkers();
    });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-league'] });

  let currentArea: View = 'us';
  function setView(area: View, close = true) {
    currentArea = area;
    if (close) closePanelOnly();
    map.fitBounds(area === 'us' ? US_BOUNDS : WORLD_BOUNDS, { padding: FIT_PADDING, speed: 1.6 });
    root.querySelectorAll<HTMLButtonElement>('[data-owner-map-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.ownerMapView === area));
    });
  }
  const viewButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-owner-map-view]'));
  const onViewClick = (event: Event) => setView((event.currentTarget as HTMLButtonElement).dataset.ownerMapView as View);
  viewButtons.forEach((button) => button.addEventListener('click', onViewClick));

  return () => {
    themeObserver.disconnect();
    viewButtons.forEach((button) => button.removeEventListener('click', onViewClick));
    modeButtons.forEach((button) => button.removeEventListener('click', onModeClick));
    panelClose?.removeEventListener('click', closePanel);
    clearMarkers();
    map.remove();
  };
}

/**
 * The small map on a franchise page: the team's hometown and the country
 * around it, nothing to tap. Same bundled data and token colors as the
 * Owner Map, so it follows the theme the same way.
 */
export async function mountMiniMap(el: HTMLElement): Promise<() => void> {
  const lat = Number(el.dataset.lat);
  const lng = Number(el.dataset.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return () => {};
  if (!document.createElement('canvas').getContext('webgl2')) {
    throw new Error('This browser has WebGL 2 turned off or unsupported, which the map needs.');
  }
  const [{ default: maplibregl }, geo] = await Promise.all([import('maplibre-gl'), loadGeo()]);
  const map: MlMap = new maplibregl.Map({
    container: el,
    style: buildStyle(el, geo),
    center: [lng, lat],
    // A whole state or country is pinned at its middle, so show all of it, not a town's worth.
    zoom: el.dataset.kind === 'country' ? 2.2 : el.dataset.kind === 'state' ? 3.6 : 4.2,
    interactive: false,
    renderWorldCopies: false,
    attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Natural Earth · US Census' }), 'bottom-right');

  const marker = document.createElement('span');
  marker.className = 'om-marker';
  const badge = document.createElement('span');
  badge.className = 'om-marker__icon';
  const img = document.createElement('img');
  img.src = safeUrl(el.dataset.icon ?? '');
  img.alt = '';
  badge.appendChild(img);
  marker.appendChild(badge);
  const pin = new maplibregl.Marker({ element: marker }).setLngLat([lng, lat]).addTo(map);

  const themeKey = () =>
    `${document.documentElement.classList.contains('dark')}|${document.documentElement.dataset.league ?? ''}`;
  let lastTheme = themeKey();
  const themeObserver = new MutationObserver(() => {
    const next = themeKey();
    if (next === lastTheme) return;
    lastTheme = next;
    map.setStyle(buildStyle(el, geo));
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-league'] });

  return () => {
    themeObserver.disconnect();
    pin.remove();
    map.remove();
  };
}
