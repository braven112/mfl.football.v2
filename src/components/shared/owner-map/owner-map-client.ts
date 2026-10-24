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
 * with a count. That is MapLibre's GeoJSON clustering; the markers themselves
 * are HTML so team icons render as real images.
 */
import type { Map as MlMap, Marker, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import type { Topology } from 'topojson-specification';
import type { OwnerMapPin } from '../../../utils/owner-map';
import countriesUrl from 'world-atlas/countries-50m.json?url';
import statesUrl from 'us-atlas/states-10m.json?url';

type View = 'us' | 'world';

type Bounds = [[number, number], [number, number]];
/** Lower 48, framed so it fills a phone-width map as well as a desktop one. */
const US_BOUNDS: Bounds = [[-125, 24], [-66.5, 49.5]];
const WORLD_BOUNDS: Bounds = [[-165, -50], [170, 72]];
/** Room for half a 40px marker at the edge of the frame. */
const FIT_PADDING = 28;
/** The closest the map zooms. Pins are a hometown city, so street level has nothing to show. */
const MAX_ZOOM = 8;

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

function loadGeo(): Promise<Geo> {
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

function buildStyle(scope: HTMLElement, geo: Geo): StyleSpecification {
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

function pinsGeoJson(pins: OwnerMapPin[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin, index) => ({
      type: 'Feature',
      properties: { index },
      geometry: { type: 'Point', coordinates: [pin.city.lng, pin.city.lat] },
    })),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The round badge is the WRAPPER, not the img: seasonal themes restyle team
 * icons by their src (Halloween squares some of them off), and the badge must
 * stay a circle whatever the art does.
 */
function iconBadge(pin: OwnerMapPin): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'om-marker__icon';
  const img = document.createElement('img');
  img.src = pin.icon;
  img.alt = '';
  img.decoding = 'async';
  badge.appendChild(img);
  return badge;
}

function panelRowsHtml(pins: OwnerMapPin[]): string {
  const rows = pins
    .map(
      (pin) => `
        <a class="om-pop__row" href="${escapeHtml(pin.href)}">
          <img class="om-pop__icon" src="${escapeHtml(pin.icon)}" alt="" />
          <span class="om-pop__text">
            <span class="om-pop__team">${escapeHtml(pin.teamName)}</span>
            <span class="om-pop__meta">${escapeHtml(pin.ownerName)} · ${escapeHtml(pin.city.name)}, ${escapeHtml(pin.city.region)}</span>
          </span>
        </a>`,
    )
    .join('');
  return rows;
}

export async function mountOwnerMap(root: HTMLElement): Promise<() => void> {
  const canvasEl = root.querySelector<HTMLElement>('[data-owner-map-canvas]');
  const dataEl = root.querySelector<HTMLScriptElement>('[data-owner-map-pins]');
  if (!canvasEl || !dataEl) return () => {};
  const pins = JSON.parse(dataEl.textContent || '[]') as OwnerMapPin[];
  const panel = root.querySelector<HTMLElement>('[data-owner-map-panel]');
  const panelRows = root.querySelector<HTMLElement>('[data-owner-map-panel-rows]');
  const panelClose = root.querySelector<HTMLButtonElement>('[data-owner-map-panel-close]');

  const [{ default: maplibregl }, geo] = await Promise.all([
    import('maplibre-gl'),
    loadGeo(),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);

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

  const markers = new Map<string, Marker>();

  // The selected team(s) show in a card pinned to the bottom of the map
  // rather than a MapLibre popup: a popup anchored to a marker near the edge
  // of a phone-width map runs off the frame.
  function openPanel(group: OwnerMapPin[]) {
    if (!panel || !panelRows) return;
    panelRows.innerHTML = panelRowsHtml(group);
    panel.hidden = false;
  }
  function closePanel() {
    if (panel) panel.hidden = true;
  }
  panelClose?.addEventListener('click', closePanel);
  map.on('click', closePanel);

  function addPinLayer() {
    if (map.getSource('pins')) return;
    map.addSource('pins', {
      type: 'geojson',
      data: pinsGeoJson(pins),
      cluster: true,
      clusterRadius: 34,
      clusterMaxZoom: MAX_ZOOM,
    });
    // MapLibre only clusters a source that a layer draws; this one is invisible.
    map.addLayer({ id: 'pins-hit', type: 'circle', source: 'pins', paint: { 'circle-radius': 0, 'circle-opacity': 0 } });
  }

  async function syncMarkers() {
    const source = map.getSource('pins') as GeoJSONSource | undefined;
    if (!source || !map.isSourceLoaded('pins')) return;
    const seen = new Set<string>();
    for (const feature of map.querySourceFeatures('pins')) {
      const props = feature.properties as Record<string, unknown>;
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const isCluster = Boolean(props.cluster);
      const key = isCluster ? `c${props.cluster_id}` : `p${props.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (markers.has(key)) continue;

      const el = document.createElement('button');
      el.type = 'button';
      if (isCluster) {
        const clusterId = Number(props.cluster_id);
        const leaves = (await source.getClusterLeaves(clusterId, 50, 0)) as GeoJSON.Feature[];
        const group = leaves.map((leaf) => pins[Number(leaf.properties?.index)]).filter(Boolean);
        el.className = 'om-marker om-marker--group';
        el.setAttribute('aria-label', `${group.length} teams: ${group.map((p) => p.teamName).join(', ')}`);
        group.slice(0, 3).forEach((pin) => el.appendChild(iconBadge(pin)));
        const count = document.createElement('span');
        count.className = 'om-marker__count';
        count.textContent = String(group.length);
        el.appendChild(count);
        el.addEventListener('click', async (event) => {
          event.stopPropagation();
          const zoom = await source.getClusterExpansionZoom(clusterId);
          // Teams from the SAME city never separate; list them instead of zooming forever.
          if (zoom > MAX_ZOOM || map.getZoom() >= MAX_ZOOM - 0.5) openPanel(group);
          else map.easeTo({ center: coords, zoom });
        });
      } else {
        const pin = pins[Number(props.index)];
        if (!pin) continue;
        el.className = 'om-marker';
        el.setAttribute('aria-label', `${pin.teamName}, ${pin.city.name}`);
        el.appendChild(iconBadge(pin));
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          openPanel([pin]);
        });
      }
      markers.set(key, new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map));
    }
    for (const [key, marker] of markers) {
      if (!seen.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
  }

  let syncing = false;
  const onRender = () => {
    if (syncing) return;
    syncing = true;
    syncMarkers().finally(() => {
      syncing = false;
    });
  };

  map.on('load', addPinLayer);
  map.on('render', onRender);

  // Rebuild the colors when the theme flips. setStyle drops every source, so
  // the pin source is re-added once the new style is in.
  const themeKey = () =>
    `${document.documentElement.classList.contains('dark')}|${document.documentElement.dataset.league ?? ''}`;
  let lastTheme = themeKey();
  const themeObserver = new MutationObserver(() => {
    const next = themeKey();
    if (next === lastTheme) return;
    lastTheme = next;
    map.setStyle(buildStyle(canvasEl, geo));
    map.once('styledata', addPinLayer);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-league'] });

  const setView = (view: View) => {
    closePanel();
    map.fitBounds(view === 'us' ? US_BOUNDS : WORLD_BOUNDS, { padding: FIT_PADDING, speed: 1.6 });
    root.querySelectorAll<HTMLButtonElement>('[data-owner-map-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.ownerMapView === view));
    });
  };
  const viewButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-owner-map-view]'));
  const onViewClick = (event: Event) => setView((event.currentTarget as HTMLButtonElement).dataset.ownerMapView as View);
  viewButtons.forEach((button) => button.addEventListener('click', onViewClick));

  return () => {
    themeObserver.disconnect();
    viewButtons.forEach((button) => button.removeEventListener('click', onViewClick));
    panelClose?.removeEventListener('click', closePanel);
    markers.forEach((marker) => marker.remove());
    map.remove();
  };
}
