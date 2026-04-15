/**
 * Trade Alert Modal — polling + interaction logic
 *
 * Checks for pending received trades on every page load (debounced to 60s).
 * Shows a modal with list/detail views for reviewing and acting on offers.
 * Dismissed trade IDs are stored in localStorage so they don't re-alert.
 */

import { buildPlayerCellHTML } from '../utils/player-cell-html';

const TAM_STORAGE_KEY = 'mfl:trade-alert-dismissed';
const TAM_DEBOUNCE_KEY = 'mfl:trade-alert-last-check';
const TAM_DEBOUNCE_MS = 60_000;

/** Cached auth info for the session */
let tamAuthCache: { franchiseId: string; role: string } | null | undefined = undefined;

/** All received trades (persists across dismiss — used by bell click to reopen) */
let tamAllTrades: any[] = [];
/** Commissioner trades — league-wide trades not involving the user */
let tamCommishTrades: any[] = [];
/** Current trades in the modal (may be filtered by dismiss within a session) */
let tamTrades: any[] = [];
/** Index of the currently viewed trade in detail view */
let tamCurrentTradeIdx = -1;
/** Whether the currently viewed trade is a commissioner trade (affects UI) */
let tamIsCommishTrade = false;
/** Whether a confirm prompt is active */
let tamConfirmAction: 'accept' | 'reject' | 'veto' | 'approve' | null = null;
/** Previously focused element for focus return */
let tamPrevFocus: HTMLElement | null = null;

// ---- Helpers ----

function tamGetDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TAM_STORAGE_KEY) || '[]');
  } catch { return []; }
}

function tamSetDismissed(ids: string[]) {
  try { localStorage.setItem(TAM_STORAGE_KEY, JSON.stringify(ids)); } catch {}
}

function tamFormatRelativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function tamFormatExpiry(ts: number): string {
  if (!ts) return '';
  const now = Math.floor(Date.now() / 1000);
  const left = ts - now;
  if (left <= 0) return 'Expired';
  if (left < 3600) return `Expires in ${Math.floor(left / 60)}m`;
  if (left < 86400) return `Expires in ${Math.floor(left / 3600)}h`;
  return `Expires in ${Math.floor(left / 86400)}d`;
}

/** Format player name from "Last, First" to "First Last" */
function tamDisplayName(label: string): string {
  const parts = label.split(', ');
  return parts.length > 1 ? parts[1] + ' ' + parts[0] : label;
}

function tamSummarizeAssets(assets: any[]): string {
  if (!assets?.length) return 'nothing';
  const names = assets.slice(0, 2).map((a: any) =>
    a.type === 'player' ? tamDisplayName(a.label) : a.label
  );
  if (assets.length > 2) names.push(`+${assets.length - 2} more`);
  return names.join(', ');
}

/** Build Trade Builder URL from a pending trade's raw asset strings.
 *  Team A = user (offeredTo), Team B = counterparty (offeredBy).
 *  willGiveUp/willReceive are from the PROPOSER's perspective:
 *    willGiveUp = what proposer gives = what user receives (Team B players)
 *    willReceive = what proposer receives = what user gives (Team A players) */
function tamBuildTradeBuilderUrl(trade: any): string {
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

  return `/theleague/trade-builder?${params.toString()}`;
}

// ---- DOM refs ----

function tamEl(id: string) { return document.getElementById(id); }

// ---- Open / Close ----

function tamOpen() {
  const modal = tamEl('trade-alert-modal');
  if (!modal) return;
  tamPrevFocus = document.activeElement as HTMLElement;
  document.body.style.overflow = 'hidden';
  // Close nav drawer if open
  const navApi = (window as any).navDrawer;
  if (navApi?.isOpen?.()) navApi.close();
  modal.classList.add('active');
  tamEl('tam-close')?.focus();
}

function tamClose() {
  const modal = tamEl('trade-alert-modal');
  if (!modal) return;
  modal.classList.remove('active');
  document.body.style.overflow = '';
  tamConfirmAction = null;
  if (tamPrevFocus) {
    tamPrevFocus.focus();
    tamPrevFocus = null;
  }
}

// ---- Build list card via safe DOM methods ----

function tamBuildListCard(trade: any, idx: number, isCommish: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'tam-list-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  if (isCommish) {
    // Commissioner card: show both teams
    card.setAttribute('aria-label', `Trade between ${trade.offeredByName} and ${trade.offeredToName}`);

    const icon = document.createElement('img');
    icon.className = 'tam-list-card__icon';
    icon.src = trade.offeredByIcon || '';
    icon.alt = '';
    card.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'tam-list-card__body';

    const teamP = document.createElement('p');
    teamP.className = 'tam-list-card__team';
    teamP.textContent = `${trade.offeredByName || '?'} \u2194 ${trade.offeredToName || '?'}`;
    body.appendChild(teamP);

    const summaryP = document.createElement('p');
    summaryP.className = 'tam-list-card__summary';
    const giveAssets = trade.resolvedAssets?.willGiveUp || [];
    const receiveAssets = trade.resolvedAssets?.willReceive || [];
    summaryP.textContent = `${tamSummarizeAssets(giveAssets)} for ${tamSummarizeAssets(receiveAssets)}`;
    body.appendChild(summaryP);

    card.appendChild(body);
  } else {
    // Owner card: show counterparty
    card.setAttribute('aria-label', `Trade offer from ${trade.offeredByName || 'Unknown'}`);

    const icon = document.createElement('img');
    icon.className = 'tam-list-card__icon';
    icon.src = trade.offeredByIcon || '';
    icon.alt = '';
    card.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'tam-list-card__body';

    const teamP = document.createElement('p');
    teamP.className = 'tam-list-card__team';
    teamP.textContent = trade.offeredByName || 'Unknown';
    body.appendChild(teamP);

    const summaryP = document.createElement('p');
    summaryP.className = 'tam-list-card__summary';
    const receiveAssets = trade.resolvedAssets?.willReceive || [];
    const giveAssets = trade.resolvedAssets?.willGiveUp || [];
    summaryP.textContent = `Get: ${tamSummarizeAssets(receiveAssets)} \u00B7 Give: ${tamSummarizeAssets(giveAssets)}`;
    body.appendChild(summaryP);

    card.appendChild(body);
  }

  // Time + chevron (shared)
  const time = document.createElement('span');
  time.className = 'tam-list-card__time';
  time.textContent = tamFormatRelativeTime(trade.timestamp);
  card.appendChild(time);

  const arrowNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(arrowNS, 'svg');
  svg.setAttribute('class', 'tam-list-card__arrow');
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

  // Click handler — commissioner trades use negative index to distinguish
  const clickIdx = isCommish ? -(idx + 1) : idx;
  card.addEventListener('click', () => tamShowDetailView(clickIdx));
  card.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tamShowDetailView(clickIdx); }
  });
  return card;
}

// ---- Render List View ----

function tamShowListView() {
  const listView = tamEl('tam-list-view')!;
  const detailView = tamEl('tam-detail-view')!;
  detailView.style.display = 'none';
  listView.style.display = 'flex';
  listView.classList.remove('slide-in', 'slide-back');
  void listView.offsetWidth;
  listView.classList.add('slide-back');

  const totalCount = tamTrades.length + tamCommishTrades.length;
  tamEl('tam-badge')!.textContent = String(totalCount);
  const body = tamEl('tam-list-body')!;
  body.replaceChildren();

  // Section: Your Offers (only show header if commissioner trades also exist)
  if (tamTrades.length > 0 && tamCommishTrades.length > 0) {
    const header = document.createElement('h4');
    header.className = 'tam-section-title';
    header.textContent = 'Your Offers';
    body.appendChild(header);
  }

  tamTrades.forEach((trade, idx) => {
    body.appendChild(tamBuildListCard(trade, idx, false));
  });

  // Section: Pending Approval (commissioner only)
  if (tamCommishTrades.length > 0) {
    const header = document.createElement('h4');
    header.className = 'tam-section-title';
    header.textContent = 'Pending Approval';
    body.appendChild(header);

    tamCommishTrades.forEach((trade, idx) => {
      body.appendChild(tamBuildListCard(trade, idx, true));
    });
  }
}

// ---- Render Detail View ----

function tamRenderAssetList(container: HTMLElement, assets: any[]) {
  container.replaceChildren();
  if (!assets?.length) {
    const li = document.createElement('li');
    li.className = 'tam-asset-item tam-asset-item--empty';
    li.textContent = 'Nothing';
    container.appendChild(li);
    return;
  }
  for (const asset of assets) {
    const li = document.createElement('li');
    li.className = 'tam-asset-item';
    if (asset.type === 'player') {
      // Use player lockup pattern (headshot + team logo + position)
      // buildPlayerCellHTML escapes all data internally via its own esc() function
      const headshot = asset.espnId
        ? `https://a.espncdn.com/i/headshots/nfl/players/full/${asset.espnId}.png`
        : undefined;
      const safeHtml = buildPlayerCellHTML({
        name: tamDisplayName(asset.label),
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
      li.classList.add('tam-asset-item--pick');
      li.textContent = asset.label;
    } else {
      li.classList.add('tam-asset-item--bbid');
      li.textContent = asset.label;
    }
    container.appendChild(li);
  }
}

function tamShowDetailView(idx: number) {
  // Negative index = commissioner trade (-(commishIdx + 1))
  let trade: any;
  if (idx < 0) {
    tamIsCommishTrade = true;
    tamCurrentTradeIdx = idx;
    trade = tamCommishTrades[-(idx + 1)];
  } else {
    tamIsCommishTrade = false;
    tamCurrentTradeIdx = idx;
    trade = tamTrades[idx];
  }
  if (!trade) return;

  const listView = tamEl('tam-list-view')!;
  const detailView = tamEl('tam-detail-view')!;
  listView.style.display = 'none';
  detailView.style.display = 'flex';
  detailView.classList.remove('slide-in', 'slide-back');
  void detailView.offsetWidth;
  detailView.classList.add('slide-in');

  // Show back button when there are multiple items total
  const totalItems = tamTrades.length + tamCommishTrades.length;
  tamEl('tam-back')!.style.display = totalItems > 1 ? '' : 'none';

  // Hero — commissioner sees "Trade between X & Y", owner sees "Trade offer from X"
  const iconEl = tamEl('tam-counterparty-icon') as HTMLImageElement;
  const labelEl = detailView.querySelector('.tam-detail-hero__label')!;
  if (tamIsCommishTrade) {
    iconEl.src = trade.offeredByIcon || '';
    iconEl.alt = '';
    labelEl.textContent = 'Trade between';
    tamEl('tam-counterparty-name')!.textContent =
      `${trade.offeredByName || '?'} & ${trade.offeredToName || '?'}`;
  } else {
    iconEl.src = trade.offeredByIcon || '';
    iconEl.alt = trade.offeredByName || '';
    labelEl.textContent = 'Trade offer from';
    tamEl('tam-counterparty-name')!.textContent = trade.offeredByName || 'Unknown';
  }

  // Meta
  tamEl('tam-detail-time')!.textContent = tamFormatRelativeTime(trade.timestamp);
  const expiresText = tamFormatExpiry(trade.expires);
  const expiresEl = tamEl('tam-detail-expires')!;
  expiresEl.textContent = expiresText;
  expiresEl.style.display = expiresText ? '' : 'none';

  // Asset column titles — commissioner sees team names, owner sees "You Receive" / "You Give"
  const receiveTitle = tamEl('tam-assets-receive-title')!;
  const giveTitle = tamEl('tam-assets-give-title')!;
  if (tamIsCommishTrade) {
    receiveTitle.textContent = trade.offeredToName || 'Team B';
    receiveTitle.className = 'tam-assets-col__title';
    giveTitle.textContent = trade.offeredByName || 'Team A';
    giveTitle.className = 'tam-assets-col__title';
  } else {
    receiveTitle.textContent = 'You Receive';
    receiveTitle.className = 'tam-assets-col__title tam-assets-col__title--receive';
    giveTitle.textContent = 'You Give';
    giveTitle.className = 'tam-assets-col__title tam-assets-col__title--give';
  }

  // Assets — for commissioner, willGiveUp = what offeredBy gives, willReceive = what offeredBy receives
  tamRenderAssetList(tamEl('tam-assets-receive')!, trade.resolvedAssets?.willReceive || []);
  tamRenderAssetList(tamEl('tam-assets-give')!, trade.resolvedAssets?.willGiveUp || []);

  // Comments
  const commentsEl = tamEl('tam-comments')!;
  if (trade.comments) {
    tamEl('tam-comments-text')!.textContent = trade.comments;
    commentsEl.style.display = '';
  } else {
    commentsEl.style.display = 'none';
  }

  // Builder link
  (tamEl('tam-builder-link') as HTMLAnchorElement).href = tamBuildTradeBuilderUrl(trade);

  // Footer — commissioner gets "Review Cap Impact" + Approve + subtle Veto
  // Owner gets Accept/Reject
  const acceptBtn = tamEl('tam-accept') as HTMLElement;
  const rejectBtn = tamEl('tam-reject') as HTMLElement;
  const builderLink = tamEl('tam-builder-link') as HTMLElement;
  if (tamIsCommishTrade) {
    acceptBtn.style.display = '';
    acceptBtn.textContent = 'Approve';
    acceptBtn.className = 'tam-btn tam-btn--accept';
    rejectBtn.textContent = 'Veto';
    rejectBtn.className = 'tam-btn tam-btn--dismiss';
    rejectBtn.style.fontSize = '0.75rem';
    builderLink.style.display = 'none';
  } else {
    acceptBtn.style.display = '';
    acceptBtn.textContent = 'Accept';
    acceptBtn.className = 'tam-btn tam-btn--accept';
    rejectBtn.textContent = 'Reject';
    rejectBtn.className = 'tam-btn tam-btn--reject';
    rejectBtn.style.fontSize = '';
    builderLink.style.display = '';
  }

  tamResetFooter();
}

function tamResetFooter() {
  tamConfirmAction = null;
  tamEl('tam-confirm')!.style.display = 'none';
  tamEl('tam-actions')!.style.display = 'flex';
  tamEl('tam-error')!.style.display = 'none';
  tamEl('tam-success')!.style.display = 'none';
  const btns = [tamEl('tam-accept'), tamEl('tam-reject'), tamEl('tam-dismiss')];
  btns.forEach(b => { if (b) (b as HTMLButtonElement).disabled = false; });
}

// ---- Actions ----

function tamShowConfirm(action: 'accept' | 'reject' | 'veto' | 'approve') {
  tamConfirmAction = action;
  tamEl('tam-actions')!.style.display = 'none';
  tamEl('tam-confirm')!.style.display = 'flex';
  const msgs: Record<string, string> = {
    accept: 'Accept this trade?',
    reject: 'Reject this trade?',
    veto: 'Are you sure you want to veto this trade? This will cancel the trade for both teams.',
    approve: 'Approve this trade as commissioner?',
  };
  tamEl('tam-confirm-msg')!.textContent = msgs[action] || 'Confirm?';
  tamEl('tam-confirm-yes')!.focus();
}

async function tamExecuteAction(action: 'accept' | 'reject' | 'veto' | 'approve') {
  // Resolve the trade from the correct array
  let trade: any;
  if (tamIsCommishTrade && tamCurrentTradeIdx < 0) {
    trade = tamCommishTrades[-(tamCurrentTradeIdx + 1)];
  } else {
    trade = tamTrades[tamCurrentTradeIdx];
  }
  if (!trade) return;

  tamEl('tam-confirm')!.style.display = 'none';
  tamEl('tam-actions')!.style.display = 'flex';
  const btns = [tamEl('tam-accept'), tamEl('tam-reject'), tamEl('tam-dismiss')];
  btns.forEach(b => { if (b) (b as HTMLButtonElement).disabled = true; });
  tamEl('tam-error')!.style.display = 'none';

  try {
    const res = await fetch('/api/trades/respond', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId: trade.tradeId, response: action === 'veto' ? 'reject' : action === 'approve' ? 'accept' : action }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Action failed');

    // Show success
    const successEl = tamEl('tam-success')!;
    const msgs: Record<string, string> = {
      accept: 'Trade accepted!',
      reject: 'Trade rejected',
      veto: 'Trade vetoed',
      approve: 'Trade approved!',
    };
    tamEl('tam-success-text')!.textContent = msgs[action] || 'Done';
    successEl.style.display = 'flex';

    // Also dismiss so it doesn't reappear
    tamDismissTrade(trade.tradeId);

    // Auto-close after brief delay
    setTimeout(() => {
      tamRemoveCurrentTrade();
    }, 1200);
  } catch (err: any) {
    tamEl('tam-error')!.textContent = err.message || 'Something went wrong';
    tamEl('tam-error')!.style.display = '';
    btns.forEach(b => { if (b) (b as HTMLButtonElement).disabled = false; });
    // On failure, show the Trade Builder link so they can review cap impact
    const link = tamEl('tam-builder-link');
    if (link) link.style.display = '';
  }
}

function tamDismissTrade(tradeId: string) {
  const dismissed = tamGetDismissed();
  if (!dismissed.includes(tradeId)) {
    dismissed.push(tradeId);
    tamSetDismissed(dismissed);
  }
}

function tamRemoveCurrentTrade() {
  if (tamIsCommishTrade && tamCurrentTradeIdx < 0) {
    tamCommishTrades.splice(-(tamCurrentTradeIdx + 1), 1);
  } else {
    tamTrades.splice(tamCurrentTradeIdx, 1);
  }

  const totalRemaining = tamTrades.length + tamCommishTrades.length;
  if (totalRemaining === 0) {
    tamClose();
  } else if (totalRemaining === 1 && tamTrades.length === 1) {
    tamShowDetailView(0);
  } else {
    tamShowListView();
  }
}

// ---- Nav bell badge ----

/** Update the nav bell icon badge with total pending trade count (sent + received).
 *  The bell icon always stays visible — only the badge appears/disappears. */
function tamUpdateNavBell(totalCount: number) {
  const badge = tamEl('nav-trade-bell-badge');
  if (!badge) return;

  if (totalCount > 0) {
    badge.textContent = String(totalCount);
    badge.setAttribute('aria-label', `${totalCount} pending trade offer${totalCount !== 1 ? 's' : ''}`);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

/** Open the trade alert modal from the nav bell — shows trades or empty state */
function tamOpenFromBell() {
  const hasPersonal = tamAllTrades.length > 0;
  const hasCommish = tamCommishTrades.length > 0;

  if (hasPersonal || hasCommish) {
    tamTrades = [...tamAllTrades];
    tamEl('tam-empty-view')!.style.display = 'none';
    if (tamTrades.length === 1 && !hasCommish) {
      tamEl('tam-list-view')!.style.display = 'none';
      tamEl('tam-detail-view')!.style.display = 'flex';
      tamShowDetailView(0);
    } else {
      tamEl('tam-detail-view')!.style.display = 'none';
      tamEl('tam-list-view')!.style.display = 'flex';
      tamShowListView();
    }
  } else {
    // No trades — show empty state with Trade Builder CTA
    tamEl('tam-list-view')!.style.display = 'none';
    tamEl('tam-detail-view')!.style.display = 'none';
    tamEl('tam-empty-view')!.style.display = 'flex';
  }
  tamOpen();
}

// ---- Event handlers ----
// Element-level handlers must be re-attached after every View Transition because
// Astro's ClientRouter swaps DOM nodes, destroying old event listeners.
// The document-level keydown handler survives swaps and is only attached once.

let tamDocKeydownBound = false;

function tamAttachHandlers() {
  // Element handlers — re-bind to fresh DOM after each View Transition
  tamEl('tam-overlay')?.addEventListener('click', tamClose);
  tamEl('tam-close')?.addEventListener('click', tamClose);

  // Nav bell click
  tamEl('nav-trade-bell')?.addEventListener('click', tamOpenFromBell);

  // Back
  tamEl('tam-back')?.addEventListener('click', () => tamShowListView());

  // Accept / Reject / Dismiss
  tamEl('tam-accept')?.addEventListener('click', () =>
    tamShowConfirm(tamIsCommishTrade ? 'approve' : 'accept')
  );
  tamEl('tam-reject')?.addEventListener('click', () =>
    tamShowConfirm(tamIsCommishTrade ? 'veto' : 'reject')
  );
  tamEl('tam-dismiss')?.addEventListener('click', () => {
    const trade = tamTrades[tamCurrentTradeIdx];
    if (trade) tamDismissTrade(trade.tradeId);
    tamRemoveCurrentTrade();
  });

  // Confirm / Cancel
  tamEl('tam-confirm-yes')?.addEventListener('click', () => {
    if (tamConfirmAction) tamExecuteAction(tamConfirmAction);
  });
  tamEl('tam-confirm-no')?.addEventListener('click', () => tamResetFooter());

  // ESC + focus trap — document-level, survives View Transitions, attach once
  if (!tamDocKeydownBound) {
    tamDocKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      const modal = tamEl('trade-alert-modal');
      if (!modal?.classList.contains('active')) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        tamClose();
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

function tamGetMockTrades(count: number): any[] {
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
function tamGetMockCommishTrades(): any[] {
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

// ---- Polling logic ----

async function tamCheckAuth(): Promise<{ franchiseId: string; role: string } | null> {
  if (tamAuthCache !== undefined) return tamAuthCache;
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    if (data.authenticated && data.user?.franchiseId) {
      tamAuthCache = { franchiseId: data.user.franchiseId, role: data.user.role || 'owner' };
    } else {
      tamAuthCache = null;
    }
  } catch {
    tamAuthCache = null;
  }
  return tamAuthCache;
}

function tamIsCommissioner(): boolean {
  return tamAuthCache?.role === 'commissioner' || tamAuthCache?.role === 'admin';
}

function tamShowMockTrades(trades: any[], mockCommish: boolean) {
  // Clear dismissed for mock trades so they always show
  const dismissed = tamGetDismissed();
  const allMocks = [...trades];
  const commish = mockCommish ? tamGetMockCommishTrades() : [];
  allMocks.push(...commish);
  const mockIds = allMocks.map(t => t.tradeId);
  const cleaned = dismissed.filter(id => !mockIds.includes(id));
  if (cleaned.length !== dismissed.length) tamSetDismissed(cleaned);

  // Store trades
  tamAllTrades = trades;
  tamCommishTrades = commish;
  tamTrades = [...trades];
  tamUpdateNavBell(trades.length + commish.length);
  tamAttachHandlers();

  // Auto-show
  const totalVisible = tamTrades.length + tamCommishTrades.length;
  if (totalVisible === 0) return;

  tamEl('tam-empty-view')!.style.display = 'none';
  if (totalVisible === 1 && tamTrades.length === 1) {
    tamEl('tam-list-view')!.style.display = 'none';
    tamEl('tam-detail-view')!.style.display = 'flex';
    tamShowDetailView(0);
  } else {
    tamEl('tam-detail-view')!.style.display = 'none';
    tamEl('tam-list-view')!.style.display = 'flex';
    tamShowListView();
  }
  tamOpen();
}

async function tamPoll() {
  // Always attach handlers so the bell click works (even with no trades)
  tamAttachHandlers();

  // Mock mode: ?mockTrades=N and/or ?mockCommish=1 (dev/preview only)
  // Mocks skip debounce so they always work on reload
  const params = new URLSearchParams(window.location.search);
  const mockParam = params.get('mockTrades');
  const mockCommish = params.get('mockCommish') === '1';
  if (mockParam || mockCommish) {
    const count = mockParam ? Math.max(1, Math.min(3, parseInt(mockParam, 10) || 1)) : 0;
    tamShowMockTrades(count > 0 ? tamGetMockTrades(count) : [], mockCommish);
    return;
  }

  // No mock param — clear any stale mock data from previous page
  if (tamTrades.length > 0 && tamTrades[0]?.tradeId?.startsWith('mock-')) {
    tamTrades = [];
    tamAllTrades = [];
    tamCommishTrades = [];
    tamUpdateNavBell(0);
  }

  // Debounce real API calls
  try {
    const last = Number(sessionStorage.getItem(TAM_DEBOUNCE_KEY) || '0');
    if (Date.now() - last < TAM_DEBOUNCE_MS) return;
    sessionStorage.setItem(TAM_DEBOUNCE_KEY, Date.now().toString());
  } catch {}

  const auth = await tamCheckAuth();
  if (!auth) return;

  try {
    // Commissioner gets league-wide trades too
    const commishParam = tamIsCommissioner() ? '?commish=1' : '';
    const res = await fetch(`/api/trades/pending${commishParam}`, { credentials: 'include' });
    const data = await res.json();

    const hasTrades = data.success && data.trades?.length;
    const hasCommish = data.success && data.commishTrades?.length;

    if (!hasTrades && !hasCommish) {
      tamUpdateNavBell(0);
      tamAllTrades = [];
      tamCommishTrades = [];
      tamTrades = [];
      return;
    }

    // Cache trades
    const received = hasTrades
      ? data.trades.filter((t: any) => t.offeredTo === auth.franchiseId)
      : [];
    tamAllTrades = received;
    tamCommishTrades = hasCommish ? data.commishTrades : [];
    tamTrades = [...received];

    // Badge = total (personal sent+received + commissioner)
    const totalCount = (data.trades?.length || 0) + tamCommishTrades.length;
    tamUpdateNavBell(totalCount);
    tamAttachHandlers();

    // Auto-show modal for undismissed trades (personal + commissioner)
    const dismissed = tamGetDismissed();
    const undismissedPersonal = received.filter((t: any) => !dismissed.includes(t.tradeId));
    const undismissedCommish = tamCommishTrades.filter((t: any) => !dismissed.includes(t.tradeId));
    const totalUndismissed = undismissedPersonal.length + undismissedCommish.length;

    if (totalUndismissed > 0) {
      tamTrades = undismissedPersonal;
      tamEl('tam-empty-view')!.style.display = 'none';
      if (totalUndismissed === 1 && undismissedPersonal.length === 1) {
        tamEl('tam-list-view')!.style.display = 'none';
        tamEl('tam-detail-view')!.style.display = 'flex';
        tamShowDetailView(0);
      } else {
        tamEl('tam-detail-view')!.style.display = 'none';
        tamEl('tam-list-view')!.style.display = 'flex';
        tamShowListView();
      }
      tamOpen();
    }
  } catch {
    // Silent fail — don't interrupt the user
  }
}

document.addEventListener('astro:page-load', tamPoll);
