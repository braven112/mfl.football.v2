/**
 * AFL free-agent table — filtering, sorting, rendering, DEF spotlight.
 *
 * Extracted from a ~900-line `<script define:vars>` block in
 * src/pages/afl-fantasy/players.astro. It is a bundled module now, so it is
 * TypeScript, `astro check` covers it, and it CAN import — which the classic
 * form could not, and which is the whole reason this page talks to the
 * rankings layer over CustomEvents (`rankings:page-ready` and friends). That
 * bridge is left exactly as it was; replacing it with a direct import is a
 * behavior change and belongs in its own commit.
 *
 * The server hands its configuration over on `window.__AFL_PLAYERS__` through
 * a one-line `define:vars` bridge in the page — the shape LineupPage.astro
 * already uses. It is destructured below into the identifiers the body
 * already used, so the body itself moved unchanged.
 *
 * See docs/claude/rules/client-data.md § Retiring an inline script.
 */

import type { PlayerRow, RankingLookupState } from './players-types';

const config = (window as any).__AFL_PLAYERS__ as Record<string, any> | undefined;
if (!config) throw new Error('Missing __AFL_PLAYERS__ payload');

const {
  playerDataJson,
  hasProjected,
  hasLastYrPts,
  hasAdp,
  defaultSort,
  defaultDir,
  mflHost,
  defSpotlightJson,
  conferenceMetaJson,
  activeConfIdJson,
  nflAvatarBgJson,
  nflAvatarBorderJson,
  nflAvatarBgFallback,
  nflAvatarBorderFallback,
  nflAvatarRingJson,
  nflAvatarRingFallback,
  nflAvatarRingDarkJson,
  nflAvatarRingDarkFallback,
  logoOnerror,
  collegeLogoOnerror,
  collegeLogoOnload,
} = config;

const players: PlayerRow[] = JSON.parse(playerDataJson);
// Duplicate-player conference metadata (null = single shared pool).
const conferenceMeta = JSON.parse(conferenceMetaJson);
// Active conference view (null = single shared pool). The page shows ONE
// conference at a time — the hero switcher flips this and refilters.
let activeConf = JSON.parse(activeConfIdJson);
const nflAvatarBg = JSON.parse(nflAvatarBgJson);
const nflAvatarBorder = JSON.parse(nflAvatarBorderJson);
const nflAvatarRing = JSON.parse(nflAvatarRingJson);
const nflAvatarRingDark = JSON.parse(nflAvatarRingDarkJson);

function getAvatarStyle(team: string) {
  // Not escapeAttr'd: values are precomputed hex/gradient strings from
  // nfl-team-colors.ts — deterministic, never contain HTML special chars.
  const bg = nflAvatarBg[team] || nflAvatarBgFallback;
  const border = nflAvatarBorder[team] || nflAvatarBorderFallback;
  const ring = nflAvatarRing[team] || nflAvatarRingFallback;
  const ringDark = nflAvatarRingDark[team] || nflAvatarRingDarkFallback;
  return ` style="--player-avatar-bg: ${bg}; --player-avatar-border: ${border}; --player-avatar-ring: ${ring}; --player-avatar-ring-dark: ${ringDark}"`;
}

// State
let filteredPlayers: PlayerRow[] = [];
let currentSort = defaultSort;
let sortDirection = defaultDir;
let visibleCount = 50;
let activePosition = 'ALL';
let searchQuery = '';
let showRostered = false;
// Rookies show by default on the AFL page (unlike TheLeague, where rookies
// enter only through the rookie draft): the checkbox starts checked and
// unchecking it counts as an active filter. "Rookies only" narrows the pool
// to rookies; checking it forces "Include rookies" back on (checked +
// disabled) so the two boxes can never contradict each other and the badge
// never counts an inert include-toggle deviation.
let showRookies = true;
let rookiesOnly = false;
const BATCH_SIZE = 50;

// ── Rankings state ──
// Populated by the rankings module script below over CustomEvents: this is a
// define:vars (classic) script and can't import. See
// docs/claude/insights/features/rankings-integration.md.
let rankingLookup: RankingLookupState = { byImport: new Map(), columns: [] };
let hasRankingColumns = false;
let hasExplicitSortPref = false;

// Column view: 'stats' (the traditional columns) or 'rankings' (the owner's
// imported boards). Mutually exclusive, like TheLeague's Free Agents page.
let activeView = 'stats';
let hasExplicitViewPref = false;

// Advanced filter state
let filterTeam = '';
let filterAgeMin: number | null = null;
let filterAgeMax: number | null = null;
let filterExp = '';
let filterDraft = '';
let filterHtMin: number | null = null;
let filterHtMax: number | null = null;
let filterWtMin: number | null = null;
let filterWtMax: number | null = null;
let filtersOpen = false;

// ── Helpers ──
function getHeadshotUrl(playerId: string | null, espnId?: string | null) {
  if (espnId) return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  return `https://${mflHost}/player_photos_big_2014/${playerId}_thumb.jpg`;
}
function getNflLogo(team: string) {
  // 'FA' / 'FA*' (conditional free agent) have no crest — use the shield.
  if (!team || team.indexOf('FA') === 0) return '/assets/nfl-logos/NFL.svg';
  return `/assets/nfl-logos/${team}.svg`;
}
const defaultHeadshot = `https://${mflHost}/player_photos_2010/no_photo_available.jpg`;
function buildOnerror(mflId: string, espnId?: string | null) {
  const college = espnId ? `https://a.espncdn.com/i/headshots/college-football/players/full/${espnId}.png` : null;
  const mfl = mflId ? `https://${mflHost}/player_photos_big_2014/${mflId}_thumb.jpg` : null;
  if (college && mfl) {
    return `this.onerror=function(){this.onerror=function(){this.onerror=null;this.src='${defaultHeadshot}'};this.src='${mfl}'};this.src='${college}'`;
  }
  if (college) {
    return `this.onerror=function(){this.onerror=null;this.src='${defaultHeadshot}'};this.src='${college}'`;
  }
  return `this.onerror=null;this.src='${defaultHeadshot}'`;
}
// Hero-only onerror: the spotlight shows ESPN images exclusively. If the NFL
// headshot 404s we try the ESPN college headshot (still an ESPN image), then
// HIDE the foreground rather than falling back to the MFL photo / "no photo"
// placeholder the table rows use.
function buildHeroOnerror(espnId?: string | null) {
  // espnId is a numeric MFL/ESPN id; enforce that before splicing it into the
  // inline handler string so nothing unexpected can break out of the literal.
  const safe = /^\d+$/.test(String(espnId)) ? String(espnId) : null;
  const college = safe ? `https://a.espncdn.com/i/headshots/college-football/players/full/${safe}.png` : null;
  if (college) {
    return `this.onerror=function(){this.onerror=null;this.style.visibility='hidden'};this.src='${college}'`;
  }
  return `this.onerror=null;this.style.visibility='hidden'`;
}
function escapeAttr(s: unknown) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// "Rostered" is relative to the active conference view: a player held in
// the NL is a free agent in the AL view. Single-pool leagues fall back to
// the league-wide flag.
function isRosteredForView(p: PlayerRow) {
  if (activeConf) return Array.isArray(p.confs) && p.confs.includes(activeConf);
  return p.rostered;
}

// The franchise holding him IN THE VIEWED CONFERENCE, on the same boundary
// isRosteredForView draws: an AL viewer is told about the AL owner, and a
// player only the NL holds is a free agent here with nobody to name.
// Single-pool leagues key the one pseudo-conference as ''. Null whenever
// the snapshot predates baked owners or the live overlay fell back without
// them — the modal then reads exactly as it did before.
function ownerForView(p: PlayerRow) {
  if (!p.owners) return null;
  return p.owners[activeConf || ''] || null;
}

function confName(id: string | null | undefined) {
  return (id ? conferenceMeta?.names[id]?.name : null) || id;
}

// Row tag: only for rows the "Include rostered" toggle reveals — a player
// rostered in the ACTIVE conference but still available in another gets
// "FA in <other>", so the boundary stays clear without mixing the views.
function buildConfTag(p: PlayerRow) {
  if (!activeConf || !Array.isArray(p.confs) || !p.confs.includes(activeConf)) return '';
  const availIds = conferenceMeta.ids.filter((id: string) => !p.confs.includes(id));
  if (availIds.length === 0) return '';
  const abbrevs = availIds.map((id: string) => conferenceMeta.names[id]?.abbrev || id).join('/');
  const fullNames = availIds.map(confName).join(', ');
  return `<span class="conf-tag" title="Still available in the ${escapeAttr(fullNames)}">FA in ${escapeAttr(abbrevs)}</span>`;
}

// ── Hero spotlight (top player of the current filter/sort) ──
const spotlightEl = document.getElementById('hero-spotlight');
const spotlightLogoEl = document.getElementById('hero-spotlight-logo') as HTMLImageElement | null;
const spotlightHeadEl = document.getElementById('hero-spotlight-head') as HTMLImageElement | null;
const spotlightCaptionEl = document.getElementById('hero-spotlight-caption');
const spotlightLabelEl = document.getElementById('hero-spotlight-label');
const spotlightNameEl = document.getElementById('hero-spotlight-name');
const spotlightMetaEl = document.getElementById('hero-spotlight-meta');
let spotlightPlayerId: string | null = null;

// ── DEF face rotation ──
// AFL DEF is team defenses only — a DEF free agent has no headshot. DEF_SPOTLIGHT
// maps each team to a ranked pool of its marquee defenders; when a DEF is
// spotlighted we show one defender's ESPN headshot over the logo watermark and
// (unless reduced-motion) rotate through the pool so it doesn't feel static.
const DEF_SPOTLIGHT = JSON.parse(defSpotlightJson);
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEF_ROTATE_MS = 4500;
let defRotateTimer: ReturnType<typeof setInterval> | null = null;
let defRotateIdx = 0;

function stopDefRotation() {
  if (defRotateTimer) {
    clearInterval(defRotateTimer);
    defRotateTimer = null;
  }
}

// Swap the spotlight headshot + name to a specific defender, replaying the
// entrance animation. Used for the initial face and every rotation tick.
function applyDefFace(player: PlayerRow) {
  // Every mapped defender carries an espnId; bail if one somehow doesn't rather
  // than build a `.../null.png` headshot URL.
  if (!player || !player.espnId) return;
  if (spotlightHeadEl) {
    spotlightHeadEl.onerror = null;
    spotlightHeadEl.style.visibility = '';
    spotlightHeadEl.setAttribute('onerror', buildHeroOnerror(player.espnId));
    spotlightHeadEl.src = getHeadshotUrl(null, player.espnId);
    spotlightHeadEl.style.animation = 'none';
    // eslint-disable-next-line no-unused-expressions
    spotlightHeadEl.offsetHeight; // force reflow so the animation restarts
    spotlightHeadEl.style.animation = '';
  }
  if (spotlightNameEl) spotlightNameEl.textContent = player.name;
}

function startDefRotation(players: PlayerRow[]) {
  stopDefRotation();
  // Random starting face so repeat visits don't always open on the same player.
  defRotateIdx = players.length > 1 ? Math.floor(Math.random() * players.length) : 0;
  applyDefFace(players[defRotateIdx]);
  if (players.length > 1 && !prefersReducedMotion) {
    defRotateTimer = setInterval(() => {
      defRotateIdx = (defRotateIdx + 1) % players.length;
      applyDefFace(players[defRotateIdx]);
    }, DEF_ROTATE_MS);
  }
}

function updateSpotlight(p: PlayerRow) {
  if (!spotlightEl) return;
  if (!p) {
    stopDefRotation();
    spotlightPlayerId = null;
    spotlightEl.setAttribute('data-def', 'false');
    spotlightEl.setAttribute('data-def-player', 'false');
    if (spotlightLogoEl) spotlightLogoEl.src = '/assets/nfl-logos/NFL.svg';
    if (spotlightCaptionEl) spotlightCaptionEl.style.display = 'none';
    if (spotlightHeadEl) spotlightHeadEl.style.visibility = 'hidden';
    return;
  }
  if (spotlightCaptionEl) spotlightCaptionEl.style.display = '';
  // Team defense → its rotating pool of marquee defenders.
  const isDef = p.position === 'DEF';
  const defPlayers = isDef ? (DEF_SPOTLIGHT[p.team] || []) : [];
  const hasDefFace = defPlayers.length > 0;
  // NB: headshot visibility is set inside the image-swap branches below, NOT
  // here — doing it before the same-player early-return would re-reveal a
  // headshot we'd hidden because its ESPN image 404'd (same #1 player across a
  // re-sort), flashing the broken image back in.
  spotlightEl.setAttribute('data-def', isDef ? 'true' : 'false');
  spotlightEl.setAttribute('data-def-player', hasDefFace ? 'true' : 'false');

  if (spotlightLabelEl) {
    spotlightLabelEl.textContent = activePosition && activePosition !== 'ALL'
      ? 'Top ' + (activePosition === 'PK' ? 'K' : activePosition)
      : 'Top Free Agent';
  }
  // For a mapped DEF the rotating defender name is set by applyDefFace(); the
  // meta row still carries the DEF unit's context (DEF · TEAM · pts).
  if (!hasDefFace && spotlightNameEl) spotlightNameEl.textContent = p.name;
  if (spotlightMetaEl) {
    const pos = p.position === 'PK' ? 'K' : p.position;
    const teamPart = p.team && p.team.indexOf('FA') !== 0 ? ` · ${p.team}` : '';
    const projPart = p.projected != null ? ` · ${p.projected.toFixed(1)} pts` : '';
    spotlightMetaEl.textContent = `${pos}${teamPart}${projPart}`;
  }

  // The image swap is skipped when the #1 player is unchanged. For a DEF, the
  // unit id is the stable anchor while the defender FACE rotates within it via
  // applyDefFace(), so keeping the running rotation here is correct.
  if (p.id === spotlightPlayerId) return;
  spotlightPlayerId = p.id;
  stopDefRotation();

  const logo = getNflLogo(p.team);
  if (spotlightLogoEl) spotlightLogoEl.src = logo;

  if (hasDefFace) {
    // DEF with a mapped pool → rotate through the defenders' headshots.
    startDefRotation(defPlayers);
  } else if (spotlightHeadEl) {
    spotlightHeadEl.onerror = null;
    if (isDef) {
      // Unmapped DEF → logo becomes the hero (head kept hidden by CSS).
      spotlightHeadEl.removeAttribute('onerror');
      spotlightHeadEl.style.visibility = '';
      spotlightHeadEl.src = logo;
    } else if (p.espnId) {
      // Offensive player with an ESPN headshot → show it (hero-only onerror
      // hides the foreground if the ESPN image 404s, never falls back to MFL).
      spotlightHeadEl.style.visibility = '';
      spotlightHeadEl.setAttribute('onerror', buildHeroOnerror(p.espnId));
      spotlightHeadEl.src = `https://a.espncdn.com/i/headshots/nfl/players/full/${p.espnId}.png`;
    } else {
      // No ESPN image → keep the spotlight headshot hidden (no MFL/placeholder).
      spotlightHeadEl.removeAttribute('onerror');
      spotlightHeadEl.style.visibility = 'hidden';
      return;
    }
    // Restart the entrance animation for the new headshot.
    spotlightHeadEl.style.animation = 'none';
    // eslint-disable-next-line no-unused-expressions
    spotlightHeadEl.offsetHeight; // force reflow to restart animation
    spotlightHeadEl.style.animation = '';
  }
}

// ── Column view ──
function loadViewPref() {
  try {
    const saved = localStorage.getItem('aflPlayersViewMode');
    if (saved === 'rankings' || saved === 'stats') {
      activeView = saved;
      hasExplicitViewPref = true;
    }
  } catch (_) {}
}

function saveViewPref() {
  try {
    localStorage.setItem('aflPlayersViewMode', activeView);
  } catch (_) {}
}

function applyGroupVisibility() {
  // Fall back to Stats if the owner has no board loaded (or deleted it while
  // the Rankings view was showing).
  if (activeView === 'rankings' && !hasRankingColumns) activeView = 'stats';

  const showStats = activeView === 'stats';

  document.querySelectorAll<HTMLElement>('.col-group--stats').forEach(el => {
    el.style.display = showStats ? '' : 'none';
  });
  document.querySelectorAll<HTMLElement>('.col-group--rankings').forEach(el => {
    el.style.display = showStats ? 'none' : '';
  });

  for (const group of ['stats', 'rankings']) {
    const btn = document.querySelector(`.col-group-btn[data-group="${group}"]`);
    if (btn) {
      const isActive = group === activeView;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    }
  }

  // The whole bar is meaningless without a second view to switch to.
  const toggleBar = document.getElementById('col-group-toggles');
  if (toggleBar) toggleBar.style.display = hasRankingColumns ? '' : 'none';
}

function setActiveView(view: string) {
  activeView = view;
  hasExplicitViewPref = true;
  saveViewPref();
  applyGroupVisibility();
}

loadViewPref();

// ?view=stats|rankings — shareable, and wins over the stored preference.
const viewParam = new URLSearchParams(window.location.search).get('view');
if (viewParam === 'stats' || viewParam === 'rankings') {
  activeView = viewParam;
  hasExplicitViewPref = true;
}

// ── Sorting ──
function sortPlayers() {
  filteredPlayers.sort((a, b) => {
    let aVal, bVal;
    // Dynamic ranking columns — sort key is `ranking_{importId}`. Unranked
    // players take a sentinel worse than any real rank, so ascending (the
    // default for these columns) puts the best board positions first and the
    // unranked last. Descending inverts that literally, unranked first —
    // same as TheLeague's table, which is the behaviour to match here.
    if (currentSort.startsWith('ranking_')) {
      const map = rankingLookup.byImport.get(currentSort.slice(8));
      aVal = map?.get(a.id) ?? 99999;
      bVal = map?.get(b.id) ?? 99999;
      const rDiff = aVal - bVal;
      return sortDirection === 'desc' ? -rDiff : rDiff;
    }
    switch (currentSort) {
      case 'name':
        return sortDirection === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      case 'college': {
        const aC = a.college || '';
        const bC = b.college || '';
        return sortDirection === 'asc' ? aC.localeCompare(bC) : bC.localeCompare(aC);
      }
      case 'age':      aVal = a.age ?? 999; bVal = b.age ?? 999; break;
      case 'exp':      aVal = a.exp ?? -1; bVal = b.exp ?? -1; break;
      case 'draftRd':  aVal = a.draftRd ?? 999; bVal = b.draftRd ?? 999; break;
      case 'height':   aVal = a.height ?? -1; bVal = b.height ?? -1; break;
      case 'weight':   aVal = a.weight ?? -1; bVal = b.weight ?? -1; break;
      case 'adpDyn':   aVal = a.adpDyn ?? 9999; bVal = b.adpDyn ?? 9999; break;
      case 'lastYrPts': aVal = a.lastYrPts ?? -1; bVal = b.lastYrPts ?? -1; break;
      case 'projected': aVal = a.projected ?? -1; bVal = b.projected ?? -1; break;
      default:         aVal = a.projected ?? -1; bVal = b.projected ?? -1;
    }
    const diff = aVal - bVal;
    return sortDirection === 'desc' ? -diff : diff;
  });
}

// ── Filtering ──
function passesAdvancedFilters(p: PlayerRow) {
  if (filterTeam && p.team !== filterTeam) return false;
  if (filterAgeMin != null && (p.age == null || p.age < filterAgeMin)) return false;
  if (filterAgeMax != null && (p.age == null || p.age > filterAgeMax)) return false;
  if (filterExp) {
    const exp = p.exp;
    switch (filterExp) {
      case 'rookie': if (!p.rookie) return false; break;
      case '1-2': if (exp == null || exp < 1 || exp > 2) return false; break;
      case '3-5': if (exp == null || exp < 3 || exp > 5) return false; break;
      case '6-10': if (exp == null || exp < 6 || exp > 10) return false; break;
      case '10+': if (exp == null || exp < 10) return false; break;
    }
  }
  if (filterDraft) {
    switch (filterDraft) {
      case '1': if (p.draftRd !== 1) return false; break;
      case '2': if (p.draftRd !== 2) return false; break;
      case '3': if (p.draftRd !== 3) return false; break;
      case '4+': if (p.draftRd == null || p.draftRd < 4) return false; break;
      case 'udfa': if (p.draftRd != null) return false; break;
    }
  }
  if (filterHtMin != null && (p.height == null || p.height < filterHtMin)) return false;
  if (filterHtMax != null && (p.height == null || p.height > filterHtMax)) return false;
  if (filterWtMin != null && (p.weight == null || p.weight < filterWtMin)) return false;
  if (filterWtMax != null && (p.weight == null || p.weight > filterWtMax)) return false;
  return true;
}

function countActiveFilters() {
  let count = 0;
  if (filterTeam) count++;
  if (filterAgeMin != null || filterAgeMax != null) count++;
  if (filterHtMin != null || filterHtMax != null) count++;
  if (filterWtMin != null || filterWtMax != null) count++;
  if (filterExp) count++;
  if (filterDraft) count++;
  if (showRostered) count++;
  if (!showRookies) count++;
  if (rookiesOnly) count++;
  return count;
}

function updateFilterBadge() {
  const badge = document.getElementById('filter-badge');
  const count = countActiveFilters();
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
  }
  const btn = document.getElementById('filter-toggle-btn');
  if (btn) btn.classList.toggle('has-filters', count > 0);
}

// "Rookies only" subsumes "Include rookies": while active, force the
// include toggle on (checked + disabled) so the two boxes can never
// contradict each other and the badge never counts an inert include-toggle
// deviation. The ONLY place the lock semantics live — every path that
// changes rookiesOnly (change handler, Clear Filters, DOM re-sync) calls
// this instead of hand-rolling the checked/disabled dance.
function applyRookiesOnlyLock() {
  const includeEl = document.getElementById('show-rookies') as HTMLInputElement | null;
  if (rookiesOnly) {
    showRookies = true;
    if (includeEl) { includeEl.checked = true; includeEl.disabled = true; }
  } else if (includeEl) {
    includeEl.disabled = false;
  }
}

function matchesBaseFilters(p: PlayerRow, query: string) {
  if (!showRostered && isRosteredForView(p)) return false;
  // rookiesOnly implies showRookies (applyRookiesOnlyLock forces it on),
  // so the two branches can't both apply.
  if (rookiesOnly && !p.rookie) return false;
  if (!showRookies && p.rookie) return false;
  if (!passesAdvancedFilters(p)) return false;
  if (query) {
    return p.name.toLowerCase().includes(query) || p.team.toLowerCase().includes(query);
  }
  return true;
}

function filterPlayers() {
  const query = searchQuery.toLowerCase();
  filteredPlayers = players.filter(p => {
    if (activePosition !== 'ALL' && p.position !== activePosition) return false;
    return matchesBaseFilters(p, query);
  });

  // Update pill counts (ignore the active position filter)
  const pool = players.filter(p => matchesBaseFilters(p, query));
  const counts: Record<string, number> = { ALL: pool.length };
  for (const p of pool) counts[p.position] = (counts[p.position] || 0) + 1;
  // The hero's "N available players" always mirrors the ALL pill — one
  // semantic for both numbers, so a conference switch or filter change
  // never leaves them disagreeing.
  const heroCountEl = document.getElementById('hero-count-num');
  if (heroCountEl) heroCountEl.textContent = String(counts.ALL);
  for (const pos of ['ALL', 'QB', 'RB', 'WR', 'TE', 'PK', 'DEF']) {
    const el = document.getElementById(`count-${pos}`);
    if (el) el.textContent = String(counts[pos] || 0);
  }

  updateFilterBadge();
  sortPlayers();
  visibleCount = BATCH_SIZE;
  render();
}

function render() {
  const tbody = document.getElementById('player-table-body');
  if (!tbody) return;

  const total = filteredPlayers.length;
  const end = Math.min(visibleCount, total);
  const pageData = filteredPlayers.slice(0, end);

  const showingCountEl = document.getElementById('showing-count');
  const totalEl = document.getElementById('total-players');
  const showMoreWrapper = document.getElementById('show-more-wrapper');
  if (showingCountEl) showingCountEl.textContent = String(end);
  if (totalEl) totalEl.textContent = String(total);
  if (showMoreWrapper) showMoreWrapper.style.display = end < total ? '' : 'none';

  let html = '';
  for (let i = 0; i < pageData.length; i++) {
    const p = pageData[i];
    const rank = i + 1;
    const isDef = p.position === 'DEF';
    const headshot = isDef ? getNflLogo(p.team) : getHeadshotUrl(p.id, p.espnId);
    const logo = getNflLogo(p.team);
    const posLabel = p.position === 'PK' ? 'K' : p.position;
    const rosteredForView = isRosteredForView(p);
    const rosteredClass = rosteredForView ? ' row--rostered' : '';

    const modalJson = escapeAttr(JSON.stringify({
      id: p.id, espnId: p.espnId || null, name: p.name,
      position: p.position, nflTeam: p.team,
      college: p.college || null, height: p.height || null,
      weight: p.weight || null, number: p.jersey || null,
      birthdate: p.birthdate || null, experience: p.exp != null ? p.exp : null,
      draftYear: p.draftYear || null, draftTeam: p.draftTeam || null,
      draftRound: p.draftRd || null, draftPick: p.draftPick || null,
      points: p.projected != null ? p.projected : (p.lastYrPts != null ? p.lastYrPts : null),
      // Rostered in THIS conference → the modal band wears that franchise
      // and the strip names it. Re-read per render, so flipping the
      // conference switcher re-owns every row with it.
      franchiseId: ownerForView(p),
    }));
    const rosteredDot = rosteredForView
      ? `<span class="rostered-dot" title="${activeConf ? `Rostered in the ${escapeAttr(confName(activeConf))}` : 'Rostered'}"></span>`
      : '';
    const confTag = buildConfTag(p);

    const htDisplay = p.height ? Math.floor(p.height / 12) + "'" + (p.height % 12) + '"' : '-';
    const wtDisplay = p.weight ? p.weight + '' : '-';

    html += `<tr class="${rosteredClass}" data-pos="${p.position.toLowerCase()}" data-player-id="${p.id}">
      <td class="cell-rank">${rank}</td>
      <td class="cell-player">
        <div class="player-cell">
          <div class="player-cell__avatar${isDef ? ' player-cell__avatar--def' : ''}"${isDef ? '' : getAvatarStyle(p.team)}>
            <img src="${headshot}" alt="" loading="lazy" decoding="async" onerror="${isDef ? escapeAttr(logoOnerror) : escapeAttr(buildOnerror(p.id, p.espnId))}" />
          </div>
          <div class="player-cell__info">
            <strong class="player-cell__name player-cell__name--clickable" data-player-modal="${modalJson}">${escapeAttr(p.name)}${rosteredDot}</strong>
            <div class="player-meta">
              ${isDef ? '' : `<img src="${escapeAttr(logo)}" alt="${escapeAttr(p.team)}" class="player-meta__logo" onerror="${escapeAttr(logoOnerror)}" />`}<span class="player-meta__pos">${posLabel}</span>${confTag}
            </div>
          </div>
        </div>
      </td>
      <td class="cell-age">${p.age ?? '-'}</td>
      <td class="cell-sm">${p.exp != null ? p.exp : '-'}</td>
      <td class="cell-sm">${p.draftRd != null ? 'Rd ' + p.draftRd : '<span class="na">-</span>'}</td>
      <td class="cell-college col-group--stats">${p.collegeLogo ? `<img src="${escapeAttr(p.collegeLogo)}" alt="${escapeAttr(p.college || '')}" title="${escapeAttr(p.college || '')}" class="college-logo" loading="lazy" decoding="async" onerror="${escapeAttr(collegeLogoOnerror)}" onload="${escapeAttr(collegeLogoOnload)}" />` : (p.college ? `<span class="na" title="${escapeAttr(p.college)}">-</span>` : '<span class="na">-</span>')}</td>
      <td class="cell-sm">${htDisplay}</td>
      <td class="cell-sm">${wtDisplay}</td>`;

    // Ranking cells sit right after Wt, matching where the module script
    // injects their headers. Class list mirrors rankingCellClasses() in
    // src/utils/rankings-table.ts — this script can't import it.
    for (const col of rankingLookup.columns) {
      const rnk = rankingLookup.byImport.get(col.importId)?.get(p.id);
      const avgCls = col.isAverage ? ' col-ranking-avg' : '';
      const compositeCls = col.isComposite ? ' col-ranking-composite' : '';
      const borderCls = col.isLastCompositeMember ? ' col-ranking-member-last' : '';
      html += `<td class="cell-num col-group--rankings${avgCls}${compositeCls}${borderCls}">${rnk != null ? rnk : '<span class="na">-</span>'}</td>`;
    }

    if (hasAdp) {
      html += `<td class="cell-num col-group--stats">${p.adpDyn != null ? p.adpDyn.toFixed(1) : '<span class="na">-</span>'}</td>`;
    }
    if (hasLastYrPts) {
      html += `<td class="cell-num col-group--stats">${p.lastYrPts != null ? p.lastYrPts.toFixed(1) : '<span class="na">-</span>'}</td>`;
    }
    if (hasProjected) {
      html += `<td class="cell-num cell-pts col-projected col-group--stats">${p.projected != null ? p.projected.toFixed(1) : '<span class="na">-</span>'}</td>`;
    }
    html += `</tr>`;
  }

  tbody.innerHTML = html;

  // Sort indicators
  document.querySelectorAll('.players-table th.sortable').forEach(th => {
    const content = th.querySelector('.th-content');
    const existingArrow = th.querySelector('.sort-arrow');
    const sortKey = th.getAttribute('data-sort');
    if (sortKey === currentSort) {
      th.classList.add('sorted');
      if (!existingArrow && content) {
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        arrow.textContent = sortDirection === 'asc' ? '▲' : '▼';
        content.appendChild(arrow);
      } else if (existingArrow) {
        existingArrow.textContent = sortDirection === 'asc' ? '▲' : '▼';
      }
    } else {
      th.classList.remove('sorted');
      if (existingArrow) existingArrow.remove();
    }
  });

  const noDataEl = document.getElementById('no-data');
  if (noDataEl) noDataEl.style.display = players.length === 0 ? 'block' : 'none';

  // render() rebuilds tbody via innerHTML, which destroys every inline
  // display style — re-apply or the hidden group comes back on each render.
  applyGroupVisibility();

  updateSpotlight(filteredPlayers[0] || null);
}

// Columns that default to descending on first click
const descDefaults = new Set(['projected', 'exp', 'height', 'weight', 'lastYrPts']);
// Columns that default to ascending (lower = better)
const ascDefaults = new Set(['adpDyn', 'draftRd', 'age']);

function init() {
  const table = document.getElementById('players-table');
  if (!table || table.dataset.init) return;
  table.dataset.init = 'true';

  // Position pills
  const tabsEl = document.getElementById('category-tabs');
  if (tabsEl) {
    tabsEl.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement | null)?.closest('.pos-pill');
      if (!tab) return;
      activePosition = tab.getAttribute('data-pos') ?? 'ALL';
      tabsEl.querySelectorAll('.pos-pill').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterPlayers();
    });
  }

  // Conference switcher — flips the whole view to the other conference and
  // mirrors the choice into ?conf= so the view survives reload/sharing
  // (SSR reads the same param for first paint).
  const switcher = document.getElementById('conf-switcher');
  if (switcher) {
    switcher.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest('.conf-switch-btn');
      if (!btn) return;
      const conf = btn.getAttribute('data-conf');
      if (!conf || conf === activeConf) return;
      activeConf = conf;
      switcher.querySelectorAll('.conf-switch-btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('conf', conferenceMeta?.names[conf]?.abbrev || conf);
        history.replaceState(null, '', url);
      } catch { /* URL sync is best-effort */ }
      filterPlayers();
    });
  }

  // Search
  const searchInput = document.getElementById('player-search');
  if (searchInput) {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = (e.target as HTMLInputElement).value.trim();
        filterPlayers();
      }, 150);
    });
  }

  // Sort headers
  document.querySelectorAll('.players-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (key === 'rank') return;
      // Ranking headers carry their own handler (added by the module script).
      if (key && key.startsWith('ranking_')) return;
      hasExplicitSortPref = true;
      if (currentSort === key) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = key;
        if (key === 'name' || key === 'college') sortDirection = 'asc';
        else if (ascDefaults.has(key ?? '')) sortDirection = 'asc';
        else sortDirection = 'desc';
      }
      sortPlayers();
      visibleCount = BATCH_SIZE;
      render();
    });
  });

  // Column view toggles (Stats / Rankings)
  const colGroupToggles = document.getElementById('col-group-toggles');
  if (colGroupToggles && !colGroupToggles.dataset.init) {
    colGroupToggles.dataset.init = 'true';
    colGroupToggles.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest('.col-group-btn');
      if (!btn) return;
      const group = btn.getAttribute('data-group');
      if (group) setActiveView(group);
    });
  }

  // Filter toggle
  const filterToggle = document.getElementById('filter-toggle-btn');
  const filtersPanel = document.getElementById('filters-panel');
  if (filterToggle && filtersPanel) {
    filterToggle.addEventListener('click', () => {
      filtersOpen = !filtersOpen;
      filtersPanel.classList.toggle('open', filtersOpen);
      filterToggle.classList.toggle('active', filtersOpen);
      filterToggle.setAttribute('aria-expanded', String(filtersOpen));
      // Collapsed panel is visually clipped — keep it out of the tab order too
      filtersPanel.inert = !filtersOpen;
    });
  }

  // Advanced filter inputs
  const numOrNull = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const bind = (id: string, handler: (e: Event) => void, evt = 'input') => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, handler);
  };
  bind('filter-team', (e) => { filterTeam = (e.target as HTMLInputElement).value; filterPlayers(); }, 'change');
  bind('filter-age-min', (e) => { filterAgeMin = numOrNull((e.target as HTMLInputElement).value); filterPlayers(); });
  bind('filter-age-max', (e) => { filterAgeMax = numOrNull((e.target as HTMLInputElement).value); filterPlayers(); });
  bind('filter-ht-min', (e) => { filterHtMin = numOrNull((e.target as HTMLInputElement).value); filterPlayers(); });
  bind('filter-ht-max', (e) => { filterHtMax = numOrNull((e.target as HTMLInputElement).value); filterPlayers(); });
  bind('filter-wt-min', (e) => { filterWtMin = numOrNull((e.target as HTMLInputElement).value); filterPlayers(); });
  bind('filter-wt-max', (e) => { filterWtMax = numOrNull((e.target as HTMLInputElement).value); filterPlayers(); });
  bind('filter-exp', (e) => { filterExp = (e.target as HTMLInputElement).value; filterPlayers(); }, 'change');
  bind('filter-draft', (e) => { filterDraft = (e.target as HTMLInputElement).value; filterPlayers(); }, 'change');
  bind('show-rostered', (e) => { showRostered = (e.target as HTMLInputElement).checked; filterPlayers(); }, 'change');
  bind('show-rookies', (e) => { showRookies = (e.target as HTMLInputElement).checked; filterPlayers(); }, 'change');
  bind('rookies-only', (e) => {
    rookiesOnly = (e.target as HTMLInputElement).checked;
    applyRookiesOnlyLock();
    filterPlayers();
  }, 'change');

  // Clear filters
  const clearBtn = document.getElementById('filter-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      filterTeam = ''; filterAgeMin = null; filterAgeMax = null;
      filterHtMin = null; filterHtMax = null; filterWtMin = null; filterWtMax = null;
      filterExp = ''; filterDraft = ''; showRostered = false; showRookies = true; rookiesOnly = false;
      ['filter-team', 'filter-age-min', 'filter-age-max', 'filter-ht-min', 'filter-ht-max',
       'filter-wt-min', 'filter-wt-max', 'filter-exp', 'filter-draft'].forEach(id => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.value = '';
      });
      const rosteredEl = document.getElementById('show-rostered') as HTMLInputElement | null;
      if (rosteredEl) rosteredEl.checked = false;
      const rookiesEl = document.getElementById('show-rookies') as HTMLInputElement | null;
      if (rookiesEl) rookiesEl.checked = true;
      const rookiesOnlyEl = document.getElementById('rookies-only') as HTMLInputElement | null;
      if (rookiesOnlyEl) rookiesOnlyEl.checked = false;
      applyRookiesOnlyLock();
      filterPlayers();
    });
  }

  // Show more
  const showMoreBtn = document.getElementById('show-more-btn');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      visibleCount += BATCH_SIZE;
      render();
    });
  }

  // ── Re-sync filter state from the DOM before the first render ──
  // Under Astro's ClientRouter this inline script executes ONCE per real
  // page load: a view-transition navigation swaps in fresh SSR DOM
  // (default attribute state — include-rookies checked, everything else
  // clear) while this module's filter variables persist, and only init()
  // re-runs via astro:page-load. Browsers can also restore form values
  // across reloads. Either way, the swapped-in controls — not the
  // persisted variables — are the truth at init time, so read every
  // filter control back into state here; skipping this renders a table
  // filtered by invisible state (e.g. rookies-only rows under an
  // unchecked "Rookies only" box after navigating away and back).
  const checkedOf = (id: string, dflt: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    return el ? el.checked : dflt;
  };
  const valueOf = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
  showRostered = checkedOf('show-rostered', false);
  rookiesOnly = checkedOf('rookies-only', false);
  showRookies = checkedOf('show-rookies', true);
  applyRookiesOnlyLock();
  filterTeam = valueOf('filter-team');
  filterAgeMin = numOrNull(valueOf('filter-age-min'));
  filterAgeMax = numOrNull(valueOf('filter-age-max'));
  filterHtMin = numOrNull(valueOf('filter-ht-min'));
  filterHtMax = numOrNull(valueOf('filter-ht-max'));
  filterWtMin = numOrNull(valueOf('filter-wt-min'));
  filterWtMax = numOrNull(valueOf('filter-wt-max'));
  filterExp = valueOf('filter-exp');
  filterDraft = valueOf('filter-draft');
  searchQuery = valueOf('player-search').trim();
  filtersOpen = !!filtersPanel?.classList.contains('open');
  activePosition = document.querySelector('#category-tabs .pos-pill.active')?.getAttribute('data-pos') || 'ALL';
  const domConf = document.querySelector('#conf-switcher .conf-switch-btn.active')?.getAttribute('data-conf');
  if (domConf) activeConf = domConf;

  filterPlayers();
}

// ── Rankings bridge ──
// The module script below owns the ranking columns; it can import, this
// script can't. Everything crosses on CustomEvents fired at `document`.

// After a ClientRouter swap the PREVIOUS page's inline script is still alive
// and its document-level listeners still answer these events — verified: two
// handlers responded to rankings:get-sort on the AFL page after navigating
// from TheLeague's. Both pages use the same element ids, so a stale handler
// reads/repaints the live page. Ignore events once our own table is detached.
const OWN_TABLE = document.getElementById('players-table');
function isLivePage() {
  return !!OWN_TABLE && OWN_TABLE.isConnected;
}

document.addEventListener('rankings:set-lookup', function (e: Event) {
  if (!isLivePage()) return;
  rankingLookup = (e as CustomEvent).detail.lookup;
  const hadColumns = hasRankingColumns;
  hasRankingColumns = (e as CustomEvent).detail.hasColumns;

  // First board to arrive opens the Rankings view for the owner — that is
  // the whole point of importing one. An explicit choice is never overridden.
  if (hasRankingColumns && !hadColumns && !hasExplicitViewPref) {
    activeView = 'rankings';
  }

  // "My Rank" is the board the owner actually built, so lead with it.
  if ((e as CustomEvent).detail.hasComposite && !hasExplicitSortPref) {
    currentSort = 'ranking___composite__';
    sortDirection = 'asc';
  }

  applyGroupVisibility();
});

document.addEventListener('rankings:set-sort', function (e: Event) {
  if (!isLivePage()) return;
  // A null key means the ranking column we were sorted by is gone entirely —
  // restore this page's own default rather than keep sorting by a column
  // that no longer exists.
  if ((e as CustomEvent).detail.key == null) {
    currentSort = defaultSort;
    sortDirection = descDefaults.has(currentSort) ? 'desc' : 'asc';
    hasExplicitSortPref = false;
    return;
  }
  hasExplicitSortPref = true;
  currentSort = (e as CustomEvent).detail.key;
  sortDirection = (e as CustomEvent).detail.dir;
});

document.addEventListener('rankings:refresh-table', function () {
  if (!isLivePage()) return;
  sortPlayers();
  visibleCount = BATCH_SIZE;
  render();
});

document.addEventListener('rankings:refilter', function () {
  if (!isLivePage()) return;
  filterPlayers();
});

// Synchronous read — the module reads (e as CustomEvent).detail back after dispatch.
document.addEventListener('rankings:get-sort', function (e: Event) {
  if (!isLivePage()) return;
  (e as CustomEvent).detail.currentSort = currentSort;
});

function bootstrap() {
  init();
  // Only now is the table in the DOM and the sort state readable, so this is
  // the earliest the module script can safely inject its columns.
  document.dispatchEvent(new CustomEvent('rankings:page-ready'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

// Cleanup on navigation (View Transitions) — stop the DEF rotation timer so it
// can't keep mutating detached hero nodes or stack a second interval on return.
document.addEventListener('astro:before-swap', function () {
  stopDefRotation();
}, { once: true });
// Astro view transitions
document.addEventListener('astro:page-load', init);
