/**
 * Player sheet — the opt-in, opener-driven parts of PlayerDetailsModal.
 *
 * The modal is shared by ~18 files. Everything here renders ONLY from optional
 * `PlayerModalData` fields (tabs, the Salary tab, This week, quick and more
 * actions, My Rank), so an opener that sends none of them gets the sheet it has
 * always had. docs/plans/rosters-mobile-layout.md § 4 is the design.
 *
 * Pure string builders on purpose: the modal's client script owns the DOM and
 * the listeners; this module owns what the markup IS, and is unit-tested
 * (tests/player-sheet.test.ts) without a browser. Every interpolated value goes
 * through `escapeHtml` — labels and costs are the opener's data, and player /
 * franchise names come straight from MFL.
 *
 * The sheet holds no cap math and no league knowledge. Costs and previews
 * arrive pre-formatted from the opener (src/utils/rosters/phone-sheet.ts for
 * TheLeague), so the AFL can reuse the tabs without a Salary tab.
 */

import { escapeHtml } from './player-cell-html';
import type {
  PlayerModalData,
  SalarySheetData,
  SalarySheetOption,
  SheetAction,
  SheetTabId,
  ThisWeekData,
} from './player-modal-trigger';

const SPRITE = '/assets/icons/sprite.svg';

export const SHEET_TAB_LABELS: Record<SheetTabId, string> = {
  summary: 'Summary',
  salary: 'Salary',
  gamelog: 'Game log',
};

/**
 * The tab set for one open. Empty → the sheet is untabbed (every opener that
 * predates tabs). `salarySheet` implies tabs; `tabbed` alone asks for Summary
 * and Game log, which is the AFL's shape (user decision Q4).
 */
export function resolveSheetTabs(data: Pick<PlayerModalData, 'tabbed' | 'salarySheet'>): SheetTabId[] {
  const hasSalary = !!data.salarySheet;
  if (!hasSalary && data.tabbed !== true) return [];
  return hasSalary ? ['summary', 'salary', 'gamelog'] : ['summary', 'gamelog'];
}

/**
 * Which tab to show. The opener's choice when it names a tab the sheet has,
 * else the first. `current` (a re-render after a simulation) wins over both,
 * so the viewer is not bounced off the tab they are acting in.
 */
export function resolveInitialTab(
  tabs: SheetTabId[],
  requested?: SheetTabId | null,
  current?: SheetTabId | null,
): SheetTabId | null {
  if (!tabs.length) return null;
  if (current && tabs.includes(current)) return current;
  if (requested && tabs.includes(requested)) return requested;
  return tabs[0];
}

/**
 * Roving-tabindex arithmetic for the tablist: Left/Right wrap, Home/End jump.
 * Returns null for keys the tablist does not handle.
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

function icon(id: string, cls: string): string {
  return `<span class="${cls}" aria-hidden="true"><svg aria-hidden="true"><use href="${SPRITE}#${escapeHtml(id)}"></use></svg></span>`;
}

/**
 * The quick-action buttons. Rendered into the modal's existing action row
 * beside the built-in Watch / Trade-for-him cards, so Watch is never offered
 * twice (the opener does not send one).
 */
export function renderQuickActions(actions: SheetAction[] | null | undefined): string {
  if (!actions?.length) return '';
  return actions
    .map((a) => {
      const cls = [
        'pdm-quick__btn',
        a.state === 'on' ? 'pdm-quick__btn--on' : '',
        a.tone === 'danger' ? 'pdm-quick__btn--danger' : '',
      ].filter(Boolean).join(' ');
      const pressed = a.state === 'on' ? ' aria-pressed="true"' : '';
      const disabled = a.disabled ? ' disabled' : '';
      const title = a.desc ? ` title="${escapeHtml(a.desc)}"` : '';
      return `<button type="button" class="${cls}" data-sheet-action="${escapeHtml(a.id)}"${pressed}${disabled}${title}>`
        + icon(a.icon, 'pdm-quick__icon')
        + `<span class="pdm-quick__label">${escapeHtml(a.label)}</span>`
        + '</button>';
    })
    .join('');
}

/** Summary › More actions: one full-width row per action. */
export function renderMoreActions(actions: SheetAction[] | null | undefined): string {
  if (!actions?.length) return '';
  return '<ul class="pdm-more__list">'
    + actions
      .map((a) => {
        const cls = ['pdm-more__btn', a.tone === 'danger' ? 'pdm-more__btn--danger' : ''].filter(Boolean).join(' ');
        return `<li><button type="button" class="${cls}" data-sheet-action="${escapeHtml(a.id)}"${a.disabled ? ' disabled' : ''}>`
          + icon(a.icon, 'pdm-more__icon')
          + '<span class="pdm-more__text">'
          + `<span class="pdm-more__label">${escapeHtml(a.label)}</span>`
          + (a.desc ? `<span class="pdm-more__desc">${escapeHtml(a.desc)}</span>` : '')
          + '</span></button></li>';
      })
      .join('')
    + '</ul>';
}

/** Summary › This week. */
export function renderThisWeek(week: ThisWeekData | null | undefined): string {
  if (!week) return '';
  if (!week.rows.length) {
    return `<p class="pdm-week__empty">${escapeHtml(week.empty || 'No game this week.')}</p>`;
  }
  return '<dl class="pdm-week__grid">'
    + week.rows
      .map((r) => `<div class="pdm-week__item"><dt>${escapeHtml(r.label)}</dt><dd>${escapeHtml(r.value)}</dd></div>`)
      .join('')
    + '</dl>';
}

function renderSalaryOption(o: SalarySheetOption, kind: 'option' | 'sim'): string {
  const cls = [
    'pdm-salopt',
    `pdm-salopt--${kind}`,
    o.state === 'on' ? 'pdm-salopt--on' : '',
  ].filter(Boolean).join(' ');
  const pressed = o.state === 'on' ? ' aria-pressed="true"' : '';
  return `<li><button type="button" class="${cls}" data-sheet-action="${escapeHtml(o.id)}"${o.disabled ? ' disabled' : ''}${pressed}>`
    + icon(o.icon, 'pdm-salopt__icon')
    + '<span class="pdm-salopt__text">'
    + `<span class="pdm-salopt__label">${escapeHtml(o.label)}</span>`
    + (o.cost ? `<span class="pdm-salopt__cost">${escapeHtml(o.cost)}</span>` : '')
    + (o.detail ? `<span class="pdm-salopt__detail">${escapeHtml(o.detail)}</span>` : '')
    + '</span></button></li>';
}

/**
 * The Salary tab's body. The year table's cells are the ROW's cells, lifted,
 * so their state classes mirror the row's (`--simulated`, `--declared`, …) and
 * an eligible Team Option is the same tappable pill it is in the row.
 */
export function renderSalarySheet(s: SalarySheetData | null | undefined): string {
  if (!s) return '';
  const tiles = s.tiles.length
    ? '<dl class="pdm-saltiles">'
      + s.tiles
        .map((t) => `<div class="pdm-saltile"><dt class="pdm-saltile__label">${escapeHtml(t.label)}</dt><dd class="pdm-saltile__value">${escapeHtml(t.value)}</dd></div>`)
        .join('')
      + '</dl>'
    : '';

  const showIfCut = !!s.ifCutLabel;
  const rows = s.years
    .map((y) => {
      const cellCls = [
        'pdm-salyears__amt',
        `pdm-salyears__amt--${y.kind}`,
        y.declared ? 'pdm-salyears__amt--declared' : '',
        y.simulated ? 'pdm-salyears__amt--simulated' : '',
      ].filter(Boolean).join(' ');
      let amount: string;
      if (y.kind === 'to-eligible') {
        amount = `<button type="button" class="pdm-salyears__to" data-sheet-action="team-option" aria-label="Team option available for ${escapeHtml(y.year)} — review it">TO</button>`;
      } else {
        amount = escapeHtml(y.text);
      }
      const notes: string[] = [];
      if (y.escalated) notes.push('<span class="pdm-salyears__note">+10%</span>');
      if (y.simulated) notes.push('<span class="pdm-salyears__note pdm-salyears__note--sim">simulated</span>');
      if (y.declared) notes.push('<span class="pdm-salyears__note">declared</span>');
      if (y.kind === 'to-expired') notes.push('<span class="pdm-salyears__note">option forfeited</span>');
      const ifCut = showIfCut ? `<td class="pdm-salyears__cut">${escapeHtml(y.ifCut || '—')}</td>` : '';
      return `<tr><th scope="row" class="pdm-salyears__year">${escapeHtml(y.year)}</th>`
        + `<td class="${cellCls}">${amount}${notes.length ? ' ' + notes.join(' ') : ''}</td>`
        + ifCut
        + '</tr>';
    })
    .join('');
  const table = s.years.length
    ? '<div class="pdm-salyears__wrap"><table class="pdm-salyears">'
      + '<caption class="visually-hidden">Salary by year</caption>'
      + '<thead><tr><th scope="col">Year</th><th scope="col">Salary</th>'
      + (showIfCut ? `<th scope="col">${escapeHtml(s.ifCutLabel)}</th>` : '')
      + '</tr></thead>'
      + `<tbody>${rows}</tbody></table></div>`
    : '';

  const options = s.options.length
    ? '<h4 class="pdm-subhead">Extend or tag</h4>'
      + `<ul class="pdm-salopts">${s.options.map((o) => renderSalaryOption(o, 'option')).join('')}</ul>`
    : '';
  const sims = s.simulations.length
    ? '<h4 class="pdm-subhead">Simulate</h4>'
      + (s.simulated ? `<p class="pdm-salsim-state">${escapeHtml(s.simulated)}</p>` : '')
      + `<ul class="pdm-salopts">${s.simulations.map((o) => renderSalaryOption(o, 'sim')).join('')}</ul>`
    : '';

  return tiles + table + options + sims;
}
