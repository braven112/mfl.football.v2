/**
 * TheLeague free-agent table — filtering, sorting, rendering, the offseason
 * auction board, and the contract / value column groups.
 *
 * Extracted from a ~1,750-line `<script define:vars>` block in
 * src/pages/theleague/players.astro. It is a bundled module now, so it is
 * TypeScript, `astro check` covers it, and it CAN import — which the classic
 * form could not, and which is the whole reason this page talks to the
 * rankings layer over CustomEvents (`rankings:page-ready` and friends). That
 * bridge is left exactly as it was; replacing it with a direct import is a
 * behavior change and belongs in its own commit.
 *
 * The server hands its configuration over on `window.__TL_PLAYERS__` through a
 * one-line `define:vars` bridge in the page — the shape LineupPage.astro
 * already uses. It is destructured below into the identifiers the body already
 * used, so the body itself moved unchanged.
 *
 * See docs/claude/rules/client-data.md § Retiring an inline script.
 */

import type { PlayerRow, RankingLookupState } from './players-types';

const config = (window as any).__TL_PLAYERS__ as Record<string, any> | undefined;
if (!config) throw new Error('Missing __TL_PLAYERS__ payload');

const {
  playerDataJson,
  hasProjected,
  hasLastYrPts,
  hasSnapCounts,
  nflTeamsJson,
  hasSurplusData,
  hasAuctionData,
  isAuctionSeason,
  isAdmin,
  currentYear,
  mflHost,
  mflLeagueId,
  mflActionYear,
  franchiseNamesJson,
  franchiseBannersJson,
  defSpotlightJson,
  nflAvatarBgJson,
  nflAvatarBgFallback,
  nflAvatarBorderJson,
  nflAvatarBorderFallback,
  nflAvatarRingJson,
  nflAvatarRingFallback,
  nflAvatarRingDarkJson,
  nflAvatarRingDarkFallback,
  logoOnerror,
  collegeLogoOnerror,
  collegeLogoOnload,
  rookieDraftComplete,
} = config;

// define:vars creates const — copy to let so polling can update at runtime
let _hasAuctionData = hasAuctionData;
const players: PlayerRow[] = JSON.parse(playerDataJson);
// team code → marquee defender { name, espnId } for the DEF hero spotlight
const DEF_SPOTLIGHT = JSON.parse(defSpotlightJson);
const franchiseNameMap: Map<string, string> = new Map(JSON.parse(franchiseNamesJson));
const franchiseBannerMap: Map<string, string> = new Map(JSON.parse(franchiseBannersJson));

// State — default to free agents only
let filteredPlayers: PlayerRow[] = [];
let currentSort = isAuctionSeason ? 'auctionTimeLeft' : 'projected';
let sortDirection = isAuctionSeason ? 'asc' : 'desc';
let visibleCount = 50;
let activePosition = 'ALL';
let searchQuery = '';
let showRostered = false;
// Rookies default hidden until the league year's rookie draft is complete,
// then default shown (the leftovers are real free agents). The server
// renders the checkbox to match; deviating from the default is what counts
// as an "active filter" for the badge.
let showRookies = rookieDraftComplete;
const BATCH_SIZE = 50;
let lastAuctionFetchTime = 0;
let auctionPollTimer: ReturnType<typeof setInterval> | null = null;
let auctionFreshnessTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
const changedPlayerIds = new Set();
const AUCTION_END = new Date('2026-08-16T20:45:00-07:00').getTime(); // 3rd Sunday of August — offseason FA closes
const BID_WINDOW_MS = 36 * 60 * 60 * 1000; // 36-hour bid timer, resets only when proxy bid is exceeded
let auctionTimerInterval: ReturnType<typeof setInterval> | null = null;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

// Rankings lookup — populated by the rankings module script
let rankingLookup: RankingLookupState = { byImport: new Map(), columns: [] };
let hasExplicitSortPref = false;

// Column group visibility
// 'stats' = traditional stat columns
// 'rankings' = ranking import columns
// 'value' = focused value view (My Rank + money columns + age)
let activeView = isAuctionSeason ? 'auction' : 'stats';
let hasRankingColumns = false;
let hasExplicitViewPref = false;

function loadViewPref() {
  try {
    const saved = localStorage.getItem('playersViewMode');
    if (saved === 'rankings' || saved === 'stats' || saved === 'value' || saved === 'auction') {
      activeView = saved;
      hasExplicitViewPref = true;
    }
  } catch (_) {}
}

function saveViewPref() {
  try {
    localStorage.setItem('playersViewMode', activeView);
  } catch (_) {}
}

function applyGroupVisibility() {
  const canShowRankingsView = hasRankingColumns;
  const canShowValueView = isAdmin && (hasSurplusData || _hasAuctionData);
  const canShowAuctionView = _hasAuctionData;

  if (activeView === 'rankings' && !canShowRankingsView) {
    activeView = canShowAuctionView ? 'auction' : (canShowValueView ? 'value' : 'stats');
  }
  if (activeView === 'value' && !canShowValueView) {
    activeView = canShowRankingsView ? 'rankings' : 'stats';
  }
  if (activeView === 'auction' && !canShowAuctionView) {
    activeView = canShowRankingsView ? 'rankings' : 'stats';
  }

  const showStats = activeView === 'stats';
  const showRankings = activeView === 'rankings' && canShowRankingsView;
  const showValue = activeView === 'value' && canShowValueView;
  const showAuctionView = activeView === 'auction' && canShowAuctionView;

  // First reset all cell/header display styles.
  document.querySelectorAll<HTMLElement>('.players-table th, .players-table td').forEach(el => {
    el.style.display = '';
  });

  if (showValue) {
    // Value view: keep only Player, Age, one ranking column (My Rank or Avg), and the value money columns.
    document.querySelectorAll<HTMLElement>('.players-table th, .players-table td').forEach(el => {
      el.style.display = 'none';
    });
    const hasMyRank = document.querySelector('.players-table th.col-my-rank') !== null;
    const rankTh = hasMyRank ? '.players-table th.col-my-rank' : '.players-table th.col-ranking-avg';
    const rankTd = hasMyRank ? '.players-table td.col-my-rank' : '.players-table td.col-ranking-avg';
    const keepSelectors = [
      '.players-table th.col-rank',
      '.players-table th[data-sort="name"]',
      '.players-table th[data-sort="age"]',
      rankTh,
      '.players-table th.col-value-money',
      '.players-table td.cell-rank',
      '.players-table td.cell-player',
      '.players-table td.cell-age',
      rankTd,
      '.players-table td.col-value-money',
      '.players-table th.col-place-bid',
      '.players-table td.col-place-bid',
    ];
    for (const selector of keepSelectors) {
      document.querySelectorAll<HTMLElement>(selector).forEach(el => {
        el.style.display = '';
      });
    }
  } else if (showAuctionView) {
    // Auction view: Player + auction-specific columns only
    document.querySelectorAll<HTMLElement>('.players-table th, .players-table td').forEach(el => {
      el.style.display = 'none';
    });
    const keepSelectors = [
      '.players-table th.col-rank',           '.players-table td.cell-rank',
      '.players-table th[data-sort="name"]',  '.players-table td.cell-player',
      '.players-table th.col-group--auction',  '.players-table td.col-group--auction',
    ];
    for (const selector of keepSelectors) {
      document.querySelectorAll<HTMLElement>(selector).forEach(el => {
        el.style.display = '';
      });
    }
    // Hide auction Rank column if no rankings are loaded
    if (!hasRankingColumns) {
      document.querySelectorAll<HTMLElement>('.col-auction-rank').forEach(el => {
        el.style.display = 'none';
      });
    }
  } else {
    document.querySelectorAll<HTMLElement>('.col-group--stats').forEach(el => {
      el.style.display = showStats ? '' : 'none';
    });
    // PROJ column is permanently hidden
    document.querySelectorAll<HTMLElement>('.col-projected').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll<HTMLElement>('.col-group--rankings').forEach(el => {
      el.style.display = showRankings ? '' : 'none';
    });
    // Hide value-only columns outside value view. Keep My Rank visible in rankings view.
    document.querySelectorAll<HTMLElement>('.col-group--value:not(.col-group--rankings)').forEach(el => {
      el.style.display = 'none';
    });
    // Hide auction columns outside auction view
    document.querySelectorAll<HTMLElement>('.col-group--auction').forEach(el => {
      el.style.display = 'none';
    });
  }

  // Update button active states
  for (const group of ['stats', 'rankings', 'auction', 'value']) {
    const btn = document.querySelector(`.col-group-btn[data-group="${group}"]`);
    if (btn) {
      const isActive = group === activeView;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    }
  }

  // Hide unavailable toggle buttons
  const rankingsBtn = document.getElementById('col-group-btn-rankings');
  if (rankingsBtn) rankingsBtn.style.display = canShowRankingsView ? '' : 'none';
  const auctionBtn = document.getElementById('col-group-btn-auction');
  if (auctionBtn) auctionBtn.style.display = canShowAuctionView ? '' : 'none';
  const valueBtn = document.getElementById('col-group-btn-value');
  if (valueBtn) valueBtn.style.display = canShowValueView ? '' : 'none';

  // Show/hide the toggle bar when at least one alternate view is available
  const toggleBar = document.getElementById('col-group-toggles');
  if (toggleBar) {
    toggleBar.style.display = (canShowRankingsView || canShowAuctionView || canShowValueView) ? '' : 'none';
  }

  // Show/hide auction indicators in Value/Stats/Auction views
  const showAuctionIndicators = showValue || showAuctionView || activeView === 'stats';
  const freshnessEl = document.getElementById('auction-freshness');
  if (freshnessEl) {
    freshnessEl.style.display = (showAuctionIndicators && lastAuctionFetchTime > 0) ? '' : 'none';
  }
  const countdownEl = document.getElementById('auction-countdown');
  if (countdownEl) {
    countdownEl.style.display = (showAuctionIndicators && AUCTION_END > Date.now()) ? '' : 'none';
  }
  const legendEl = document.getElementById('bid-legend');
  if (legendEl) {
    legendEl.style.display = showAuctionIndicators ? '' : 'none';
  }

  // Start/stop per-player auction timer tick
  manageAuctionTimerInterval(showAuctionView);

  updateLastVisibleCol();
}

function applyContractVisibility() {
  // Show contract columns (Yrs, Sal/Bid) when viewing rostered players
  // OR when auction data exists (free agents have bids in the Sal/Bid column)
  const showContract = (showRostered || _hasAuctionData) && activeView !== 'value' && activeView !== 'auction';
  document.querySelectorAll<HTMLElement>('.col-contract').forEach(el => {
    el.style.display = showContract ? '' : 'none';
  });
  // Hide Yrs column when viewing free agents (only relevant for rostered players)
  if (!showRostered) {
    document.querySelectorAll<HTMLElement>('.col-contract-yrs').forEach(el => {
      el.style.display = 'none';
    });
  }
  updateLastVisibleCol();
}

function updateLastVisibleCol() {
  // Update header row
  const headerRow = document.querySelector('.players-table thead tr');
  if (headerRow) {
    const ths = headerRow.querySelectorAll('th');
    ths.forEach(th => th.classList.remove('last-visible-col'));
    for (let i = ths.length - 1; i >= 0; i--) {
      if (ths[i].style.display !== 'none') {
        ths[i].classList.add('last-visible-col');
        break;
      }
    }
  }
  // Update body rows
  document.querySelectorAll<HTMLElement>('.players-table tbody tr').forEach(tr => {
    const tds = tr.querySelectorAll('td');
    tds.forEach(td => td.classList.remove('last-visible-col'));
    for (let i = tds.length - 1; i >= 0; i--) {
      if (tds[i].style.display !== 'none') {
        tds[i].classList.add('last-visible-col');
        break;
      }
    }
  });
}

function setActiveView(view: string) {
  activeView = view;
  hasExplicitViewPref = true;
  saveViewPref();
  // Default sort Value view by Steal descending (biggest steals first)
  if (view === 'value' && !hasExplicitSortPref) {
    currentSort = 'stealValue';
    sortDirection = 'desc';
    sortPlayers();
  }
  // Default sort Auction view by Time Left ascending (soonest to expire first)
  if (view === 'auction') {
    currentSort = 'auctionTimeLeft';
    sortDirection = 'asc';
  }
  // Re-filter when switching to/from auction view (rostered players with bids are included in auction view)
  filterPlayers();
  applyGroupVisibility();
  applyContractVisibility();
}

loadViewPref();

// Query string override: ?view=stats|rankings|value|auction
const viewParam = new URLSearchParams(window.location.search).get('view');
if (viewParam && ['stats', 'rankings', 'value', 'auction'].includes(viewParam)) {
  activeView = viewParam;
}

const posOrder: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 4, PK: 5, DEF: 6 };


function getHeadshotUrl(playerId: string | null, espnId?: string | null) {
  if (espnId) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }
  return `https://${mflHost}/player_photos_big_2014/${playerId}_thumb.jpg`;
}

function getNflLogo(team: string) {
  // 'FA' / 'FA*' (conditional free agent) have no crest — use the shield.
  if (!team || team.indexOf('FA') === 0) return '/assets/nfl-logos/NFL.svg';
  return `/assets/nfl-logos/${team}.svg`;
}

// Team-color gradient backdrop behind a headshot avatar (same treatment as
// the player modal band). Precomputed server-side; FA/unknown → neutral blue.
// p.team is already the normalized ESPN code here — it's the same value that
// feeds getNflLogo() above, so it lines up with the ESPN-keyed gradient map by
// construction (a mismatch would break the team logo first).
const nflAvatarBg = JSON.parse(nflAvatarBgJson);
const nflAvatarBorder = JSON.parse(nflAvatarBorderJson);
const nflAvatarRing = JSON.parse(nflAvatarRingJson);
const nflAvatarRingDark = JSON.parse(nflAvatarRingDarkJson);
function getAvatarBg(team: string) {
  return nflAvatarBg[team] || nflAvatarBgFallback;
}
function getAvatarRing(team: string) {
  return nflAvatarRing[team] || nflAvatarRingFallback;
}
function getAvatarRingDark(team: string) {
  return nflAvatarRingDark[team] || nflAvatarRingDarkFallback;
}
function getAvatarBorder(team: string) {
  return nflAvatarBorder[team] || nflAvatarBorderFallback;
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

// ── Hero spotlight: mirror the #1 player of the current filter/sort ──
const spotlightEl = document.getElementById('hero-spotlight');
const spotlightLogoEl = document.getElementById('hero-spotlight-logo') as HTMLImageElement | null;
const spotlightHeadEl = document.getElementById('hero-spotlight-head') as HTMLImageElement | null;
const spotlightCaptionEl = document.getElementById('hero-spotlight-caption');
const spotlightLabelEl = document.getElementById('hero-spotlight-label');
const spotlightNameEl = document.getElementById('hero-spotlight-name');
const spotlightMetaEl = document.getElementById('hero-spotlight-meta');
let spotlightPlayerId: string | null = null;

// ── DEF face rotation ──
// A team defense has no headshot; DEF_SPOTLIGHT maps each team to a ranked pool
// of its marquee defenders. When a DEF is spotlighted we show one defender's
// ESPN headshot over the logo watermark and (unless reduced-motion) rotate
// through the pool so it doesn't feel static.
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
  // No match for the current filter — hide the caption + headshot and reset
  // the panel so a stale team logo / DEF state doesn't linger behind it.
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
  // NB: headshot visibility is set inside the image-swap branches below, NOT
  // here — doing it before the same-player early-return would re-reveal a
  // headshot we'd hidden because its ESPN image 404'd (same #1 player across a
  // re-sort), flashing the broken image back in.
  // Team defense → its rotating pool of marquee defenders (used both by the
  // caption below and the image swap further down).
  const isDef = p.position === 'DEF';
  const defPlayers = isDef ? (DEF_SPOTLIGHT[p.team] || []) : [];
  const hasDefFace = defPlayers.length > 0;

  // The caption depends on the active position filter, not just the player,
  // so always refresh it — switching ALL→QB can keep the same #1 player but
  // the label must still flip from "Top Free Agent" to "Top QB".
  if (spotlightLabelEl) {
    // Label tracks the active filter (DEF tab → "Top DEF"), not whether the #1
    // happens to be a mapped defense — so ALL keeps saying "Top Free Agent".
    spotlightLabelEl.textContent = activePosition && activePosition !== 'ALL'
      ? 'Top ' + (activePosition === 'PK' ? 'K' : activePosition)
      : 'Top Free Agent';
  }
  // For a mapped DEF the rotating defender name is set by applyDefFace(); the
  // meta row below still carries the DEF unit's context (DEF · TEAM · pts).
  if (!hasDefFace && spotlightNameEl) spotlightNameEl.textContent = p.name;
  if (spotlightMetaEl) {
    const posLabel = p.position === 'PK' ? 'K' : p.position;
    const parts = [posLabel];
    if (p.team && p.team.indexOf('FA') !== 0) parts.push(p.team);
    if (p.projected != null) parts.push(p.projected.toFixed(1) + ' pts');
    spotlightMetaEl.textContent = parts.join(' · ');
  }

  // Only the image swap (and its entrance animation) is skipped when the #1
  // player is unchanged — the caption above has already been refreshed. For a
  // DEF, the unit id is the stable anchor while the defender FACE rotates within
  // it via applyDefFace(), so keeping the running rotation here is correct.
  if (p.id === spotlightPlayerId) return;
  spotlightPlayerId = p.id;
  stopDefRotation();

  const logo = getNflLogo(p.team);
  spotlightEl.setAttribute('data-def', isDef ? 'true' : 'false');
  spotlightEl.setAttribute('data-def-player', hasDefFace ? 'true' : 'false');

  if (spotlightLogoEl) spotlightLogoEl.src = logo;

  if (hasDefFace) {
    // DEF with a mapped pool → rotate through the defenders' headshots.
    // startDefRotation()/applyDefFace() set the head src/onerror + rotating name.
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
    spotlightHeadEl.offsetHeight;
    spotlightHeadEl.style.animation = '';
  }
}

// ── Auction view helpers ──
function getTimeLeftMs(anchorTime: number | null | undefined) {
  if (anchorTime == null) return null;
  // anchorTime from API is Unix seconds — convert to ms
  const anchorMs = anchorTime > 1e12 ? anchorTime : anchorTime * 1000;
  const deadline = anchorMs + BID_WINDOW_MS;
  const remaining = deadline - Date.now();
  return remaining > 0 ? remaining : 0;
}

function getTimeLeftTier(ms: number | null) {
  if (ms == null) return 'none';
  if (ms <= 0) return 'ended';
  if (ms < 60 * 60 * 1000) return 'critical';
  if (ms < 6 * 60 * 60 * 1000) return 'urgent';
  if (ms < 24 * 60 * 60 * 1000) return 'closing';
  return 'normal';
}

function formatTimeLeft(ms: number | null, tier: string) {
  if (ms == null || ms <= 0) return 'Ended';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  let time;
  if (tier === 'critical') {
    const s = Math.floor((ms % 60_000) / 1000);
    time = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
    return `\u26a0 ${time}`;
  }
  time = `${h}h ${String(m).padStart(2, '0')}m`;
  if (tier === 'urgent') return `\u26a0 ${time}`;
  return time;
}

function formatRelativeTime(timestamp: number) {
  if (timestamp == null) return null;
  const tsMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const diff = Date.now() - tsMs;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}

function getAuctionRank(player: PlayerRow) {
  // Use composite rank if available, else average rank, else first ranking source
  const compositeMap = rankingLookup.byImport.get('__composite__');
  if (compositeMap) {
    const v = compositeMap.get(player.id);
    if (v != null) return v;
  }
  // Fall back to average across all ranking sources
  let sum = 0, count = 0;
  for (const col of rankingLookup.columns) {
    if (col.isComposite || col.isAverage) continue;
    const v = rankingLookup.byImport.get(col.importId)?.get(player.id);
    if (v != null) { sum += v; count++; }
  }
  if (count > 0) return Math.round(sum / count);
  return null;
}

function sortPlayers() {
  filteredPlayers.sort((a, b) => {
    let aVal, bVal;
    switch (currentSort) {
      case 'name':
        return sortDirection === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      case 'position':
        aVal = posOrder[a.position] || 99;
        bVal = posOrder[b.position] || 99;
        break;
      case 'team':
        return sortDirection === 'asc'
          ? a.team.localeCompare(b.team)
          : b.team.localeCompare(a.team);
      case 'age':
        aVal = a.age ?? 999;
        bVal = b.age ?? 999;
        break;
      case 'exp':
        aVal = a.exp ?? -1;
        bVal = b.exp ?? -1;
        break;
      case 'projected':
        aVal = a.projected ?? -1;
        bVal = b.projected ?? -1;
        break;
      case 'draftRd':
        aVal = a.draftRd ?? 99;
        bVal = b.draftRd ?? 99;
        break;
      case 'height':
        aVal = a.height ?? -1;
        bVal = b.height ?? -1;
        break;
      case 'weight':
        aVal = a.weight ?? -1;
        bVal = b.weight ?? -1;
        break;
      case 'lastYrPts':
        aVal = a.lastYrPts ?? -1;
        bVal = b.lastYrPts ?? -1;
        break;
      case 'snaps':
        aVal = a.snaps ?? -1;
        bVal = b.snaps ?? -1;
        break;
      case 'snapPct':
        aVal = a.snapPct ?? -1;
        bVal = b.snapPct ?? -1;
        break;
      case 'college':
        return sortDirection === 'asc'
          ? (a.college || 'zzz').localeCompare(b.college || 'zzz')
          : (b.college || 'zzz').localeCompare(a.college || 'zzz');
      case 'contractYrs':
        aVal = a.contractYrs ?? -1;
        bVal = b.contractYrs ?? -1;
        break;
      case 'salary':
        aVal = a.salary ?? a.auctionBid ?? -1;
        bVal = b.salary ?? b.auctionBid ?? -1;
        break;
      case 'games':
        aVal = a.games ?? -1;
        bVal = b.games ?? -1;
        break;
      case 'ppg':
        aVal = a.ppg ?? -1;
        bVal = b.ppg ?? -1;
        break;
      case 'estimatedCost':
        aVal = a.estimatedCost ?? -1;
        bVal = b.estimatedCost ?? -1;
        break;
      case 'salaryYear1':
        aVal = a.salaryYear1 ?? -1;
        bVal = b.salaryYear1 ?? -1;
        break;
      case 'salaryYear2':
        aVal = a.salaryYear2 ?? -1;
        bVal = b.salaryYear2 ?? -1;
        break;
      case 'salaryYear3':
        aVal = a.salaryYear3 ?? -1;
        bVal = b.salaryYear3 ?? -1;
        break;
      case 'dollarValue':
        aVal = a.dollarValue ?? -1;
        bVal = b.dollarValue ?? -1;
        break;
      case 'surplusValue':
        aVal = a.surplusValue ?? -Infinity;
        bVal = b.surplusValue ?? -Infinity;
        break;
      case 'stealValue':
        aVal = (a.dollarValue != null && a.auctionBid != null && a.auctionBid > 0) ? a.dollarValue - a.auctionBid : -Infinity;
        bVal = (b.dollarValue != null && b.auctionBid != null && b.auctionBid > 0) ? b.dollarValue - b.auctionBid : -Infinity;
        break;
      case 'auctionBid':
        aVal = a.auctionBid ?? -1;
        bVal = b.auctionBid ?? -1;
        break;
      case 'auctionFranchise':
        return sortDirection === 'asc'
          ? (franchiseNameMap.get(a.auctionFranchise || '') || 'zzz').localeCompare(franchiseNameMap.get(b.auctionFranchise || '') || 'zzz')
          : (franchiseNameMap.get(b.auctionFranchise || '') || 'zzz').localeCompare(franchiseNameMap.get(a.auctionFranchise || '') || 'zzz');
      case 'auctionInitTime':
        aVal = a.auctionInitTime ?? -1;
        bVal = b.auctionInitTime ?? -1;
        break;
      case 'auctionBidTime':
        aVal = a.auctionBidTime ?? -1;
        bVal = b.auctionBidTime ?? -1;
        break;
      case 'auctionRank': {
        // Composite rank if available, else average, else single ranking
        const aRank = getAuctionRank(a);
        const bRank = getAuctionRank(b);
        aVal = aRank ?? 9999;
        bVal = bRank ?? 9999;
        break;
      }
      case 'auctionTimeLeft': {
        // Active bids first (sorted by time remaining asc), won second, no bid last
        const aTime = getTimeLeftMs(a.auctionBidTime ?? a.auctionInitTime);
        const bTime = getTimeLeftMs(b.auctionBidTime ?? b.auctionInitTime);
        if (a.auctionStatus === 'won' && b.auctionStatus !== 'won') return 1;
        if (b.auctionStatus === 'won' && a.auctionStatus !== 'won') return -1;
        aVal = aTime != null ? aTime : (a.auctionStatus === 'won' ? Infinity - 1 : Infinity);
        bVal = bTime != null ? bTime : (b.auctionStatus === 'won' ? Infinity - 1 : Infinity);
        break;
      }
      default:
        // Dynamic ranking columns: sort key is "ranking_{importId}"
        if (currentSort.startsWith('ranking_')) {
          const importId = currentSort.slice(8); // skip "ranking_"
          const map = rankingLookup.byImport.get(importId);
          aVal = map?.get(a.id) ?? 9999;
          bVal = map?.get(b.id) ?? 9999;
        } else {
          aVal = a.projected ?? -1;
          bVal = b.projected ?? -1;
        }
    }
    const diff = aVal - bVal;
    return sortDirection === 'desc' ? -diff : diff;
  });
}

// Shared advanced-filter predicate (used for both filtering and counting)
function passesAdvancedFilters(p: PlayerRow) {
  // NFL Team filter
  if (filterTeam && p.team !== filterTeam) return false;

  // Age range
  if (filterAgeMin != null && (p.age == null || p.age < filterAgeMin)) return false;
  if (filterAgeMax != null && (p.age == null || p.age > filterAgeMax)) return false;

  // Experience filter
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

  // Draft round filter
  if (filterDraft) {
    switch (filterDraft) {
      case '1': if (p.draftRd !== 1) return false; break;
      case '2': if (p.draftRd !== 2) return false; break;
      case '3': if (p.draftRd !== 3) return false; break;
      case '4+': if (p.draftRd == null || p.draftRd < 4) return false; break;
      case 'udfa': if (p.draftRd != null) return false; break;
    }
  }

  // Height filter (in inches)
  if (filterHtMin != null && (p.height == null || p.height < filterHtMin)) return false;
  if (filterHtMax != null && (p.height == null || p.height > filterHtMax)) return false;

  // Weight filter (in lbs)
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
  if (showRookies !== rookieDraftComplete) count++;
  return count;
}

function updateFilterBadge() {
  const badge = document.getElementById('filter-badge');
  const count = countActiveFilters();
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
  }
  // Also update the button active state
  const btn = document.getElementById('filter-toggle-btn');
  if (btn) btn.classList.toggle('has-filters', count > 0);
}

function filterPlayers() {
  const query = searchQuery.toLowerCase();
  filteredPlayers = players.filter(p => {
    // Free agent filter (default on)
    // In auction view, always show rostered players that have active bids
    if (!showRostered && p.rostered) {
      if (!(activeView === 'auction' && p.auctionBid != null)) return false;
    }

    // Rookie filter (defaults hidden pre-draft, shown post-draft)
    if (!showRookies && p.rookie) return false;

    // Position filter
    if (activePosition !== 'ALL' && p.position !== activePosition) return false;

    // Advanced filters
    if (!passesAdvancedFilters(p)) return false;

    // Search
    if (query) {
      return p.name.toLowerCase().includes(query) ||
             p.team.toLowerCase().includes(query);
    }
    return true;
  });

  // Update category counts based on current filters + search (minus position filter)
  const pool = players.filter(p => {
    if (!showRostered && p.rostered) {
      if (!(activeView === 'auction' && p.auctionBid != null)) return false;
    }
    if (!showRookies && p.rookie) return false;
    if (!passesAdvancedFilters(p)) return false;
    if (query) {
      return p.name.toLowerCase().includes(query) ||
             p.team.toLowerCase().includes(query);
    }
    return true;
  });
  const counts: Record<string, number> = { ALL: pool.length };
  for (const p of pool) {
    counts[p.position] = (counts[p.position] || 0) + 1;
  }
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

  // Update controls
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
    const rosteredClass = p.rostered ? ' row--rostered' : '';

    const modalJson = escapeAttr(JSON.stringify({
      id: p.id, espnId: p.espnId || null, name: p.name,
      position: p.position, nflTeam: p.team,
      college: p.college || null, height: p.height || null,
      weight: p.weight || null, number: p.jersey || null,
      birthdate: p.birthdate || null, experience: p.exp != null ? p.exp : null,
      draftYear: p.draftYear || null, draftTeam: p.draftTeam || null,
      draftRound: p.draftRd || null, draftPick: p.draftPick || null,
      points: p.projected != null ? p.projected : null,
      offenseSnaps: p.snaps != null ? p.snaps : null,
      // Rostered players carry their owner, so the modal band wears the
      // FANTASY team and names it — without this every player on this page
      // opened as a free agent, including the ones that aren't.
      franchiseId: p.franchiseId || null,
      salary: p.salary != null ? p.salary : null,
      contractYears: p.contractYrs != null ? p.contractYrs : null,
    }));
    const rosteredTeam = p.franchiseId ? franchiseNameMap.get(p.franchiseId) : null;
    const rosteredDot = p.rostered
      ? `<span class="rostered-dot" title="${escapeAttr(rosteredTeam ? 'Rostered by ' + rosteredTeam : 'Rostered')}"></span>`
      : '';

    html += `<tr class="${rosteredClass}" data-pos="${p.position.toLowerCase()}" data-player-id="${p.id}">
      <td class="cell-rank">${rank}</td>
      <td class="cell-player">
        <div class="player-cell">
          <div class="player-cell__avatar${isDef ? ' player-cell__avatar--def' : ''}"${isDef ? '' : ` style="--player-avatar-bg: ${getAvatarBg(p.team)}; --player-avatar-border: ${getAvatarBorder(p.team)}; --player-avatar-ring: ${getAvatarRing(p.team)}; --player-avatar-ring-dark: ${getAvatarRingDark(p.team)}"`}>
            <img src="${headshot}" alt="" loading="lazy" decoding="async"
              onerror="${isDef ? escapeAttr(logoOnerror) : escapeAttr(buildOnerror(p.id, p.espnId))}" />
          </div>
          <div class="player-cell__info">
            <strong class="player-cell__name player-cell__name--clickable" data-player-modal="${modalJson}">${p.name}${rosteredDot}</strong>
            <div class="player-meta">
              ${isDef ? '' : `<img src="${escapeAttr(logo)}" alt="${escapeAttr(p.team)}" class="player-meta__logo" onerror="${escapeAttr(logoOnerror)}" />`}<span class="player-meta__pos">${posLabel}</span>
            </div>
          </div>
        </div>
      </td>
      <td class="cell-age">${p.age ?? '-'}</td>
      <td class="cell-sm col-always-profile">${p.exp != null ? p.exp : '-'}</td>`;

    const htDisplay = p.height ? Math.floor(p.height / 12) + "'" + (p.height % 12) + '"' : '-';
    const wtDisplay = p.weight ? p.weight + '' : '-';
    html += `<td class="cell-sm col-always-profile">${p.draftRd != null ? 'Rd ' + p.draftRd : '<span class="na">-</span>'}</td>
      <td class="cell-college col-group--stats">${p.collegeLogo ? `<img src="${escapeAttr(p.collegeLogo)}" alt="${escapeAttr(p.college || '')}" title="${escapeAttr(p.college || '')}" class="college-logo" loading="lazy" decoding="async" onerror="${escapeAttr(collegeLogoOnerror)}" onload="${escapeAttr(collegeLogoOnload)}" />` : (p.college ? `<span class="na" title="${escapeAttr(p.college)}">-</span>` : '<span class="na">-</span>')}</td>
      <td class="cell-sm col-always-profile">${htDisplay}</td>
      <td class="cell-sm col-always-profile">${wtDisplay}</td>`;

    // Dynamic ranking columns
    for (const col of rankingLookup.columns) {
      const rnk = rankingLookup.byImport.get(col.importId)?.get(p.id);
      const avgCls = col.isAverage ? ' col-ranking-avg' : '';
      const compositeCls = col.isComposite ? ' col-ranking-composite' : '';
      const borderCls = col.isLastCompositeMember ? ' col-ranking-member-last' : '';
      const myRankCls = col.isComposite ? ' col-my-rank col-group--value' : '';
      html += `<td class="cell-num col-group--rankings${avgCls}${compositeCls}${borderCls}${myRankCls}">${rnk != null ? rnk : '<span class="na">-</span>'}</td>`;
    }

    if (hasSnapCounts) {
      html += `<td class="cell-sm col-group--stats">${p.games != null ? p.games : '<span class="na">-</span>'}</td>`;
      html += `<td class="cell-sm col-group--stats">${p.snaps != null ? p.snaps : '<span class="na">-</span>'}</td>`;
      html += `<td class="cell-num col-group--stats">${p.snapPct != null ? p.snapPct.toFixed(1) + '%' : '<span class="na">-</span>'}</td>`;
    }

    if (hasLastYrPts) {
      html += `<td class="cell-num col-group--stats">${p.lastYrPts != null ? p.lastYrPts.toFixed(1) : '<span class="na">-</span>'}</td>`;
    }

    if (hasLastYrPts && hasSnapCounts) {
      html += `<td class="cell-num col-group--stats col-value-ppg">${p.ppg != null ? p.ppg.toFixed(1) : '<span class="na">-</span>'}</td>`;
    }

    if (hasProjected) {
      html += `<td class="cell-num cell-pts col-group--stats col-projected" style="display: none;">${p.projected != null ? p.projected.toFixed(1) : '<span class="na">-</span>'}</td>`;
    }

    // Auction bid cell (admin only, always rendered when admin so column count matches <th>)
    if (isAdmin) {
      const tierCls = getBidTierClass(p.auctionStatus, p.auctionBidTime);
      const changedCls = changedPlayerIds.has(p.id) ? ' col-value-bid--changed' : '';
      if (p.auctionBid != null && p.auctionBid > 0) {
        const bidFmt = p.auctionBid >= 1000000
          ? '$' + (p.auctionBid / 1000000).toFixed(1) + 'M'
          : '$' + (p.auctionBid / 1000).toFixed(0) + 'K';
        const titleText = getBidTitleText(p.auctionStatus, p.auctionBidTime);
        html += `<td class="cell-num col-group--value col-value-money col-value-bid ${tierCls}${changedCls}" title="${titleText}">${bidFmt}</td>`;
      } else {
        html += `<td class="cell-num col-group--value col-value-money col-value-bid col-value-bid--none"><span class="na">&mdash;</span></td>`;
      }
    }

    if (isAdmin && hasSurplusData) {
      const fmtDollar = (v: number | null | undefined) => {
        if (v == null) return '<span class="na">-</span>';
        const abs = Math.abs(v);
        const sign = v < 0 ? '-' : '';
        return sign + '$' + (abs >= 1000000 ? (abs / 1000000).toFixed(1) + 'M' : (abs / 1000).toFixed(0) + 'K');
      };
      html += `<td class="cell-num col-group--value col-value-money">${fmtDollar(p.estimatedCost)}</td>`;
      html += `<td class="cell-num col-group--value col-value-money">${fmtDollar(p.dollarValue)}</td>`;
    }

    // Steal = $ Value - Bid (how much value you get for the current price)
    {
      const steal = (p.dollarValue != null && p.auctionBid != null && p.auctionBid > 0)
        ? p.dollarValue - p.auctionBid
        : null;
      if (steal != null) {
        const abs = Math.abs(steal);
        const formatted = abs >= 1000000 ? (abs / 1000000).toFixed(1) + 'M' : (abs / 1000).toFixed(0) + 'K';
        const isPositive = steal > 0;
        const prefix = isPositive ? '+$' : '-$';
        // Green intensity gradient: bigger steal = brighter green
        let cls = 'steal-neutral';
        if (isPositive && abs >= 3000000) cls = 'steal-hot';
        else if (isPositive && abs >= 1000000) cls = 'steal-warm';
        else if (isPositive) cls = 'steal-mild';
        else cls = 'steal-negative';
        html += `<td class="cell-num col-group--value col-value-money col-steal ${cls}">${prefix}${formatted}</td>`;
      } else {
        html += `<td class="cell-num col-group--value col-value-money col-steal"><span class="na">&mdash;</span></td>`;
      }
    }

    // Place Bid button (Value view only — links to MFL's Place Bid page with player pre-selected)
    {
      const bidUrl = `https://${mflHost}/${mflActionYear}/options?L=${mflLeagueId}&O=43&P=${encodeURIComponent(p.id)}`;
      html += `<td class="col-group--value col-value-money col-place-bid"><a href="${escapeAttr(bidUrl)}" target="_blank" rel="noopener" class="place-bid-link" aria-label="Place bid on ${escapeAttr(p.name)} (opens in new tab)">Bid &#8599;</a></td>`;
    }

    // ── Auction view cells ──
    {
      // Ranking
      const rnk = getAuctionRank(p);
      html += `<td class="cell-num col-group--auction col-auction-rank">${rnk != null ? rnk : '<span class="na">&mdash;</span>'}</td>`;

      // Current Bid (matches salary/bid column styling)
      if (p.auctionBid != null && p.auctionBid > 0) {
        const tierCls = getBidTierClass(p.auctionStatus, p.auctionBidTime);
        const changedCls = changedPlayerIds.has(p.id) ? ' col-value-bid--changed' : '';
        const bidFmt = p.auctionBid >= 1000000
          ? '$' + (p.auctionBid / 1000000).toFixed(1) + 'M'
          : '$' + (p.auctionBid / 1000).toFixed(0) + 'K';
        const titleText = getBidTitleText(p.auctionStatus, p.auctionBidTime);
        html += `<td class="cell-num col-group--auction col-auction-bid col-value-bid ${tierCls}${changedCls}" title="${titleText}">${bidFmt}</td>`;
      } else {
        html += `<td class="cell-num col-group--auction col-auction-bid"><span class="na">&mdash;</span></td>`;
      }

      // High Bidder (team banner image)
      const bidderName = p.auctionFranchise ? (franchiseNameMap.get(p.auctionFranchise) || p.auctionFranchise) : null;
      const bidderBanner = p.auctionFranchise ? franchiseBannerMap.get(p.auctionFranchise) : null;
      if (bidderBanner) {
        html += `<td class="col-group--auction col-auction-bidder" title="${escapeAttr(bidderName || '')}"><img src="${escapeAttr(bidderBanner)}" alt="${escapeAttr(bidderName || '')}" class="bidder-banner" width="100" loading="lazy"></td>`;
      } else if (bidderName) {
        html += `<td class="col-text col-group--auction col-auction-bidder" title="${escapeAttr(bidderName)}">${escapeAttr(bidderName)}</td>`;
      } else {
        html += `<td class="col-text col-group--auction col-auction-bidder"><span class="na">&mdash;</span></td>`;
      }

      // Started
      const startedText = formatRelativeTime(p.auctionInitTime);
      html += `<td class="col-text col-group--auction col-auction-started">${startedText || '<span class="na">&mdash;</span>'}</td>`;

      // Last Bid
      const lastBidText = formatRelativeTime(p.auctionBidTime);
      html += `<td class="col-text col-group--auction col-auction-lastbid">${lastBidText || '<span class="na">&mdash;</span>'}</td>`;

      // Time Left
      if (p.auctionStatus === 'won') {
        html += `<td class="cell-num col-group--auction col-auction-timeleft col-auction-timeleft--won">Won</td>`;
      } else if (p.auctionBidTime != null || p.auctionInitTime != null) {
        const timerStart = p.auctionBidTime ?? p.auctionInitTime;
        const tlMs = getTimeLeftMs(timerStart);
        const tier = getTimeLeftTier(tlMs);
        const tlText = tlMs != null && tlMs > 0 ? formatTimeLeft(tlMs, tier) : 'Ended';
        const tierCls = tier === 'none' ? '' : ` col-auction-timeleft--${tier}`;
        html += `<td class="cell-num col-group--auction col-auction-timeleft${tierCls}" aria-label="Time left: ${tlText}" data-bid-time="${timerStart}">${tlText}</td>`;
      } else {
        html += `<td class="cell-num col-group--auction col-auction-timeleft"><span class="na">&mdash;</span></td>`;
      }

      // Place Bid (auction view)
      const bidUrl = `https://${mflHost}/${mflActionYear}/options?L=${mflLeagueId}&O=43&P=${encodeURIComponent(p.id)}`;
      if (p.auctionStatus === 'won') {
        html += `<td class="col-group--auction col-auction-placebid"></td>`;
      } else {
        html += `<td class="col-group--auction col-auction-placebid"><a href="${escapeAttr(bidUrl)}" target="_blank" rel="noopener" class="place-bid-link" aria-label="Place bid on ${escapeAttr(p.name)} (opens in new tab)">Bid &#8599;</a></td>`;
      }
    }

    html += `<td class="cell-sm col-contract col-contract-yrs">${p.contractYrs != null ? p.contractYrs : (p.rostered ? '<span class="na">-</span>' : '<span class="fa-tag">FA</span>')}</td>`;
    // Salary cell — show auction bid for free agents without a salary
    if (p.salary != null && p.salary > 0) {
      html += `<td class="cell-num col-contract">$${p.salary >= 1000000 ? (p.salary / 1000000).toFixed(2) + 'M' : (p.salary / 1000).toFixed(0) + 'K'}</td>`;
    } else if (p.auctionBid != null && p.auctionBid > 0) {
      const tierCls = getBidTierClass(p.auctionStatus, p.auctionBidTime);
      const changedCls = changedPlayerIds.has(p.id) ? ' col-value-bid--changed' : '';
      const bidFmt = p.auctionBid >= 1000000
        ? '$' + (p.auctionBid / 1000000).toFixed(1) + 'M'
        : '$' + (p.auctionBid / 1000).toFixed(0) + 'K';
      const titleText = getBidTitleText(p.auctionStatus, p.auctionBidTime);
      html += `<td class="cell-num col-contract col-value-bid ${tierCls}${changedCls}" title="${titleText}">${bidFmt}</td>`;
    } else {
      html += `<td class="cell-num col-contract"><span class="na">-</span></td>`;
    }

    // Acquisition action cell — free agents only, and not an already-won
    // auction player (mirrors the auction-view Bid cell). During the offseason
    // auction we deep-link to MFL's per-player Place Bid page; the rest of the
    // year we deep-link to MFL's add/drop page, which itself auto-presents
    // blind-bid (waiver) vs FCFS based on MFL's own in-season schedule. MFL is
    // the final gatekeeper on timing/cap/roster, so no phase math is needed.
    if (!p.rostered && !(isAuctionSeason && p.auctionStatus === 'won')) {
      const acqUrl = isAuctionSeason
        ? `https://${mflHost}/${mflActionYear}/options?L=${mflLeagueId}&O=43&P=${encodeURIComponent(p.id)}`
        : `https://${mflHost}/${mflActionYear}/add_drop?L=${mflLeagueId}`;
      const acqLabel = isAuctionSeason ? 'Bid' : 'Add';
      html += `<td class="col-fa-action"><a href="${escapeAttr(acqUrl)}" target="_blank" rel="noopener" class="place-bid-link" aria-label="${acqLabel} ${escapeAttr(p.name)} on MyFantasyLeague (opens in new tab)">${acqLabel} &#8599;</a></td>`;
    } else {
      html += `<td class="col-fa-action"></td>`;
    }

    html += `</tr>`;
  }

  tbody.innerHTML = html;

  // Update sort indicators — only add arrow span to the actively sorted column
  document.querySelectorAll<HTMLElement>('.players-table th.sortable').forEach(th => {
    const content = th.querySelector('.th-content');
    const existingArrow = th.querySelector('.sort-arrow');
    const sortKey = th.getAttribute('data-sort');
    if (sortKey === currentSort) {
      th.classList.add('sorted');
      if (!existingArrow && content) {
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        arrow.textContent = sortDirection === 'asc' ? '\u25B2' : '\u25BC';
        content.appendChild(arrow);
      } else if (existingArrow) {
        existingArrow.textContent = sortDirection === 'asc' ? '\u25B2' : '\u25BC';
      }
    } else {
      th.classList.remove('sorted');
      if (existingArrow) existingArrow.remove();
    }
  });

  const noDataEl = document.getElementById('no-data');
  if (noDataEl) {
    noDataEl.style.display = players.length === 0 ? 'block' : 'none';
  }

  // Re-apply column group visibility after tbody re-render
  applyGroupVisibility();
  applyContractVisibility();

  // Mirror the #1 player of the current filter/sort in the hero spotlight
  updateSpotlight(filteredPlayers[0] || null);
}

// Columns that default to desc when first clicked
const descDefaults = new Set(['projected', 'exp', 'height', 'weight', 'lastYrPts', 'snaps', 'snapPct', 'contractYrs', 'salary', 'games', 'ppg', 'estimatedCost', 'salaryYear1', 'salaryYear2', 'salaryYear3', 'dollarValue', 'surplusValue', 'stealValue', 'auctionBid', 'auctionInitTime', 'auctionBidTime']);

// CustomEvent-based API for the rankings module script to interact with this page.
// All events use the document as the event bus — no global window properties needed.
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
  hasRankingColumns = (e as CustomEvent).detail.hasColumns;
  if ((e as CustomEvent).detail.hasColumns && !hasExplicitViewPref && !isAuctionSeason) {
    // Default to rankings view when available and user hasn't explicitly chosen
    // (auction season defaults to auction view instead)
    activeView = 'rankings';
  } else if (!(e as CustomEvent).detail.hasColumns && activeView === 'rankings') {
    // If ranking imports are removed while viewing rankings, fall back to
    // value view when available, otherwise stats.
    activeView = (isAdmin && (hasSurplusData || _hasAuctionData)) ? 'value' : 'stats';
  }
  // Auto-sort by "My Rank" composite when it exists and user hasn't explicitly sorted
  if ((e as CustomEvent).detail.hasComposite && !hasExplicitSortPref && !isAuctionSeason) {
    currentSort = 'ranking___composite__';
    sortDirection = 'asc';
  }
  applyGroupVisibility();
  applyContractVisibility();
});

document.addEventListener('rankings:set-sort', function (e: Event) {
  if (!isLivePage()) return;
  // A null key means the ranking column we were sorted by is gone entirely —
  // restore this page's own default rather than keep sorting by a column
  // that no longer exists.
  if ((e as CustomEvent).detail.key == null) {
    currentSort = isAuctionSeason ? 'auctionTimeLeft' : 'projected';
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
  render();
});

document.addEventListener('rankings:refilter', function () {
  if (!isLivePage()) return;
  filterPlayers();
});

// Synchronous request for sort state — the module script reads detail after dispatch
document.addEventListener('rankings:get-sort', function (e: Event) {
  if (!isLivePage()) return;
  (e as CustomEvent).detail.currentSort = currentSort;
  (e as CustomEvent).detail.descDefaults = descDefaults;
});

// Signal that the inline script is ready for the module script
document.dispatchEvent(new CustomEvent('rankings:page-ready'));

function init() {
  // Prevent duplicate listeners on re-init (Astro view transitions)
  const table = document.getElementById('players-table');
  if (!table || table.dataset.init) return;
  table.dataset.init = 'true';

  // Category tabs (position pills in hero)
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

  // Search
  const searchInput = document.getElementById('player-search');
  if (searchInput) {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = (e.target as HTMLInputElement).value;
        filterPlayers();
      }, 200);
    });
  }

  // Filter panel toggle
  const filterToggleBtn = document.getElementById('filter-toggle-btn');
  const filtersPanel = document.getElementById('filters-panel');
  if (filterToggleBtn && filtersPanel) {
    filterToggleBtn.addEventListener('click', () => {
      filtersOpen = !filtersOpen;
      filtersPanel.classList.toggle('open', filtersOpen);
      filterToggleBtn.classList.toggle('active', filtersOpen);
      filterToggleBtn.setAttribute('aria-expanded', String(filtersOpen));
      // Collapsed panel is visually clipped — keep it out of the tab order too
      filtersPanel.inert = !filtersOpen;
    });
  }

  // Include rostered toggle. State is read back from the checkbox at init:
  // under Astro's ClientRouter this inline script runs once per real page
  // load, so after a view-transition swap the fresh DOM (unchecked default)
  // is the truth while the module's persisted variable may hold a stale
  // true from the previous visit.
  const rosterCheck = document.getElementById('show-rostered') as HTMLInputElement | null;
  if (rosterCheck) {
    showRostered = rosterCheck.checked;
    rosterCheck.addEventListener('change', (e) => {
      showRostered = (e.target as HTMLInputElement).checked;
      filterPlayers();
    });
  }

  // Include rookies toggle (same DOM read-back as show-rostered above)
  const rookieCheck = document.getElementById('show-rookies') as HTMLInputElement | null;
  if (rookieCheck) {
    showRookies = rookieCheck.checked;
    rookieCheck.addEventListener('change', (e) => {
      showRookies = (e.target as HTMLInputElement).checked;
      filterPlayers();
    });
  }

  // NFL Team filter
  const teamSelect = document.getElementById('filter-team') as HTMLSelectElement | null;
  if (teamSelect) {
    teamSelect.addEventListener('change', (e) => {
      filterTeam = (e.target as HTMLInputElement).value;
      filterPlayers();
    });
  }

  // Age range filters
  const ageMin = document.getElementById('filter-age-min') as HTMLInputElement | null;
  const ageMax = document.getElementById('filter-age-max') as HTMLInputElement | null;
  if (ageMin) {
    ageMin.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value ? parseInt((e.target as HTMLInputElement).value, 10) : null;
      filterAgeMin = (val && !isNaN(val)) ? val : null;
      filterPlayers();
    });
  }
  if (ageMax) {
    ageMax.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value ? parseInt((e.target as HTMLInputElement).value, 10) : null;
      filterAgeMax = (val && !isNaN(val)) ? val : null;
      filterPlayers();
    });
  }

  // Height range filters
  const htMin = document.getElementById('filter-ht-min') as HTMLInputElement | null;
  const htMax = document.getElementById('filter-ht-max') as HTMLInputElement | null;
  if (htMin) {
    htMin.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value ? parseInt((e.target as HTMLInputElement).value, 10) : null;
      filterHtMin = (val && !isNaN(val)) ? val : null;
      filterPlayers();
    });
  }
  if (htMax) {
    htMax.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value ? parseInt((e.target as HTMLInputElement).value, 10) : null;
      filterHtMax = (val && !isNaN(val)) ? val : null;
      filterPlayers();
    });
  }

  // Weight range filters
  const wtMin = document.getElementById('filter-wt-min') as HTMLInputElement | null;
  const wtMax = document.getElementById('filter-wt-max') as HTMLInputElement | null;
  if (wtMin) {
    wtMin.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value ? parseInt((e.target as HTMLInputElement).value, 10) : null;
      filterWtMin = (val && !isNaN(val)) ? val : null;
      filterPlayers();
    });
  }
  if (wtMax) {
    wtMax.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value ? parseInt((e.target as HTMLInputElement).value, 10) : null;
      filterWtMax = (val && !isNaN(val)) ? val : null;
      filterPlayers();
    });
  }

  // Experience filter
  const expSelect = document.getElementById('filter-exp') as HTMLSelectElement | null;
  if (expSelect) {
    expSelect.addEventListener('change', (e) => {
      filterExp = (e.target as HTMLInputElement).value;
      filterPlayers();
    });
  }

  // Draft round filter
  const draftSelect = document.getElementById('filter-draft') as HTMLSelectElement | null;
  if (draftSelect) {
    draftSelect.addEventListener('change', (e) => {
      filterDraft = (e.target as HTMLInputElement).value;
      filterPlayers();
    });
  }

  // Clear all filters
  const clearBtn = document.getElementById('filter-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      filterTeam = '';
      filterAgeMin = null;
      filterAgeMax = null;
      filterHtMin = null;
      filterHtMax = null;
      filterWtMin = null;
      filterWtMax = null;
      filterExp = '';
      filterDraft = '';
      showRostered = false;
      showRookies = rookieDraftComplete;

      // Reset DOM controls
      if (teamSelect) teamSelect.value = '';
      if (ageMin) ageMin.value = '';
      if (ageMax) ageMax.value = '';
      if (htMin) htMin.value = '';
      if (htMax) htMax.value = '';
      if (wtMin) wtMin.value = '';
      if (wtMax) wtMax.value = '';
      if (expSelect) expSelect.value = '';
      if (draftSelect) draftSelect.value = '';
      if (rosterCheck) rosterCheck.checked = false;
      if (rookieCheck) rookieCheck.checked = rookieDraftComplete;

      filterPlayers();
    });
  }

  // Sorting
  document.querySelectorAll<HTMLElement>('.players-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      hasExplicitSortPref = true;
      const sortKey = th.getAttribute('data-sort') ?? '';
      if (sortKey === currentSort) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = sortKey;
        sortDirection = descDefaults.has(sortKey) ? 'desc' : 'asc';
      }
      sortPlayers();
      render();
    });
  });

  // Column group toggles
  const colGroupToggles = document.getElementById('col-group-toggles');
  if (colGroupToggles) {
    colGroupToggles.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest('.col-group-btn');
      if (!btn) return;
      const group = btn.getAttribute('data-group');
      if (!group) return;
      setActiveView(group);
    });
  }

  // Show More
  const showMoreBtn = document.getElementById('show-more-btn');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      visibleCount += BATCH_SIZE;
      render();
    });
  }

  // Player name click → open detail modal (delegated via shared utility in module script below)

  // All of the state above lives in module scope and survives a ClientRouter
  // swap, but the markup init() just re-bound was rendered fresh — every
  // control is back at its default. Reseed from the DOM, or returning to the
  // page renders a table still filtered by criteria the panel shows as
  // cleared (and leaves the Filters toggle a dead click).
  const domVal = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | null)?.value || '';
  // Mirrors this page's own range handlers, which treat a falsy parse as null.
  const domNum = (id: string) => { const n = parseInt(domVal(id), 10); return (n && !isNaN(n)) ? n : null; };
  const domChecked = (id: string) =>
    !!(document.getElementById(id) as HTMLInputElement | null)?.checked;
  activePosition = document.querySelector('.pos-pill.active')?.getAttribute('data-pos') || 'ALL';
  searchQuery = domVal('player-search');
  showRostered = domChecked('show-rostered');
  showRookies = domChecked('show-rookies');
  filterTeam = domVal('filter-team');
  filterExp = domVal('filter-exp');
  filterDraft = domVal('filter-draft');
  filterAgeMin = domNum('filter-age-min');
  filterAgeMax = domNum('filter-age-max');
  filterHtMin = domNum('filter-ht-min');
  filterHtMax = domNum('filter-ht-max');
  filterWtMin = domNum('filter-wt-min');
  filterWtMax = domNum('filter-wt-max');
  filtersOpen = filtersPanel ? filtersPanel.classList.contains('open') : false;
  visibleCount = BATCH_SIZE;

  filterPlayers();

  // ── Auction polling (60s interval) ──
  startAuctionPolling();
}

// ── Bid tier classification ──
function getBidTierClass(status: string, bidTime: number) {
  if (status === 'won') return 'col-value-bid--won';
  if (status !== 'active' || !bidTime) return status === 'active' ? 'col-value-bid--cool' : 'col-value-bid--none';
  const ageMin = (Date.now() - bidTime * 1000) / 60000;
  if (ageMin < 15) return 'col-value-bid--hot';
  if (ageMin < 60) return 'col-value-bid--warm';
  return 'col-value-bid--cool';
}

function getBidTitleText(status: string, bidTime: number) {
  if (status === 'won') return 'Auction won';
  if (status !== 'active' || !bidTime) return '';
  const ageMin = Math.round((Date.now() - bidTime * 1000) / 60000);
  if (ageMin < 1) return 'Last bid: just now';
  if (ageMin < 60) return `Last bid: ${ageMin}m ago`;
  const ageHr = Math.round(ageMin / 60);
  return `Last bid: ${ageHr}h ago`;
}

// ── Per-player auction countdown tick ──
function manageAuctionTimerInterval(isAuctionView: boolean) {
  if (isAuctionView && !auctionTimerInterval) {
    tickAuctionTimers(); // immediate tick
    auctionTimerInterval = setInterval(tickAuctionTimers, 15000); // tick every 15s
  } else if (!isAuctionView && auctionTimerInterval) {
    clearInterval(auctionTimerInterval);
    auctionTimerInterval = null;
  }
}

function tickAuctionTimers() {
  const cells = document.querySelectorAll<HTMLElement>('.col-auction-timeleft[data-bid-time]');
  let hasCritical = false;
  cells.forEach(cell => {
    const bidTime = parseInt(cell.getAttribute('data-bid-time') ?? '', 10);
    if (!bidTime) return;
    const ms = getTimeLeftMs(bidTime);
    const tier = getTimeLeftTier(ms);
    const text = ms != null && ms > 0 ? formatTimeLeft(ms, tier) : 'Ended';
    cell.textContent = text;
    cell.setAttribute('aria-label', `Time left: ${text}`);
    // Update tier class
    cell.className = cell.className.replace(/col-auction-timeleft--\w+/g, '').trim();
    if (tier !== 'none') cell.classList.add(`col-auction-timeleft--${tier}`);
    if (tier === 'critical') hasCritical = true;
  });
  // Switch to faster ticks when any player is critical, back to normal otherwise
  if (auctionTimerInterval) {
    clearInterval(auctionTimerInterval);
    auctionTimerInterval = setInterval(tickAuctionTimers, hasCritical ? 5000 : 15000);
  }
}

function startAuctionPolling() {
  if (auctionPollTimer) clearInterval(auctionPollTimer);
  fetchAuctionData();
  auctionPollTimer = setInterval(fetchAuctionData, 60000);

  // Start countdown
  updateCountdown();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdown, 60000);

  // Flash cleanup: listen for animationend on table body
  const tbody = document.getElementById('player-table-body');
  tbody?.addEventListener('animationend', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.classList.contains('col-value-bid--changed')) {
      target.classList.remove('col-value-bid--changed');
    }
  });

  // Freshness button: click to refresh
  const freshnessBtn = document.getElementById('auction-freshness');
  freshnessBtn?.addEventListener('click', () => {
    fetchAuctionData();
  });
}

let consecutiveFailures = 0;

async function fetchAuctionData() {
  try {
    const resp = await fetch('/api/live-auction');
    if (!resp.ok) {
      consecutiveFailures++;
      updateAuctionFreshness();
      return;
    }
    const data = await resp.json();
    if (!data?.auctions) return;

    consecutiveFailures = 0;
    lastAuctionFetchTime = data.timestamp || Date.now();
    if (data.count > 0) _hasAuctionData = true;
    let changed = false;
    changedPlayerIds.clear();

    for (const p of players) {
      const auction = data.auctions[p.id];
      const newBid = auction?.bid ?? null;
      const newStatus = auction?.status ?? null;
      const newBidTime = auction?.lastBidTime ?? null;
      const newFranchise = auction?.franchise ?? null;
      const newInitTime = auction?.initTime ?? null;

      if (p.auctionBid !== newBid || p.auctionStatus !== newStatus) {
        // Track bid amount changes for flash animation
        if (p.auctionBid !== newBid && newBid != null) {
          changedPlayerIds.add(p.id);
        }
        p.auctionBid = newBid;
        p.auctionStatus = newStatus;
        p.auctionBidTime = newBidTime;
        p.auctionFranchise = newFranchise;
        p.auctionInitTime = newInitTime;
        changed = true;
      } else if (p.auctionBidTime !== newBidTime || p.auctionFranchise !== newFranchise || p.auctionInitTime !== newInitTime) {
        p.auctionBidTime = newBidTime;
        p.auctionFranchise = newFranchise;
        p.auctionInitTime = newInitTime;
        // Patch the DOM timer attribute so tickAuctionTimers uses the updated anchor
        const timerCell = document.querySelector(`tr[data-player-id="${p.id}"] .col-auction-timeleft[data-bid-time]`);
        if (timerCell) {
          const newAnchor = newBidTime ?? newInitTime;
          if (newAnchor != null) timerCell.setAttribute('data-bid-time', String(newAnchor));
        }
      }
    }

    updateAuctionFreshness();

    if (changed) {
      // Announce bid changes for screen readers
      if (changedPlayerIds.size > 0) {
        announceBidChanges(changedPlayerIds.size);
      }
      // Re-filter to include rostered players that gained bids (auction view)
      // and re-sort since initTime/bid data changed
      filterPlayers();
      applyGroupVisibility();
      applyContractVisibility();

      // For reduced-motion users, remove flash class after 2s
      if (prefersReducedMotion && changedPlayerIds.size > 0) {
        setTimeout(() => {
          document.querySelectorAll<HTMLElement>('.col-value-bid--changed').forEach(el => {
            el.classList.remove('col-value-bid--changed');
          });
        }, 2000);
      }

      // Clear changed set after render so next poll starts fresh
      setTimeout(() => changedPlayerIds.clear(), 100);
    }
  } catch (err) {
    console.error('Auction poll failed:', err);
    consecutiveFailures++;
    updateAuctionFreshness();
  }
}

function announceBidChanges(count: number) {
  const announcer = document.getElementById('auction-announcer');
  if (!announcer) return;
  announcer.textContent = count === 1 ? '1 bid updated' : `${count} bids updated`;
  setTimeout(() => { announcer.textContent = ''; }, 3000);
}

function updateAuctionFreshness() {
  const el = document.getElementById('auction-freshness');
  const timeEl = document.getElementById('auction-freshness-time');
  if (!el || !timeEl || lastAuctionFetchTime <= 0) return;

  const ago = Math.round((Date.now() - lastAuctionFetchTime) / 1000);
  if (ago < 10) {
    timeEl.textContent = 'just now';
  } else if (ago < 60) {
    timeEl.textContent = ago + 's ago';
  } else {
    timeEl.textContent = Math.round(ago / 60) + 'm ago';
  }

  // Three states: fresh (< 2min), stale (2-5min), error (5min+ or consecutive failures)
  el.classList.remove('auction-freshness--stale', 'auction-freshness--error');
  if (consecutiveFailures >= 3 || ago > 300) {
    el.classList.add('auction-freshness--error');
  } else if (ago > 120) {
    el.classList.add('auction-freshness--stale');
  }

  // Show in value view, stats view, or auction view (when auction data visible)
  if (activeView === 'value' || activeView === 'stats' || activeView === 'auction') {
    el.style.display = '';
  }
}

// ── Auction Countdown ──
let lastCountdownMilestone = '';

function updateCountdown() {
  const el = document.getElementById('auction-countdown');
  const valEl = document.getElementById('countdown-value');
  if (!el || !valEl) return;

  const remaining = AUCTION_END - Date.now();
  if (remaining <= 0) {
    valEl.textContent = 'Ended';
    el.className = 'auction-countdown';
    announceMilestone('Auction has ended');
    return;
  }

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  if (days > 0) {
    valEl.textContent = `${days}d ${hours}h`;
  } else if (remaining > 3600000) {
    valEl.textContent = `${hours}h ${minutes}m`;
  } else {
    valEl.textContent = `${minutes}m ${seconds}s`;
    // Switch to 1s updates in final hour
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = setInterval(updateCountdown, 1000);
    }
  }

  // Urgency classes
  el.classList.remove('auction-countdown--closing', 'auction-countdown--urgent', 'auction-countdown--critical');
  if (remaining < 3600000) {
    el.classList.add('auction-countdown--critical');
    announceMilestone('Auction ends in less than 1 hour');
  } else if (remaining < 21600000) {
    el.classList.add('auction-countdown--urgent');
    announceMilestone('Auction ends in less than 6 hours');
  } else if (remaining < 86400000) {
    el.classList.add('auction-countdown--closing');
    announceMilestone('Auction ends in less than 24 hours');
  }

  // Show countdown in value, stats, or auction view
  if (activeView === 'value' || activeView === 'stats' || activeView === 'auction') {
    el.style.display = '';
  }
}

function announceMilestone(msg: string) {
  if (msg === lastCountdownMilestone) return;
  lastCountdownMilestone = msg;
  const announcer = document.getElementById('auction-announcer');
  if (announcer) {
    announcer.textContent = msg;
    setTimeout(() => { announcer.textContent = ''; }, 3000);
  }
}

// ── Periodic tier recalculation + freshness (10s) ──
if (auctionFreshnessTimer) clearInterval(auctionFreshnessTimer);
auctionFreshnessTimer = setInterval(() => {
  updateAuctionFreshness();
  // Recalculate bid tier classes on visible rows (time-based tiers shift)
  document.querySelectorAll<HTMLElement>('td.col-value-bid').forEach(td => {
    const row = td.closest('tr');
    if (!row) return;
    const pid = row.getAttribute('data-player-id');
    if (!pid) return;
    const player = players.find(p => p.id === pid);
    if (!player || player.auctionStatus !== 'active') return;
    const newClass = getBidTierClass(player.auctionStatus, player.auctionBidTime);
    td.classList.remove('col-value-bid--hot', 'col-value-bid--warm', 'col-value-bid--cool');
    td.classList.add(newClass);
  });
}, 10000);

// Cleanup on navigation (View Transitions)
document.addEventListener('astro:before-swap', function () {
  if (auctionPollTimer) { clearInterval(auctionPollTimer); auctionPollTimer = null; }
  if (auctionFreshnessTimer) { clearInterval(auctionFreshnessTimer); auctionFreshnessTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (auctionTimerInterval) { clearInterval(auctionTimerInterval); auctionTimerInterval = null; }
  stopDefRotation();
}, { once: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
document.addEventListener('astro:page-load', init);
