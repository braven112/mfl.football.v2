/**
 * Player Cell HTML Builder — generates the same markup as PlayerCell.astro
 * for use in client-side JavaScript rendering (e.g., players.astro).
 *
 * Produces HTML strings using the same `.player-cell` class names so that
 * the shared CSS applies consistently regardless of render method.
 *
 * @example
 * ```ts
 * import { buildPlayerCellHTML } from '../utils/player-cell-html';
 *
 * const html = buildPlayerCellHTML({
 *   name: 'Patrick Mahomes',
 *   headshot: 'https://...',
 *   position: 'QB',
 *   nflTeam: 'KC',
 * });
 * ```
 */

import type { PlayerModalData } from './player-modal-trigger';

const DEFAULT_HEADSHOT_URL =
  'https://www49.myfantasyleague.com/player_photos_2010/no_photo_available.jpg';

/** Map MFL team codes to standard codes (must match nfl-logo.ts) */
const TEAM_CODE_MAP: Record<string, string> = {
  WAS: 'WSH', JAC: 'JAX', GBP: 'GB', KCC: 'KC',
  NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB',
  LVR: 'LV', HST: 'HOU', BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI',
};

function normalizeTeam(code: string): string {
  if (!code) return '';
  const upper = code.toUpperCase();
  return TEAM_CODE_MAP[upper] || upper;
}

export interface PlayerCellOptions {
  name: string;
  headshot?: string;
  position?: string;
  nflTeam?: string;
  size?: 'default' | 'compact';
  /** When provided, makes the name clickable for PlayerDetailsModal */
  playerData?: PlayerModalData;
  /** Extra HTML to inject after the name (e.g., badges) */
  afterName?: string;
  /** Additional CSS class on the root element */
  className?: string;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPlayerCellHTML(opts: PlayerCellOptions): string {
  const {
    name,
    headshot,
    position,
    nflTeam,
    size = 'default',
    playerData,
    afterName = '',
    className = '',
  } = opts;

  const isDef = position?.toUpperCase() === 'DEF';
  const normalized = nflTeam ? normalizeTeam(nflTeam) : '';
  const teamLogo = normalized ? `/assets/nfl-logos/${normalized}.svg` : '';

  const avatarSrc = isDef && teamLogo ? teamLogo : (headshot || DEFAULT_HEADSHOT_URL);
  const nflLogoUrl = isDef ? '' : teamLogo;

  const sizeClass = size === 'compact' ? ' player-cell--compact' : '';
  const defClass = isDef ? ' player-cell__avatar--def' : '';

  // Name element — clickable if playerData provided
  let nameHtml: string;
  if (playerData) {
    const json = esc(JSON.stringify(playerData));
    nameHtml = `<strong class="player-cell__name player-cell__name--clickable" data-player-modal="${json}" title="Click to view player details">${esc(name)}${afterName}</strong>`;
  } else {
    nameHtml = `<strong class="player-cell__name">${esc(name)}${afterName}</strong>`;
  }

  // Meta row
  let metaHtml = '';
  if (nflLogoUrl || position) {
    const logoPart = nflLogoUrl
      ? `<img src="${esc(nflLogoUrl)}" alt="${esc(normalized || nflTeam || 'FA')} logo" class="player-meta__logo" loading="lazy" decoding="async" />`
      : '';
    const posPart = position
      ? `<span class="player-meta__pos">${esc(position)}</span>`
      : '';
    metaHtml = `<div class="player-meta">${logoPart}${posPart}</div>`;
  }

  return `<div class="player-cell${sizeClass}${className ? ' ' + esc(className) : ''}">
  <div class="player-cell__avatar${defClass}">
    <img src="${esc(avatarSrc)}" alt="${isDef ? esc(`${nflTeam || 'DEF'} logo`) : esc(`${name} headshot`)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${DEFAULT_HEADSHOT_URL}';" />
  </div>
  <div class="player-cell__info">
    ${nameHtml}
    ${metaHtml}
  </div>
</div>`;
}
