/**
 * The site owner's My Rank on the shared Trade Builder (AFL and the package
 * leagues): This season / This week / Dynasty pills, a "My #N" beside each
 * player's ADP, and each picker list re-sorted by that rank. Everyone else's
 * page is untouched: it runs only when the league layout's MyRanksMarker
 * carries `data-owner`, and the ranks come from /api/my-ranks (never HTML).
 *
 * TheLeague's React Trade Builder has the same pills (TradeBuilder.tsx).
 */
import type { MyRankKind } from './my-ranks';
import { myRankList } from './my-ranks-client';

const KINDS: { kind: MyRankKind; label: string }[] = [
  { kind: 'season', label: 'This season' },
  { kind: 'week', label: 'This week' },
  { kind: 'dynasty', label: 'Dynasty' },
];
const KEY = 'my-rank-kind:trade-builder';

function savedKind(): MyRankKind {
  try {
    const v = localStorage.getItem(KEY);
    const hit = KINDS.find((k) => k.kind === v);
    if (hit) return hit.kind;
  } catch {
    /* the default stands */
  }
  return KINDS[0].kind;
}

function render(kind: MyRankKind): void {
  const list = myRankList(kind);
  if (list === 'loading' || !list) return;
  document.querySelectorAll<HTMLUListElement>('.tb-picker').forEach((ul) => {
    const items = Array.from(ul.querySelectorAll<HTMLLIElement>(':scope > .tb-picker__item[data-asset-type="player"]'));
    if (!items.length) return;
    items.forEach((li, i) => {
      if (!li.dataset.adpOrder) li.dataset.adpOrder = String(i);
      const adpEl = li.querySelector<HTMLElement>('.tb-picker__adp');
      if (adpEl) {
        if (adpEl.dataset.adpText == null) adpEl.dataset.adpText = adpEl.textContent ?? '';
        const r = list.ranks[li.dataset.assetId ?? ''];
        adpEl.textContent = r != null ? `My #${r} · ${adpEl.dataset.adpText}` : adpEl.dataset.adpText;
        adpEl.title = `My Rank · ${list.label}`;
      }
    });
    const rankOf = (li: HTMLLIElement) => list.ranks[li.dataset.assetId ?? ''] ?? Infinity;
    items
      .sort((a, b) => rankOf(a) - rankOf(b) || Number(a.dataset.adpOrder) - Number(b.dataset.adpOrder))
      .forEach((li) => ul.append(li));
    const title = ul.closest('.tb-section')?.querySelector('.tb-section__title');
    if (title?.textContent?.includes('ranked by ADP')) title.textContent = title.textContent.replace('ranked by ADP', 'ranked by My Rank');
  });
}

let onUpdate: (() => void) | null = null;

function init(): void {
  if (onUpdate) window.removeEventListener('rankingsUpdated', onUpdate);
  onUpdate = null;
  const panels = document.querySelector('.trade-builder .tb-panels');
  const owner = document.querySelector('[data-my-ranks][data-league][data-owner]');
  if (!panels || !owner) return;

  let kind = savedKind();
  const bar = document.createElement('div');
  bar.className = 'ui-pills';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'My Rank list');
  bar.style.margin = '0 0 0.75rem';
  const sync = () =>
    bar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  for (const k of KINDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ui-pill';
    b.dataset.kind = k.kind;
    b.textContent = k.label;
    b.addEventListener('click', () => {
      kind = k.kind;
      try {
        localStorage.setItem(KEY, kind);
      } catch {
        /* still switches for this view */
      }
      sync();
      render(kind);
    });
    bar.append(b);
  }
  sync();
  panels.before(bar);

  onUpdate = () => render(kind);
  window.addEventListener('rankingsUpdated', onUpdate);
  render(kind);
}

document.addEventListener('astro:page-load', init);
