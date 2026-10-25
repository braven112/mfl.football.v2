/**
 * The Pecking Order map — a still map of the week's order at each team's
 * hometown. Same bundled map data and token colors as the Owner Map
 * (owner-map-client.ts); what each view draws is decided in
 * pecking-order-map-views.ts.
 *
 * Still, not draggable: it sits in the middle of a column people scroll on
 * phones, and a draggable map there catches the scroll. Each logo is a link
 * to its team instead.
 *
 * Always framed on the lower 48. A team from abroad (TheLeague has one in
 * Sydney) would otherwise pull the frame out to the whole world and shrink
 * every US pin to a dot, so a highlighted team outside the frame is shown as
 * a chip in the corner, with its city, instead.
 */
import type { Map as MlMap, Marker } from 'maplibre-gl';
import { buildStyle, loadGeo, safeUrl, US_BOUNDS, type Bounds } from './owner-map-client';
import { computeRankView, type RankMapMode, type RankMapPin } from './pecking-order-map-views';

const FIT_PADDING = 36;

const inside = ([[w, s], [e, n]]: Bounds, lng: number, lat: number) => lng >= w && lng <= e && lat >= s && lat <= n;

export async function mountRankMap(root: HTMLElement): Promise<() => void> {
  const canvasEl = root.querySelector<HTMLElement>('[data-rank-map-canvas]');
  const dataEl = root.querySelector<HTMLScriptElement>('[data-rank-map-data]');
  const captionEl = root.querySelector<HTMLElement>('[data-rank-map-caption]');
  const awayEl = root.querySelector<HTMLElement>('[data-rank-map-away]');
  if (!canvasEl || !dataEl) return () => {};
  const pins = JSON.parse(dataEl.textContent || '[]') as RankMapPin[];

  if (!document.createElement('canvas').getContext('webgl2')) {
    throw new Error('This browser has WebGL 2 turned off or unsupported, which the map needs.');
  }
  const [{ default: maplibregl }, geo] = await Promise.all([import('maplibre-gl'), loadGeo()]);

  const map: MlMap = new maplibregl.Map({
    container: canvasEl,
    style: buildStyle(canvasEl, geo),
    bounds: US_BOUNDS,
    fitBoundsOptions: { padding: FIT_PADDING },
    interactive: false,
    renderWorldCopies: false,
    attributionControl: false,
  });
  map.addControl(
    new maplibregl.AttributionControl({ compact: true, customAttribution: 'Natural Earth · US Census' }),
    'bottom-right',
  );

  let mode: RankMapMode = 'top';
  const markers: Marker[] = [];

  function render() {
    const view = computeRankView(pins, mode);
    markers.splice(0).forEach((m) => m.remove());
    const away: HTMLElement[] = [];
    for (const mark of view.marks) {
      const pin = pins[mark.index];
      const offMap = !inside(US_BOUNDS, pin.city!.lng, pin.city!.lat);
      if (offMap && mark.faded) continue;
      const el = document.createElement('a');
      el.href = safeUrl(pin.href);
      el.className = `om-marker po-map__pin${mark.faded ? ' po-map__pin--faded' : ''}${mark.ring ? ` po-map__pin--${mark.ring}` : ''}`;
      el.style.setProperty('--po-pin-size', `${mark.size}px`);
      el.style.zIndex = String(mark.z);
      el.setAttribute('aria-label', `No. ${pin.rank} ${pin.teamName}`);
      el.tabIndex = mark.faded ? -1 : 0;
      const badge = document.createElement('span');
      badge.className = 'om-marker__icon';
      const img = document.createElement('img');
      img.src = safeUrl(pin.icon);
      img.alt = '';
      img.decoding = 'async';
      badge.appendChild(img);
      el.appendChild(badge);
      if (mark.tag) {
        const tag = document.createElement('span');
        tag.className = 'om-marker__tag';
        tag.textContent = mark.tag;
        el.appendChild(tag);
      }
      if (offMap) {
        el.classList.add('po-map__away-pin');
        const where = document.createElement('span');
        where.className = 'po-map__away-city';
        where.textContent = pin.city!.name;
        el.appendChild(where);
        away.push(el);
        continue;
      }
      markers.push(new maplibregl.Marker({ element: el }).setLngLat([pin.city!.lng, pin.city!.lat]).addTo(map));
    }
    awayEl?.replaceChildren(...away);
    if (awayEl) awayEl.hidden = away.length === 0;
    if (captionEl) captionEl.textContent = view.caption;
    root.querySelectorAll<HTMLButtonElement>('[data-rank-map-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.rankMapMode === mode));
    });
  }

  const modeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-rank-map-mode]'));
  const onModeClick = (event: Event) => {
    mode = (event.currentTarget as HTMLButtonElement).dataset.rankMapMode as RankMapMode;
    render();
  };
  modeButtons.forEach((button) => button.addEventListener('click', onModeClick));
  map.on('load', () => render());

  // Repaint the land and water when the theme flips (same key as the Owner Map).
  const themeKey = () =>
    `${document.documentElement.classList.contains('dark')}|${document.documentElement.dataset.league ?? ''}`;
  let lastTheme = themeKey();
  const themeObserver = new MutationObserver(() => {
    const next = themeKey();
    if (next === lastTheme) return;
    lastTheme = next;
    map.setStyle(buildStyle(canvasEl, geo));
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-league'] });

  return () => {
    themeObserver.disconnect();
    modeButtons.forEach((button) => button.removeEventListener('click', onModeClick));
    markers.splice(0).forEach((m) => m.remove());
    awayEl?.replaceChildren();
    map.remove();
  };
}
