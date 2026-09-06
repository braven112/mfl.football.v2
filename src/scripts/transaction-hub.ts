/**
 * Transaction Hub — polling, view routing and interaction logic.
 *
 * Drives TransactionHubModal: a hub home that drills into Trade Offers,
 * Waiver Claims and Waiver Priority. Dismissed trade IDs live in localStorage
 * so an offer does not re-alert.
 *
 * WHAT IS FETCHED, AND WHEN — the three reads are deliberately NOT on the same
 * clock, because they do not cost the same or change at the same rate:
 *
 *   - **Trades**, every page load behind a 60s debounce. It is the one that
 *     auto-opens the modal, so it has to be current.
 *   - **Claims count**, behind its own 5-minute debounce. It only powers the
 *     bell's quiet dot and the hub row's count, and claims change when the
 *     OWNER files one — which fires `waiver-claims:changed`, and that
 *     invalidates the cache directly. Polling it at the trades' cadence would
 *     double this feature's MFL reads to keep a dot honest.
 *   - **Waiver order**, only when the hub is actually opened, once per page
 *     view. It costs an MFL read that no page load should carry for a visitor
 *     who never clicks the bell.
 *
 * THE BADGE COUNTS TRADES ONLY. A trade offer is somebody waiting on you; a
 * claim you filed yourself is not. Claims get a dot, which says "there is
 * something else in here" without inflating a number that means "act on me".
 */

import { buildPlayerCellHTML } from '../utils/player-cell-html';
import {
  renderWaiverPriorityRows,
  waiverPriorityFootnote,
} from '../utils/waiver-priority-render';
import { rankWithinConference } from '../utils/waiver-order';

// THE OLD NAMES ARE DELIBERATE. These two keys predate the Transaction Hub and
// are NOT renamed with the file: `dismissed` holds the trade ids every owner
// has already waved away, so renaming it silently re-alerts them all, and
// `last-check` is also written by TradeBuilder.tsx to force a fresh poll after
// a trade action — renaming here alone would quietly break that.
const THM_STORAGE_KEY = 'mfl:trade-alert-dismissed';
const THM_DEBOUNCE_KEY = 'mfl:trade-alert-last-check';
const THM_DEBOUNCE_MS = 60_000;

/** Cached auth info for the session */
let thmAuthCache: { franchiseId: string; role: string } | null | undefined = undefined;

/** All received trades (persists across dismiss — used by bell click to reopen) */
let thmAllTrades: any[] = [];
/** Sent trades — outgoing offers from the user (viewable, but never trigger the alert badge) */
let thmSentTrades: any[] = [];
/** Commissioner trades — league-wide trades not involving the user */
let thmCommishTrades: any[] = [];
/** Current received trades in the modal (may be filtered by dismiss within a session) */
let thmTrades: any[] = [];
/** Index of the currently viewed trade in detail view */
let thmCurrentTradeIdx = -1;
/** Type of the currently viewed trade — routes footer actions and asset labeling */
let thmCurrentTradeType: 'received' | 'sent' | 'commish' = 'received';
/** Whether a confirm prompt is active */
let thmConfirmAction: 'accept' | 'reject' | 'veto' | 'approve' | 'revoke' | null = null;
/** Previously focused element for focus return */
let thmPrevFocus: HTMLElement | null = null;

/** Which screen the modal is currently showing — drives the back arrow. */
type ThmView = 'hub' | 'list' | 'detail' | 'empty' | 'claims' | 'order';
let thmCurrentView: ThmView = 'hub';

const THM_VIEW_IDS: Record<ThmView, string> = {
  hub: 'thm-hub-view',
  list: 'thm-list-view',
  detail: 'thm-detail-view',
  empty: 'thm-empty-view',
  claims: 'thm-claims-view',
  order: 'thm-order-view',
};

/**
 * A live read must settle or fail. `/api/waiver-order` waits up to 6s on MFL
 * and a cold function adds more, so an unbounded fetch parks a screen on its
 * loading line for good — the bug #974 fixed in WaiverPriorityModal, whose
 * timeout this matches deliberately.
 */
const THM_LIVE_READ_TIMEOUT_MS = 12_000;

/** Filed waiver claims. `null` = not read yet; `[]` = read, none filed. */
let thmClaims: any[] | null = null;
let thmClaimsError: string | null = null;
const THM_CLAIMS_DEBOUNCE_KEY = 'mfl:transaction-hub-claims-checked';
const THM_CLAIMS_DEBOUNCE_MS = 300_000;

/** Live waiver order, fetched once per page view when the hub is opened. */
let thmOrder: { order: any[]; asOf: string; live: boolean } | null = null;
let thmOrderError: string | null = null;
let thmOrderLoading = false;

// ---- Helpers ----

function thmGetDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(THM_STORAGE_KEY) || '[]');
  } catch { return []; }
}

function thmSetDismissed(ids: string[]) {
  try { localStorage.setItem(THM_STORAGE_KEY, JSON.stringify(ids)); } catch {}
}

function thmFormatRelativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function thmFormatExpiry(ts: number): string {
  if (!ts) return '';
  const now = Math.floor(Date.now() / 1000);
  const left = ts - now;
  if (left <= 0) return 'Expired';
  if (left < 3600) return `Expires in ${Math.floor(left / 60)}m`;
  if (left < 86400) return `Expires in ${Math.floor(left / 3600)}h`;
  return `Expires in ${Math.floor(left / 86400)}d`;
}

/** Format player name from "Last, First" to "First Last" */
function thmDisplayName(label: string): string {
  const parts = label.split(', ');
  return parts.length > 1 ? parts[1] + ' ' + parts[0] : label;
}

function thmSummarizeAssets(assets: any[]): string {
  if (!assets?.length) return 'nothing';
  const names = assets.slice(0, 2).map((a: any) =>
    a.type === 'player' ? thmDisplayName(a.label) : a.label
  );
  if (assets.length > 2) names.push(`+${assets.length - 2} more`);
  return names.join(', ');
}

/** Build Trade Builder URL from a pending trade's raw asset strings.
 *  Team A = user (offeredTo), Team B = counterparty (offeredBy).
 *  willGiveUp/willReceive are from the PROPOSER's perspective:
 *    willGiveUp = what proposer gives = what user receives (Team B players)
 *    willReceive = what proposer receives = what user gives (Team A players) */
function thmBuildTradeBuilderUrl(trade: any): string {
  const params = new URLSearchParams();
  params.set('a', trade.offeredTo);
  params.set('b', trade.offeredBy);

  // Parse raw asset strings into player IDs and pick codes
  function splitAssets(raw: string): { players: string[]; picks: string[] } {
    const players: string[] = [];
    const picks: string[] = [];
    if (!raw) return { players, picks };
    for (const part of raw.split(',').filter(Boolean)) {
      const t = part.trim();
      if (t.startsWith('FP_') || t.startsWith('DP_')) picks.push(t);
      else if (/^\d+$/.test(t)) players.push(t);
      // BB_ (blind bid) not supported in trade builder — skip
    }
    return { players, picks };
  }

  function formatPicks(codes: string[]): string {
    return codes
      .filter(c => c.startsWith('FP_'))
      .map(c => { const p = c.split('_'); return `${p[2]}-${p[3]}-${p[1]}`; })
      .join(',');
  }

  // willReceive = what proposer gets = Team A (user) gives up
  const teamAAssets = splitAssets(trade.willReceive);
  if (teamAAssets.players.length) params.set('ap', teamAAssets.players.join(','));
  const teamAPicks = formatPicks(teamAAssets.picks);
  if (teamAPicks) params.set('ad', teamAPicks);

  // willGiveUp = what proposer gives = Team B (counterparty) gives up
  const teamBAssets = splitAssets(trade.willGiveUp);
  if (teamBAssets.players.length) params.set('bp', teamBAssets.players.join(','));
  const teamBPicks = formatPicks(teamBAssets.picks);
  if (teamBPicks) params.set('bd', teamBPicks);

  // Keep the deep link inside the current league — the layout stamps the active
  // league on <html data-league> ('afl' | 'theleague'), which is domain-agnostic.
  const base = document.documentElement.dataset.league === 'afl'
    ? '/afl-fantasy/trade-builder'
    : '/theleague/trade-builder';
  return `${base}?${params.toString()}`;
}

// ---- DOM refs ----

function thmEl(id: string) { return document.getElementById(id); }

// ---- Open / Close ----

/**
 * The SSR config blob, re-read on every call rather than captured at module
 * load. Under the ClientRouter a single module instance survives a navigation
 * from one league's page to the other's, so a captured config would highlight
 * the previous league's team as "You" — the same reason
 * src/utils/rankings-scope.ts re-reads its scope per call.
 */
function thmConfig(): {
  signedIn: boolean;
  franchiseId: string | null;
  conferenceName: string;
  teams: Array<{ franchiseId: string; name: string; icon?: string }>;
  freeAgentsPath: string;
  showWaiverPriority: boolean;
} | null {
  try {
    const raw = document.getElementById('transaction-hub-config')?.textContent;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Show exactly one screen. Every view toggle goes through here so no two can
 *  ever be visible at once, which six independent `style.display` sites would
 *  eventually allow. */
function thmShowView(view: ThmView, animate: 'in' | 'back' | null = null) {
  thmCurrentView = view;
  for (const [name, id] of Object.entries(THM_VIEW_IDS)) {
    const el = thmEl(id);
    if (!el) continue;
    if (name === view) {
      el.style.display = 'flex';
      if (animate) {
        el.classList.remove('slide-in', 'slide-back');
        void el.offsetWidth;
        el.classList.add(animate === 'in' ? 'slide-in' : 'slide-back');
      }
    } else {
      el.style.display = 'none';
    }
  }
}

function thmTradeCount(): number {
  return thmTrades.length + thmSentTrades.length + thmCommishTrades.length;
}

// ---- Hub home ----

const thmEsc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** "Last, First" → "First Last", matching the trade asset lists. */
function thmClaimName(label: string | null): string {
  if (!label) return '';
  const parts = label.split(', ');
  return parts.length > 1 ? `${parts[1]} ${parts[0]}` : label;
}

function thmSetHubRow(
  countId: string,
  subId: string,
  count: number | null,
  subText: string,
) {
  const countEl = thmEl(countId);
  if (countEl) {
    if (count && count > 0) {
      countEl.textContent = String(count);
      countEl.hidden = false;
    } else {
      countEl.hidden = true;
    }
  }
  const subEl = thmEl(subId);
  if (subEl) subEl.textContent = subText;
}

function thmRenderHubView() {
  const cfg = thmConfig();

  // Trades
  const received = thmTrades.length + thmCommishTrades.length;
  const total = thmTradeCount();
  thmSetHubRow(
    'thm-hub-trades-count',
    'thm-hub-trades-sub',
    total,
    total === 0
      ? 'Nothing pending'
      : received > 0
        ? `${received} waiting on you`
        : `${thmSentTrades.length} offer${thmSentTrades.length === 1 ? '' : 's'} out`,
  );

  // Claims — `null` means we have not read them yet, which is not "none". An
  // unread list that FAILED has to say so: left on "Checking…" the row sits
  // there forever, and reported as 0 it would claim the owner filed nothing.
  thmSetHubRow(
    'thm-hub-claims-count',
    'thm-hub-claims-sub',
    thmVisibleClaims()?.length ?? 0,
    !cfg?.signedIn
      ? 'Sign in to see your claims'
      : thmClaimsError
        ? 'Could not reach MyFantasyLeague'
        : thmClaims === null
          ? 'Checking MyFantasyLeague…'
          : thmClaims.length === 0
            ? 'Nothing filed'
            : `${thmClaims.length} filed`,
  );

  // Priority — the row is absent entirely in a blind-bid league, so every
  // lookup below is null-safe rather than assumed present.
  const rankEl = thmEl('thm-hub-order-rank');
  const myRank = thmMyWaiverRank();
  if (rankEl) {
    if (myRank) {
      rankEl.textContent = `#${myRank}`;
      rankEl.hidden = false;
    } else {
      rankEl.hidden = true;
    }
  }
  const orderSub = thmEl('thm-hub-order-sub');
  if (orderSub) {
    orderSub.textContent = !cfg?.signedIn
      ? 'Sign in to see your spot'
      : cfg.conferenceName || 'Where you sit in line';
  }
}

/**
 * The claims to SHOW on this page — not merely the ones we hold.
 *
 * `thmClaims` is module-scoped and a single module instance survives an
 * in-site navigation under the ClientRouter, so a TheLeague owner's filed
 * claims are still in memory when they land on an AFL page. The claims API
 * resolves the league from the SESSION, so those claims are real — they are
 * just not this page's league, and the row's own subtext already says
 * "Sign in to see your claims". Reporting a count beside that made the row
 * contradict itself and leaked the other league's number. Same reasoning as
 * src/utils/rankings-scope.ts: the scope has to be re-read per call, and the
 * things DERIVED from it re-checked with it.
 */
function thmVisibleClaims(): any[] | null {
  return thmConfig()?.signedIn ? thmClaims : null;
}

/** The viewer's rank within their own conference, or null until the order is read. */
function thmMyWaiverRank(): number | null {
  const cfg = thmConfig();
  if (!cfg?.showWaiverPriority) return null;
  if (!thmOrder || !cfg.franchiseId || !cfg.teams?.length) return null;
  const ranked = rankWithinConference(
    thmOrder.order,
    cfg.teams.map((t) => t.franchiseId),
  );
  return ranked.find((r) => r.franchiseId === cfg.franchiseId)?.rank ?? null;
}

// ---- Waiver claims screen (read-only) ----

function thmRenderGate(container: HTMLElement, lead: string, note: string) {
  container.innerHTML =
    `<div class="thm-gate">` +
    `<p class="thm-gate__lead">${thmEsc(lead)}</p>` +
    `<p class="thm-gate__note">${thmEsc(note)}</p>` +
    `</div>`;
}

function thmRenderClaimsView() {
  const cfg = thmConfig();
  const statusEl = thmEl('thm-claims-status');
  const listEl = thmEl('thm-claims-list');
  const footEl = thmEl('thm-claims-foot');
  const badgeEl = thmEl('thm-claims-badge');
  if (!statusEl || !listEl) return;

  const setStatus = (msg: string, kind: 'info' | 'error' = 'info') => {
    statusEl.textContent = msg;
    statusEl.className = `thm-status thm-status--${kind}`;
    statusEl.hidden = !msg;
  };

  if (!cfg?.signedIn) {
    listEl.hidden = true;
    if (footEl) footEl.hidden = true;
    if (badgeEl) badgeEl.hidden = true;
    statusEl.hidden = false;
    statusEl.className = 'thm-status';
    thmRenderGate(
      statusEl,
      'Sign in to see your waiver claims.',
      'Claims are filed by a team, so we need to know which team is yours before we can show you anything.',
    );
    return;
  }

  if (thmClaimsError) {
    listEl.hidden = true;
    if (badgeEl) badgeEl.hidden = true;
    if (footEl) footEl.hidden = false;
    setStatus(thmClaimsError, 'error');
    return;
  }

  if (thmClaims === null) {
    listEl.hidden = true;
    if (badgeEl) badgeEl.hidden = true;
    if (footEl) footEl.hidden = true;
    setStatus('Reading your claims from MyFantasyLeague…');
    return;
  }

  if (badgeEl) {
    badgeEl.textContent = String(thmClaims.length);
    badgeEl.hidden = thmClaims.length === 0;
  }
  if (footEl) footEl.hidden = false;

  if (thmClaims.length === 0) {
    listEl.hidden = true;
    setStatus('You have no waiver claims in right now.');
    return;
  }

  // MFL's own order within a round IS the priority — a round is one record
  // whose `addsDrops` is an ordered list and MFL appends to the end. So the
  // position shown is the array index, never a re-sort.
  listEl.innerHTML = thmClaims
    .map((c: any, i: number) => {
      const add = thmEsc(thmClaimName(c.addName) || `Player ${c.addPlayerId}`);
      const meta = [c.addPosition, c.addNflTeam].filter(Boolean).join(' \u00b7 ');
      const drop = c.dropName
        ? `Dropping ${thmEsc(thmClaimName(c.dropName))}`
        : 'No drop';
      // A bid column only makes sense where the league bids — the claim itself
      // says so, so this needs no separate league-system flag.
      const bid =
        typeof c.bid === 'number'
          ? `<span class="thm-claim__bid">$${c.bid}</span>`
          : '';
      return (
        `<li class="thm-claim">` +
        `<span class="thm-claim__pos">${i + 1}</span>` +
        `<span class="thm-claim__body">` +
        `<span class="thm-claim__add">${add}${meta ? ` <span class="thm-claim__meta">${thmEsc(meta)}</span>` : ''}</span>` +
        `<span class="thm-claim__drop">${drop}</span>` +
        `</span>` +
        bid +
        `</li>`
      );
    })
    .join('');
  listEl.hidden = false;
  setStatus('');
}

/**
 * Read the owner's filed claims. Debounced across navigations in
 * sessionStorage, and skipped entirely once loaded in this page's module
 * instance — `waiver-claims:changed` is what forces a re-read.
 */
async function thmLoadClaims(force = false): Promise<void> {
  const cfg = thmConfig();
  if (!cfg?.signedIn) return;
  if (thmClaims !== null && !force) return;

  if (!force) {
    try {
      const last = Number(sessionStorage.getItem(THM_CLAIMS_DEBOUNCE_KEY) || '0');
      const cached = sessionStorage.getItem(`${THM_CLAIMS_DEBOUNCE_KEY}:data`);
      if (cached && Date.now() - last < THM_CLAIMS_DEBOUNCE_MS) {
        thmClaims = JSON.parse(cached);
        thmClaimsError = null;
        return;
      }
    } catch {}
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), THM_LIVE_READ_TIMEOUT_MS);
  try {
    const res = await fetch('/api/waiver-claims', {
      credentials: 'include',
      signal: abort.signal,
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || 'Could not read your waiver claims.');
    }
    thmClaims = Array.isArray(data.claims) ? data.claims : [];
    thmClaimsError = null;
    try {
      sessionStorage.setItem(THM_CLAIMS_DEBOUNCE_KEY, String(Date.now()));
      sessionStorage.setItem(`${THM_CLAIMS_DEBOUNCE_KEY}:data`, JSON.stringify(thmClaims));
    } catch {}
  } catch (err) {
    // Leave `thmClaims` null: "could not read" and "nothing filed" must not
    // share a representation, or the dot goes quiet on an outage and the hub
    // row claims you filed nothing.
    thmClaimsError =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'MyFantasyLeague is taking too long to answer.'
        : err instanceof Error
          ? err.message
          : 'Could not read your waiver claims.';
  } finally {
    clearTimeout(timer);
  }
}

// ---- Waiver priority screen ----

function thmRenderOrderView() {
  const cfg = thmConfig();
  const statusEl = thmEl('thm-order-status');
  const listEl = thmEl('thm-order-list');
  const footWrap = thmEl('thm-order-footwrap');
  const footEl = thmEl('thm-order-foot');
  if (!statusEl || !listEl) return;

  const setStatus = (msg: string, kind: 'info' | 'error' = 'info') => {
    statusEl.textContent = msg;
    statusEl.className = `thm-status thm-status--${kind}`;
    statusEl.hidden = !msg;
  };

  if (!cfg?.signedIn) {
    listEl.hidden = true;
    if (footWrap) footWrap.hidden = true;
    statusEl.hidden = false;
    statusEl.className = 'thm-status';
    thmRenderGate(
      statusEl,
      'Sign in to see where you sit in the waiver order.',
      'Priority is per conference, so we need to know which team is yours before we can show you the line you\u2019re actually standing in.',
    );
    return;
  }

  if (thmOrderError) {
    listEl.hidden = true;
    if (footWrap) footWrap.hidden = true;
    setStatus(thmOrderError, 'error');
    return;
  }

  if (!thmOrder) {
    listEl.hidden = true;
    if (footWrap) footWrap.hidden = true;
    setStatus('Reading the live order from MyFantasyLeague\u2026');
    return;
  }

  listEl.innerHTML = renderWaiverPriorityRows(
    thmOrder.order,
    cfg.teams ?? [],
    cfg.franchiseId,
    'thm-worow',
  );
  listEl.hidden = false;
  setStatus('');

  if (footEl && footWrap) {
    footEl.textContent = waiverPriorityFootnote(thmOrder.asOf, thmOrder.live);
    footWrap.hidden = false;
  }
}

/** Fetched once per page view, not once per open — the order only moves when
 *  waivers process, so re-reading it on every toggle buys nothing. */
async function thmLoadOrder(): Promise<void> {
  const cfg = thmConfig();
  // A blind-bid league has no priority order to read. Bailing here (rather
  // than only hiding the row) is what keeps a league that does not use
  // priority from spending an MFL read on a number it would never show.
  if (!cfg?.showWaiverPriority) return;
  if (!cfg.signedIn || thmOrder || thmOrderLoading) return;
  thmOrderLoading = true;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), THM_LIVE_READ_TIMEOUT_MS);
  try {
    const res = await fetch('/api/waiver-order', {
      credentials: 'include',
      signal: abort.signal,
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || 'Could not read the waiver order.');
    }
    thmOrder = { order: data.order, asOf: data.asOf, live: data.live !== false };
    thmOrderError = null;
  } catch (err) {
    // Let the next open retry — a failed read is usually a blip.
    thmOrderError =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'MyFantasyLeague is taking too long to answer.'
        : err instanceof Error
          ? err.message
          : 'Could not read the waiver order.';
  } finally {
    clearTimeout(timer);
    thmOrderLoading = false;
  }
}

// ---- Screen navigation ----

/** Open the hub home, and kick off the two live reads it summarises. */
function thmShowHubView() {
  thmShowView('hub', 'back');
  thmRenderHubView();

  // Both are fire-and-forget: the rows fill in as each lands, and neither
  // blocks the hub from being usable.
  void thmLoadClaims().then(() => {
    thmUpdateNavBell(thmTrades.length + thmCommishTrades.length);
    if (thmCurrentView === 'hub') thmRenderHubView();
    if (thmCurrentView === 'claims') thmRenderClaimsView();
  });
  void thmLoadOrder().then(() => {
    if (thmCurrentView === 'hub') thmRenderHubView();
    if (thmCurrentView === 'order') thmRenderOrderView();
  });
}

function thmShowTradesView() {
  if (thmTradeCount() === 0) {
    thmShowView('empty', 'in');
    return;
  }
  thmShowListView();
}

function thmShowClaimsView() {
  thmShowView('claims', 'in');
  thmRenderClaimsView();
  void thmLoadClaims().then(() => {
    if (thmCurrentView === 'claims') thmRenderClaimsView();
  });
}

function thmShowOrderView() {
  // Unreachable in a blind-bid league — the row that opens it is not rendered
  // — but guarded anyway so a stray call cannot show an empty screen.
  if (!thmConfig()?.showWaiverPriority) return;
  thmShowView('order', 'in');
  thmRenderOrderView();
  void thmLoadOrder().then(() => {
    if (thmCurrentView === 'order') thmRenderOrderView();
  });
}

function thmOpen() {
  const modal = thmEl('transaction-hub-modal');
  if (!modal) return;
  thmPrevFocus = document.activeElement as HTMLElement;
  document.body.style.overflow = 'hidden';
  // Close nav drawer if open
  const navApi = (window as any).navDrawer;
  if (navApi?.isOpen?.()) navApi.close();
  modal.classList.add('active');
  thmEl('thm-close')?.focus();
}

function thmClose() {
  const modal = thmEl('transaction-hub-modal');
  if (!modal) return;
  modal.classList.remove('active');
  document.body.style.overflow = '';
  thmConfirmAction = null;
  if (thmPrevFocus) {
    thmPrevFocus.focus();
    thmPrevFocus = null;
  }
}

// ---- Build list card via safe DOM methods ----

function thmBuildListCard(trade: any, idx: number, type: 'received' | 'sent' | 'commish'): HTMLElement {
  const card = document.createElement('div');
  card.className = 'thm-list-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  if (type === 'commish') {
    card.setAttribute('aria-label', `Trade between ${trade.offeredByName} and ${trade.offeredToName}`);

    const icon = document.createElement('img');
    icon.className = 'thm-list-card__icon';
    icon.src = trade.offeredByIcon || '';
    icon.alt = '';
    card.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'thm-list-card__body';

    const teamP = document.createElement('p');
    teamP.className = 'thm-list-card__team';
    teamP.textContent = `${trade.offeredByName || '?'} \u2194 ${trade.offeredToName || '?'}`;
    body.appendChild(teamP);

    const summaryP = document.createElement('p');
    summaryP.className = 'thm-list-card__summary';
    const giveAssets = trade.resolvedAssets?.willGiveUp || [];
    const receiveAssets = trade.resolvedAssets?.willReceive || [];
    summaryP.textContent = `${thmSummarizeAssets(giveAssets)} for ${thmSummarizeAssets(receiveAssets)}`;
    body.appendChild(summaryP);

    card.appendChild(body);
  } else if (type === 'sent') {
    // Outgoing offer: show the team we offered to
    card.setAttribute('aria-label', `Trade offer to ${trade.offeredToName || 'Unknown'}`);

    const icon = document.createElement('img');
    icon.className = 'thm-list-card__icon';
    icon.src = trade.offeredToIcon || '';
    icon.alt = '';
    card.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'thm-list-card__body';

    const teamP = document.createElement('p');
    teamP.className = 'thm-list-card__team';
    teamP.textContent = `To: ${trade.offeredToName || 'Unknown'}`;
    body.appendChild(teamP);

    const summaryP = document.createElement('p');
    summaryP.className = 'thm-list-card__summary';
    const giveAssets = trade.resolvedAssets?.willGiveUp || [];
    const receiveAssets = trade.resolvedAssets?.willReceive || [];
    summaryP.textContent = `Offered: ${thmSummarizeAssets(giveAssets)} for ${thmSummarizeAssets(receiveAssets)}`;
    body.appendChild(summaryP);

    card.appendChild(body);
  } else {
    // Received (incoming): show counterparty
    card.setAttribute('aria-label', `Trade offer from ${trade.offeredByName || 'Unknown'}`);

    const icon = document.createElement('img');
    icon.className = 'thm-list-card__icon';
    icon.src = trade.offeredByIcon || '';
    icon.alt = '';
    card.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'thm-list-card__body';

    const teamP = document.createElement('p');
    teamP.className = 'thm-list-card__team';
    teamP.textContent = trade.offeredByName || 'Unknown';
    body.appendChild(teamP);

    const summaryP = document.createElement('p');
    summaryP.className = 'thm-list-card__summary';
    const receiveAssets = trade.resolvedAssets?.willReceive || [];
    const giveAssets = trade.resolvedAssets?.willGiveUp || [];
    summaryP.textContent = `Get: ${thmSummarizeAssets(receiveAssets)} \u00B7 Give: ${thmSummarizeAssets(giveAssets)}`;
    body.appendChild(summaryP);

    card.appendChild(body);
  }

  // Time + chevron (shared)
  const time = document.createElement('span');
  time.className = 'thm-list-card__time';
  time.textContent = thmFormatRelativeTime(trade.timestamp);
  card.appendChild(time);

  const arrowNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(arrowNS, 'svg');
  svg.setAttribute('class', 'thm-list-card__arrow');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  const path = document.createElementNS(arrowNS, 'path');
  path.setAttribute('d', 'M9 18l6-6-6-6');
  svg.appendChild(path);
  card.appendChild(svg);

  card.addEventListener('click', () => thmShowDetailView(idx, type));
  card.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); thmShowDetailView(idx, type); }
  });
  return card;
}

// ---- Render List View ----

function thmShowListView() {
  thmShowView('list', 'back');

  const totalCount = thmTrades.length + thmSentTrades.length + thmCommishTrades.length;
  thmEl('thm-badge')!.textContent = String(totalCount);
  const body = thmEl('thm-list-body')!;
  body.replaceChildren();

  // Count how many sections we'll render — only show headers when more than one section exists
  const sectionCount =
    (thmTrades.length > 0 ? 1 : 0) +
    (thmSentTrades.length > 0 ? 1 : 0) +
    (thmCommishTrades.length > 0 ? 1 : 0);
  const showHeaders = sectionCount > 1;

  const appendHeader = (text: string) => {
    const header = document.createElement('h4');
    header.className = 'thm-section-title';
    header.textContent = text;
    body.appendChild(header);
  };

  // Section: Incoming offers (received)
  if (thmTrades.length > 0) {
    if (showHeaders) appendHeader('Incoming Offers');
    thmTrades.forEach((trade, idx) => {
      body.appendChild(thmBuildListCard(trade, idx, 'received'));
    });
  }

  // Section: Sent offers (outgoing)
  if (thmSentTrades.length > 0) {
    if (showHeaders) appendHeader('Sent Offers');
    thmSentTrades.forEach((trade, idx) => {
      body.appendChild(thmBuildListCard(trade, idx, 'sent'));
    });
  }

  // Section: Pending Approval (commissioner only)
  if (thmCommishTrades.length > 0) {
    if (showHeaders) appendHeader('Pending Approval');
    thmCommishTrades.forEach((trade, idx) => {
      body.appendChild(thmBuildListCard(trade, idx, 'commish'));
    });
  }
}

// ---- Render Detail View ----

function thmRenderAssetList(container: HTMLElement, assets: any[]) {
  container.replaceChildren();
  if (!assets?.length) {
    const li = document.createElement('li');
    li.className = 'thm-asset-item thm-asset-item--empty';
    li.textContent = 'Nothing';
    container.appendChild(li);
    return;
  }
  for (const asset of assets) {
    const li = document.createElement('li');
    li.className = 'thm-asset-item';
    if (asset.type === 'player') {
      // Use player lockup pattern (headshot + team logo + position)
      // buildPlayerCellHTML escapes all data internally via its own esc() function
      const headshot = asset.espnId
        ? `https://a.espncdn.com/i/headshots/nfl/players/full/${asset.espnId}.png`
        : undefined;
      const safeHtml = buildPlayerCellHTML({
        name: thmDisplayName(asset.label),
        headshot,
        position: asset.position,
        nflTeam: asset.nflTeam,
        size: 'compact',
        mflId: asset.playerId,
        espnId: asset.espnId,
      });
      const tpl = document.createElement('template');
      tpl.innerHTML = safeHtml; // safe: buildPlayerCellHTML escapes all interpolated values
      li.appendChild(tpl.content);
    } else if (asset.type === 'pick') {
      li.classList.add('thm-asset-item--pick');
      li.textContent = asset.label;
    } else {
      li.classList.add('thm-asset-item--bbid');
      li.textContent = asset.label;
    }
    container.appendChild(li);
  }
}

function thmShowDetailView(idx: number, type: 'received' | 'sent' | 'commish' = 'received') {
  thmCurrentTradeType = type;
  thmCurrentTradeIdx = idx;
  const trade =
    type === 'commish' ? thmCommishTrades[idx] :
    type === 'sent' ? thmSentTrades[idx] :
    thmTrades[idx];
  if (!trade) return;

  thmShowView('detail', 'in');
  const detailView = thmEl('thm-detail-view')!;

  // The back arrow is now always meaningful — a single trade still has the hub
  // behind it, so there is no dead end to hide it for.
  thmEl('thm-back')!.style.display = '';

  // Hero — commish shows both teams, sent shows recipient, received shows proposer
  const iconEl = thmEl('thm-counterparty-icon') as HTMLImageElement;
  const labelEl = detailView.querySelector('.thm-detail-hero__label')!;
  if (type === 'commish') {
    iconEl.src = trade.offeredByIcon || '';
    iconEl.alt = '';
    labelEl.textContent = 'Trade between';
    thmEl('thm-counterparty-name')!.textContent =
      `${trade.offeredByName || '?'} & ${trade.offeredToName || '?'}`;
  } else if (type === 'sent') {
    iconEl.src = trade.offeredToIcon || '';
    iconEl.alt = trade.offeredToName || '';
    labelEl.textContent = 'Trade offer to';
    thmEl('thm-counterparty-name')!.textContent = trade.offeredToName || 'Unknown';
  } else {
    iconEl.src = trade.offeredByIcon || '';
    iconEl.alt = trade.offeredByName || '';
    labelEl.textContent = 'Trade offer from';
    thmEl('thm-counterparty-name')!.textContent = trade.offeredByName || 'Unknown';
  }

  // Meta
  thmEl('thm-detail-time')!.textContent = thmFormatRelativeTime(trade.timestamp);
  const expiresText = thmFormatExpiry(trade.expires);
  const expiresEl = thmEl('thm-detail-expires')!;
  expiresEl.textContent = expiresText;
  expiresEl.style.display = expiresText ? '' : 'none';

  // Asset column titles — commish shows team names, owner (sent/received) sees "You Receive" / "You Give"
  const receiveTitle = thmEl('thm-assets-receive-title')!;
  const giveTitle = thmEl('thm-assets-give-title')!;
  if (type === 'commish') {
    receiveTitle.textContent = trade.offeredToName || 'Team B';
    receiveTitle.className = 'thm-assets-col__title';
    giveTitle.textContent = trade.offeredByName || 'Team A';
    giveTitle.className = 'thm-assets-col__title';
  } else {
    receiveTitle.textContent = 'You Receive';
    receiveTitle.className = 'thm-assets-col__title thm-assets-col__title--receive';
    giveTitle.textContent = 'You Give';
    giveTitle.className = 'thm-assets-col__title thm-assets-col__title--give';
  }

  // Assets — MFL returns from the queried franchise's perspective, so willReceive/willGiveUp
  // are user-relative for both sent and received trades.
  thmRenderAssetList(thmEl('thm-assets-receive')!, trade.resolvedAssets?.willReceive || []);
  thmRenderAssetList(thmEl('thm-assets-give')!, trade.resolvedAssets?.willGiveUp || []);

  // Comments
  const commentsEl = thmEl('thm-comments')!;
  if (trade.comments) {
    thmEl('thm-comments-text')!.textContent = trade.comments;
    commentsEl.style.display = '';
  } else {
    commentsEl.style.display = 'none';
  }

  // Builder link — useful for received (review cap impact); hidden for sent (user already built it)
  (thmEl('thm-builder-link') as HTMLAnchorElement).href = thmBuildTradeBuilderUrl(trade);

  // Footer — commissioner: Approve + Veto; sent: Withdraw only; received: Accept + Reject
  const acceptBtn = thmEl('thm-accept') as HTMLElement;
  const rejectBtn = thmEl('thm-reject') as HTMLElement;
  const builderLink = thmEl('thm-builder-link') as HTMLElement;
  if (type === 'commish') {
    acceptBtn.style.display = '';
    acceptBtn.textContent = 'Approve';
    acceptBtn.className = 'thm-btn thm-btn--accept';
    rejectBtn.textContent = 'Veto';
    rejectBtn.className = 'thm-btn thm-btn--dismiss';
    rejectBtn.style.fontSize = '0.75rem';
    builderLink.style.display = 'none';
  } else if (type === 'sent') {
    acceptBtn.style.display = 'none';
    rejectBtn.textContent = 'Withdraw';
    rejectBtn.className = 'thm-btn thm-btn--reject';
    rejectBtn.style.fontSize = '';
    rejectBtn.style.flex = '1';
    builderLink.style.display = 'none';
  } else {
    acceptBtn.style.display = '';
    acceptBtn.textContent = 'Accept';
    acceptBtn.className = 'thm-btn thm-btn--accept';
    rejectBtn.textContent = 'Reject';
    rejectBtn.className = 'thm-btn thm-btn--reject';
    rejectBtn.style.fontSize = '';
    rejectBtn.style.flex = '';
    builderLink.style.display = '';
  }

  thmResetFooter();
}

function thmResetFooter() {
  thmConfirmAction = null;
  thmEl('thm-confirm')!.style.display = 'none';
  thmEl('thm-actions')!.style.display = 'flex';
  thmEl('thm-error')!.style.display = 'none';
  thmEl('thm-success')!.style.display = 'none';
  const btns = [thmEl('thm-accept'), thmEl('thm-reject'), thmEl('thm-dismiss')];
  btns.forEach(b => { if (b) (b as HTMLButtonElement).disabled = false; });
}

// ---- Actions ----

function thmGetCurrentTrade(): any {
  if (thmCurrentTradeType === 'commish') return thmCommishTrades[thmCurrentTradeIdx];
  if (thmCurrentTradeType === 'sent') return thmSentTrades[thmCurrentTradeIdx];
  return thmTrades[thmCurrentTradeIdx];
}

function thmShowConfirm(action: 'accept' | 'reject' | 'veto' | 'approve' | 'revoke') {
  thmConfirmAction = action;
  thmEl('thm-actions')!.style.display = 'none';
  thmEl('thm-confirm')!.style.display = 'flex';
  const msgs: Record<string, string> = {
    accept: 'Accept this trade?',
    reject: 'Reject this trade?',
    veto: 'Are you sure you want to veto this trade? This will cancel the trade for both teams.',
    approve: 'Approve this trade as commissioner?',
    revoke: 'Withdraw this trade offer?',
  };
  thmEl('thm-confirm-msg')!.textContent = msgs[action] || 'Confirm?';
  thmEl('thm-confirm-yes')!.focus();
}

async function thmExecuteAction(action: 'accept' | 'reject' | 'veto' | 'approve' | 'revoke') {
  const trade = thmGetCurrentTrade();
  if (!trade) return;

  thmEl('thm-confirm')!.style.display = 'none';
  thmEl('thm-actions')!.style.display = 'flex';
  const btns = [thmEl('thm-accept'), thmEl('thm-reject'), thmEl('thm-dismiss')];
  btns.forEach(b => { if (b) (b as HTMLButtonElement).disabled = true; });
  thmEl('thm-error')!.style.display = 'none';

  // MFL response codes: veto→reject, approve→accept, revoke→revoke
  const apiResponse =
    action === 'veto' ? 'reject' :
    action === 'approve' ? 'accept' :
    action;

  try {
    const res = await fetch('/api/trades/respond', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId: trade.tradeId, response: apiResponse }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Action failed');

    const successEl = thmEl('thm-success')!;
    const msgs: Record<string, string> = {
      accept: 'Trade accepted!',
      reject: 'Trade rejected',
      veto: 'Trade vetoed',
      approve: 'Trade approved!',
      revoke: 'Trade withdrawn',
    };
    thmEl('thm-success-text')!.textContent = msgs[action] || 'Done';
    successEl.style.display = 'flex';

    thmDismissTrade(trade.tradeId);

    setTimeout(() => {
      thmRemoveCurrentTrade();
    }, 1200);
  } catch (err: any) {
    thmEl('thm-error')!.textContent = err.message || 'Something went wrong';
    thmEl('thm-error')!.style.display = '';
    btns.forEach(b => { if (b) (b as HTMLButtonElement).disabled = false; });
    const link = thmEl('thm-builder-link');
    if (link && thmCurrentTradeType === 'received') link.style.display = '';
  }
}

function thmDismissTrade(tradeId: string) {
  const dismissed = thmGetDismissed();
  if (!dismissed.includes(tradeId)) {
    dismissed.push(tradeId);
    thmSetDismissed(dismissed);
  }
}

function thmRemoveCurrentTrade() {
  if (thmCurrentTradeType === 'commish') {
    thmCommishTrades.splice(thmCurrentTradeIdx, 1);
  } else if (thmCurrentTradeType === 'sent') {
    thmSentTrades.splice(thmCurrentTradeIdx, 1);
  } else {
    thmTrades.splice(thmCurrentTradeIdx, 1);
  }

  const totalRemaining = thmTrades.length + thmSentTrades.length + thmCommishTrades.length;
  if (totalRemaining === 0) {
    thmClose();
  } else if (totalRemaining === 1) {
    if (thmTrades.length === 1) thmShowDetailView(0, 'received');
    else if (thmSentTrades.length === 1) thmShowDetailView(0, 'sent');
    else thmShowDetailView(0, 'commish');
  } else {
    thmShowListView();
  }
}

// ---- Nav bell badge ----

/**
 * Bell badge = INCOMING TRADES ONLY. The dot = there is something else in the
 * hub worth a look.
 *
 * The split is the point. A number on a bell reads as "act on this", and the
 * only thing in the hub that is genuinely waiting on the owner is a trade
 * somebody sent them. Claims they filed themselves are their own doing — so
 * they get a quiet dot that says the hub is not empty, without inflating a
 * count that would then be wrong about urgency.
 *
 * The bell icon itself never hides; only the badge and dot come and go.
 */
function thmUpdateNavBell(totalCount: number) {
  const badge = thmEl('nav-trade-bell-badge');
  const dot = thmEl('nav-trade-bell-dot');
  const bell = thmEl('nav-trade-bell');

  if (badge) {
    if (totalCount > 0) {
      badge.textContent = String(totalCount);
      badge.setAttribute('aria-label', `${totalCount} pending trade offer${totalCount !== 1 ? 's' : ''}`);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  // Only when the badge is absent — a bell already carrying a number does not
  // need a second marker crowding the same corner.
  const claimCount = thmVisibleClaims()?.length ?? 0;
  const showDot = totalCount === 0 && claimCount > 0;
  if (dot) dot.style.display = showDot ? '' : 'none';

  if (bell) {
    bell.setAttribute(
      'aria-label',
      totalCount > 0
        ? `Transaction hub, ${totalCount} pending trade offer${totalCount !== 1 ? 's' : ''}`
        : showDot
          ? `Transaction hub, ${claimCount} waiver claim${claimCount !== 1 ? 's' : ''} filed`
          : 'Transaction hub',
    );
  }
}

/**
 * The trade that just arrived opens ITSELF, not the hub.
 *
 * This is the interruption path: something landed on the owner while they were
 * doing something else, so the modal should show the thing that interrupted
 * them. The hub is one back-press away. (The bell, below, is the opposite
 * case and lands on the hub.)
 */
function thmAutoOpenTrades(total: number, receivedCount = thmTrades.length) {
  if (total === 1 && receivedCount === 1) {
    thmShowView('detail', 'in');
    thmShowDetailView(0, 'received');
  } else {
    thmShowListView();
  }
  thmOpen();
}

/**
 * The bell opens the HUB, always — never a trade.
 *
 * Deliberately different from the auto-open below. A trade landing on you is
 * an interruption and earns a jump straight to the offer; clicking the bell is
 * the owner asking "what have I got going on", and answering that with one
 * trade's detail screen hides the other two sections behind a back arrow they
 * have no reason to press.
 */
function thmOpenFromBell() {
  thmTrades = [...thmAllTrades];
  thmShowHubView();
  thmOpen();
}

// ---- Event handlers ----
// Element-level handlers must be re-attached after every View Transition because
// Astro's ClientRouter swaps DOM nodes, destroying old event listeners.
// The document-level keydown handler survives swaps and is only attached once.

let thmDocKeydownBound = false;

function thmBindClickOnce(el: HTMLElement | null, key: string, handler: EventListener): void {
  if (!el) return;

  const attr = `data-thm-bound-${key}`;
  if (el.getAttribute(attr) === '1') return;

  el.setAttribute(attr, '1');
  el.addEventListener('click', handler);
}

function thmAttachHandlers() {
  // Element handlers — re-bind to fresh DOM after each View Transition
  thmBindClickOnce(thmEl('thm-overlay'), 'close', thmClose);
  thmBindClickOnce(thmEl('thm-close'), 'close', thmClose);

  // Nav bell click
  thmBindClickOnce(thmEl('nav-trade-bell'), 'open-bell', thmOpenFromBell);

  // Back — every screen's arrow returns to the hub, except a trade detail
  // reached from a list of several, which returns to that list.
  thmBindClickOnce(thmEl('thm-back'), 'back', () =>
    thmTradeCount() > 1 ? thmShowListView() : thmShowHubView(),
  );
  thmBindClickOnce(thmEl('thm-list-back'), 'list-back', thmShowHubView);
  thmBindClickOnce(thmEl('thm-empty-back'), 'empty-back', thmShowHubView);
  thmBindClickOnce(thmEl('thm-claims-back'), 'claims-back', thmShowHubView);
  thmBindClickOnce(thmEl('thm-order-back'), 'order-back', thmShowHubView);

  // Hub rows
  thmBindClickOnce(thmEl('thm-hub-trades'), 'hub-trades', thmShowTradesView);
  thmBindClickOnce(thmEl('thm-hub-claims'), 'hub-claims', thmShowClaimsView);
  thmBindClickOnce(thmEl('thm-hub-order'), 'hub-order', thmShowOrderView);

  // Accept / Reject / Dismiss — routed by current trade type
  thmBindClickOnce(thmEl('thm-accept'), 'accept', () =>
    thmShowConfirm(thmCurrentTradeType === 'commish' ? 'approve' : 'accept')
  );
  thmBindClickOnce(thmEl('thm-reject'), 'reject', () => {
    if (thmCurrentTradeType === 'commish') thmShowConfirm('veto');
    else if (thmCurrentTradeType === 'sent') thmShowConfirm('revoke');
    else thmShowConfirm('reject');
  });
  thmBindClickOnce(thmEl('thm-dismiss'), 'dismiss', () => {
    const trade = thmGetCurrentTrade();
    if (trade) thmDismissTrade(trade.tradeId);
    thmRemoveCurrentTrade();
  });

  // Confirm / Cancel
  thmBindClickOnce(thmEl('thm-confirm-yes'), 'confirm-yes', () => {
    if (thmConfirmAction) thmExecuteAction(thmConfirmAction);
  });
  thmBindClickOnce(thmEl('thm-confirm-no'), 'confirm-no', () => thmResetFooter());

  // ESC + focus trap — document-level, survives View Transitions, attach once
  if (!thmDocKeydownBound) {
    thmDocKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      const modal = thmEl('transaction-hub-modal');
      if (!modal?.classList.contains('active')) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        thmClose();
        return;
      }

      // Focus trap
      if (e.key === 'Tab') {
        const focusable = modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([style*="display: none"]), a[href]:not([style*="display: none"]), [tabindex="0"]'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });
  }
}

// ---- Mock data for preview (?mockTrades=1 for single, ?mockTrades=3 for multi) ----

function thmGetMockTrades(count: number): any[] {
  const now = Math.floor(Date.now() / 1000);
  const mocks = [
    {
      // Computer Jocks offer: Bijan Robinson + 2027 1st for Keon Coleman + Jaylen Wright
      tradeId: 'mock-001',
      offeredBy: '0010',
      offeredTo: '0001',
      offeredByName: 'Computer Jocks',
      offeredToName: 'Pacific Pigskins',
      offeredByIcon: '/assets/theleague/icons/computer_jocks.png',
      offeredToIcon: '/assets/theleague/icons/pigskins.png',
      willGiveUp: '16161,FP_0010_2027_1',
      willReceive: '16617,16610',
      timestamp: now - 3600,
      expires: now + 86400,
      comments: 'Bijan and my 1st for Coleman and Wright. Let me know.',
      byCommish: false,
      resolvedAssets: {
        willGiveUp: [
          { type: 'player', label: 'Robinson, Bijan', position: 'RB', nflTeam: 'ATL', playerId: '16161', espnId: '4430807' },
          { type: 'pick', label: '2027 Rd 1 (via JOCKS)' },
        ],
        willReceive: [
          { type: 'player', label: 'Coleman, Keon', position: 'WR', nflTeam: 'BUF', playerId: '16617', espnId: '4635008' },
          { type: 'player', label: 'Wright, Jaylen', position: 'RB', nflTeam: 'MIA', playerId: '16610', espnId: '4682745' },
        ],
      },
    },
    {
      // Da Dangsters offer: Breece Hall + Romeo Doubs for Rashid Shaheed + 2027 2nd
      tradeId: 'mock-002',
      offeredBy: '0002',
      offeredTo: '0001',
      offeredByName: 'Da Dangsters',
      offeredToName: 'Pacific Pigskins',
      offeredByIcon: '/assets/theleague/icons/da_dangsters.png',
      offeredToIcon: '/assets/theleague/icons/pigskins.png',
      willGiveUp: '15708,15779',
      willReceive: '16080,FP_0001_2027_2',
      timestamp: now - 7200,
      expires: now + 172800,
      comments: '',
      byCommish: false,
      resolvedAssets: {
        willGiveUp: [
          { type: 'player', label: 'Hall, Breece', position: 'RB', nflTeam: 'NYJ', playerId: '15708', espnId: '4427366' },
          { type: 'player', label: 'Doubs, Romeo', position: 'WR', nflTeam: 'NEP', playerId: '15779', espnId: '4361432' },
        ],
        willReceive: [
          { type: 'player', label: 'Shaheed, Rashid', position: 'WR', nflTeam: 'SEA', playerId: '16080', espnId: '4032473' },
          { type: 'pick', label: '2027 Rd 2 (via SKINS)' },
        ],
      },
    },
    {
      // Bring The Pain offer: A.J. Brown + Jahmyr Gibbs for Keon Coleman + Kenneth Gainwell + 2027 3rd
      tradeId: 'mock-003',
      offeredBy: '0008',
      offeredTo: '0001',
      offeredByName: 'Bring The Pain',
      offeredToName: 'Pacific Pigskins',
      offeredByIcon: '/assets/theleague/icons/bring_the_pain.png',
      offeredToIcon: '/assets/theleague/icons/pigskins.png',
      willGiveUp: '14104,16162',
      willReceive: '16617,15255,FP_0001_2027_3',
      timestamp: now - 900,
      expires: now + 259200,
      comments: 'AJ and Gibbs for Coleman, Gainwell, and your 3rd. Big upgrade for you.',
      byCommish: false,
      resolvedAssets: {
        willGiveUp: [
          { type: 'player', label: 'Brown, A.J.', position: 'WR', nflTeam: 'PHI', playerId: '14104', espnId: '4047646' },
          { type: 'player', label: 'Gibbs, Jahmyr', position: 'RB', nflTeam: 'DET', playerId: '16162', espnId: '4429795' },
        ],
        willReceive: [
          { type: 'player', label: 'Coleman, Keon', position: 'WR', nflTeam: 'BUF', playerId: '16617', espnId: '4635008' },
          { type: 'player', label: 'Gainwell, Kenneth', position: 'RB', nflTeam: 'TBB', playerId: '15255', espnId: '4371733' },
          { type: 'pick', label: '2027 Rd 3 (via SKINS)' },
        ],
      },
    },
  ];
  return mocks.slice(0, count);
}

/** Mock commissioner trades — league trades not involving the user */
function thmGetMockCommishTrades(): any[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      tradeId: 'mock-commish-001',
      offeredBy: '0002',
      offeredTo: '0008',
      offeredByName: 'Da Dangsters',
      offeredToName: 'Bring The Pain',
      offeredByIcon: '/assets/theleague/icons/da_dangsters.png',
      offeredToIcon: '/assets/theleague/icons/bring_the_pain.png',
      willGiveUp: '15708',
      willReceive: '16162',
      timestamp: now - 1800,
      expires: now + 86400,
      comments: '',
      byCommish: false,
      resolvedAssets: {
        willGiveUp: [
          { type: 'player', label: 'Hall, Breece', position: 'RB', nflTeam: 'NYJ', playerId: '15708', espnId: '4427366' },
        ],
        willReceive: [
          { type: 'player', label: 'Gibbs, Jahmyr', position: 'RB', nflTeam: 'DET', playerId: '16162', espnId: '4429795' },
        ],
      },
    },
    {
      tradeId: 'mock-commish-002',
      offeredBy: '0010',
      offeredTo: '0002',
      offeredByName: 'Computer Jocks',
      offeredToName: 'Da Dangsters',
      offeredByIcon: '/assets/theleague/icons/computer_jocks.png',
      offeredToIcon: '/assets/theleague/icons/da_dangsters.png',
      willGiveUp: '16150,FP_0010_2027_2',
      willReceive: '15794',
      timestamp: now - 5400,
      expires: now + 172800,
      comments: 'Stroud and my 2nd for McBride.',
      byCommish: false,
      resolvedAssets: {
        willGiveUp: [
          { type: 'player', label: 'Stroud, C.J.', position: 'QB', nflTeam: 'HOU', playerId: '16150', espnId: '4432577' },
          { type: 'pick', label: '2027 Rd 2 (via JOCKS)' },
        ],
        willReceive: [
          { type: 'player', label: 'McBride, Trey', position: 'TE', nflTeam: 'ARI', playerId: '15794', espnId: '4379399' },
        ],
      },
    },
  ];
}

/** Mock outgoing offers — trades the user has sent to others */
function thmGetMockSentTrades(count: number): any[] {
  const now = Math.floor(Date.now() / 1000);
  const mocks = [
    {
      tradeId: 'mock-sent-001',
      offeredBy: '0001',
      offeredTo: '0002',
      offeredByName: 'Pacific Pigskins',
      offeredToName: 'Da Dangsters',
      offeredByIcon: '/assets/theleague/icons/pigskins.png',
      offeredToIcon: '/assets/theleague/icons/da_dangsters.png',
      willGiveUp: '16617',
      willReceive: '15708',
      timestamp: now - 1800,
      expires: now + 86400,
      comments: 'Let me know what you think.',
      byCommish: false,
      resolvedAssets: {
        willGiveUp: [
          { type: 'player', label: 'Coleman, Keon', position: 'WR', nflTeam: 'BUF', playerId: '16617', espnId: '4635008' },
        ],
        willReceive: [
          { type: 'player', label: 'Hall, Breece', position: 'RB', nflTeam: 'NYJ', playerId: '15708', espnId: '4427366' },
        ],
      },
    },
    {
      tradeId: 'mock-sent-002',
      offeredBy: '0001',
      offeredTo: '0010',
      offeredByName: 'Pacific Pigskins',
      offeredToName: 'Computer Jocks',
      offeredByIcon: '/assets/theleague/icons/pigskins.png',
      offeredToIcon: '/assets/theleague/icons/computer_jocks.png',
      willGiveUp: '15255,FP_0001_2027_3',
      willReceive: '16161',
      timestamp: now - 10800,
      expires: now + 172800,
      comments: '',
      byCommish: false,
      resolvedAssets: {
        willGiveUp: [
          { type: 'player', label: 'Gainwell, Kenneth', position: 'RB', nflTeam: 'TBB', playerId: '15255', espnId: '4371733' },
          { type: 'pick', label: '2027 Rd 3 (via SKINS)' },
        ],
        willReceive: [
          { type: 'player', label: 'Robinson, Bijan', position: 'RB', nflTeam: 'ATL', playerId: '16161', espnId: '4430807' },
        ],
      },
    },
  ];
  return mocks.slice(0, count);
}

// ---- Polling logic ----

async function thmCheckAuth(): Promise<{ franchiseId: string; role: string } | null> {
  if (thmAuthCache !== undefined) return thmAuthCache;
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    if (data.authenticated && data.user?.franchiseId) {
      thmAuthCache = { franchiseId: data.user.franchiseId, role: data.user.role || 'owner' };
    } else {
      thmAuthCache = null;
    }
  } catch {
    thmAuthCache = null;
  }
  return thmAuthCache;
}

function thmIsCommissioner(): boolean {
  return thmAuthCache?.role === 'commissioner' || thmAuthCache?.role === 'admin';
}

function thmShowMockTrades(trades: any[], sentTrades: any[], mockCommish: boolean) {
  // Clear dismissed for mock trades so they always show
  const dismissed = thmGetDismissed();
  const commish = mockCommish ? thmGetMockCommishTrades() : [];
  const allMocks = [...trades, ...sentTrades, ...commish];
  const mockIds = allMocks.map(t => t.tradeId);
  const cleaned = dismissed.filter(id => !mockIds.includes(id));
  if (cleaned.length !== dismissed.length) thmSetDismissed(cleaned);

  // Store trades
  thmAllTrades = trades;
  thmSentTrades = sentTrades;
  thmCommishTrades = commish;
  thmTrades = [...trades];
  // Badge = incoming only (received + commish). Sent trades never contribute to the alert.
  thmUpdateNavBell(trades.length + commish.length);
  thmAttachHandlers();

  // Auto-open only when there are incoming trades (received or commish approvals).
  // Sent-only mocks don't auto-open — you reach them via the bell click.
  const hasIncoming = thmTrades.length > 0 || thmCommishTrades.length > 0;
  if (!hasIncoming) return;

  thmAutoOpenTrades(thmTrades.length + thmSentTrades.length + thmCommishTrades.length);
}

async function thmPoll() {
  // Always attach handlers so the bell click works (even with no trades)
  thmAttachHandlers();

  // Mock mode: ?mockTrades=N and/or ?mockSent=N and/or ?mockCommish=1 (dev/preview only)
  // Mocks skip debounce so they always work on reload
  const params = new URLSearchParams(window.location.search);
  const mockParam = params.get('mockTrades');
  const mockSentParam = params.get('mockSent');
  const mockCommish = params.get('mockCommish') === '1';
  if (mockParam || mockSentParam || mockCommish) {
    const receivedCount = mockParam ? Math.max(1, Math.min(3, parseInt(mockParam, 10) || 1)) : 0;
    const sentCount = mockSentParam ? Math.max(1, Math.min(2, parseInt(mockSentParam, 10) || 1)) : 0;
    thmShowMockTrades(
      receivedCount > 0 ? thmGetMockTrades(receivedCount) : [],
      sentCount > 0 ? thmGetMockSentTrades(sentCount) : [],
      mockCommish,
    );
    return;
  }

  // No mock param — clear any stale mock data from previous page
  const hasMocks =
    (thmTrades[0]?.tradeId?.startsWith('mock-')) ||
    (thmSentTrades[0]?.tradeId?.startsWith('mock-')) ||
    (thmCommishTrades[0]?.tradeId?.startsWith('mock-'));
  if (hasMocks) {
    thmTrades = [];
    thmAllTrades = [];
    thmSentTrades = [];
    thmCommishTrades = [];
    thmUpdateNavBell(0);
  }

  // Debounce real API calls
  try {
    const last = Number(sessionStorage.getItem(THM_DEBOUNCE_KEY) || '0');
    if (Date.now() - last < THM_DEBOUNCE_MS) return;
    sessionStorage.setItem(THM_DEBOUNCE_KEY, Date.now().toString());
  } catch {}

  const auth = await thmCheckAuth();
  if (!auth) return;

  // The dot has to be right before the owner opens anything, so the claims
  // read happens here — but on its OWN 5-minute debounce inside thmLoadClaims,
  // not the trades' 60s one. Fire-and-forget: it must never delay the trade
  // poll, which is what decides whether the modal auto-opens.
  void thmLoadClaims().then(() => {
    thmUpdateNavBell(thmTrades.length + thmCommishTrades.length);
    if (thmCurrentView === 'hub') thmRenderHubView();
  });

  try {
    // Commissioner gets league-wide trades too
    const commishParam = thmIsCommissioner() ? '?commish=1' : '';
    const res = await fetch(`/api/trades/pending${commishParam}`, { credentials: 'include' });
    const data = await res.json();

    const hasTrades = data.success && data.trades?.length;
    const hasCommish = data.success && data.commishTrades?.length;

    if (!hasTrades && !hasCommish) {
      thmUpdateNavBell(0);
      thmAllTrades = [];
      thmSentTrades = [];
      thmCommishTrades = [];
      thmTrades = [];
      return;
    }

    // Split personal trades into incoming (received) and outgoing (sent)
    const received = hasTrades
      ? data.trades.filter((t: any) => t.offeredTo === auth.franchiseId)
      : [];
    const sent = hasTrades
      ? data.trades.filter((t: any) => t.offeredBy === auth.franchiseId)
      : [];
    thmAllTrades = received;
    thmSentTrades = sent;
    thmCommishTrades = hasCommish ? data.commishTrades : [];
    thmTrades = [...received];

    // Badge = incoming only (received + commissioner approvals). Sent trades never trigger the alert.
    const incomingCount = received.length + thmCommishTrades.length;
    thmUpdateNavBell(incomingCount);
    thmAttachHandlers();

    // Auto-show modal for undismissed INCOMING trades only (received + commish).
    // Sent trades are viewable via the bell click but never auto-open the modal.
    const dismissed = thmGetDismissed();
    const undismissedReceived = received.filter((t: any) => !dismissed.includes(t.tradeId));
    const undismissedCommish = thmCommishTrades.filter((t: any) => !dismissed.includes(t.tradeId));
    const totalUndismissed = undismissedReceived.length + undismissedCommish.length;

    if (totalUndismissed > 0) {
      thmTrades = undismissedReceived;
      thmAutoOpenTrades(totalUndismissed, undismissedReceived.length);
    }
  } catch {
    // Silent fail — don't interrupt the user
  }
}

document.addEventListener('astro:page-load', thmPoll);

// Force an immediate fresh poll when a trade is submitted/accepted/rejected
// elsewhere in the app, bypassing the 60s debounce so the bell badge and
// modal reflect the new state without waiting for a navigation.
document.addEventListener('mfl:trades-changed', () => {
  try { sessionStorage.removeItem(THM_DEBOUNCE_KEY); } catch {}
  thmPoll();
});

/**
 * The owner just filed, deleted or edited a claim on this page (WaiverClaimModal
 * fires this). Force a re-read rather than waiting out the 5-minute debounce —
 * the one moment the count is guaranteed stale is the moment they changed it.
 */
document.addEventListener('waiver-claims:changed', () => {
  try {
    sessionStorage.removeItem(THM_CLAIMS_DEBOUNCE_KEY);
    sessionStorage.removeItem(`${THM_CLAIMS_DEBOUNCE_KEY}:data`);
  } catch {}
  thmClaims = null;
  thmClaimsError = null;
  void thmLoadClaims(true).then(() => {
    thmUpdateNavBell(thmTrades.length + thmCommishTrades.length);
    if (thmCurrentView === 'hub') thmRenderHubView();
    if (thmCurrentView === 'claims') thmRenderClaimsView();
  });
});
