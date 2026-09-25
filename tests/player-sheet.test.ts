/**
 * The player sheet's opt-in parts (src/utils/player-sheet.ts).
 *
 * The sheet is shared by ~18 files. The contract that keeps them unaffected is
 * "no opt-in field, no tabs, no new sections" — pinned here as `resolveSheetTabs`
 * returning nothing for every payload shape an existing opener sends, plus the
 * modal wiring that must stay inside its per-init path (ClientRouter).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolveSheetTabs,
  resolveInitialTab,
  nextTabIndex,
  renderQuickActions,
  renderMoreActions,
  renderThisWeek,
  renderSalarySheet,
} from '../src/utils/player-sheet';
import type { SalarySheetData } from '../src/utils/player-modal-trigger';

describe('which tabs a payload gets', () => {
  it('none for every payload that predates tabs', () => {
    expect(resolveSheetTabs({})).toEqual([]);
    // The fields existing openers do send — `salary` is the number the
    // Contract tile reads, NOT the Salary tab.
    expect(resolveSheetTabs({ salary: 5_000_000, contractYears: 3 } as never)).toEqual([]);
    expect(resolveSheetTabs({ tabbed: false })).toEqual([]);
    expect(resolveSheetTabs({ salarySheet: null })).toEqual([]);
  });

  it('Summary / Salary / Game log when the opener sends salary data', () => {
    const salarySheet: SalarySheetData = { tiles: [], years: [], options: [], simulations: [] };
    expect(resolveSheetTabs({ salarySheet })).toEqual(['summary', 'salary', 'gamelog']);
  });

  it('Summary / Game log without salary — the AFL shape (Q4)', () => {
    expect(resolveSheetTabs({ tabbed: true })).toEqual(['summary', 'gamelog']);
  });
});

describe('which tab opens', () => {
  const tabs = ['summary', 'salary', 'gamelog'] as const;
  it('the opener’s choice, reset per open', () => {
    expect(resolveInitialTab([...tabs], 'salary')).toBe('salary');
    expect(resolveInitialTab([...tabs], 'summary')).toBe('summary');
    expect(resolveInitialTab([...tabs])).toBe('summary');
  });
  it('a tab the sheet lacks falls back to the first', () => {
    expect(resolveInitialTab(['summary', 'gamelog'], 'salary')).toBe('summary');
  });
  it('a re-render keeps the tab the viewer is acting in', () => {
    expect(resolveInitialTab([...tabs], 'salary', 'gamelog')).toBe('gamelog');
  });
  it('untabbed → no tab', () => {
    expect(resolveInitialTab([], 'salary')).toBeNull();
  });
});

describe('tablist keys', () => {
  it('wraps with the arrows and jumps with Home / End', () => {
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
  });
});

describe('rendering', () => {
  it('renders nothing when a field is absent', () => {
    expect(renderQuickActions(undefined)).toBe('');
    expect(renderMoreActions([])).toBe('');
    expect(renderThisWeek(null)).toBe('');
    expect(renderSalarySheet(undefined)).toBe('');
  });

  it('escapes the opener’s strings', () => {
    const html = renderQuickActions([{ id: 'x"', label: '<b>', icon: 'icon-eye' }]);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('data-sheet-action="x&quot;"');
  });

  it('a toggle that is on says so to assistive tech', () => {
    expect(renderQuickActions([{ id: 'trade-block', label: 'On trade block', icon: 'icon-bookmark', state: 'on' }]))
      .toContain('aria-pressed="true"');
  });

  it('danger actions carry the danger tone', () => {
    expect(renderMoreActions([{ id: 'release', label: 'Release…', icon: 'icon-user-times', tone: 'danger' }]))
      .toContain('pdm-more__btn--danger');
  });

  it('a bye renders its own message, not an empty grid', () => {
    expect(renderThisWeek({ rows: [], empty: 'Bye week' })).toContain('Bye week');
    expect(renderThisWeek({ rows: [{ label: 'Projected', value: '14.2' }] })).toContain('<dd>14.2</dd>');
  });

  it('the Salary table mirrors the row: eligible TO is a tappable pill, states become classes', () => {
    const html = renderSalarySheet({
      tiles: [{ label: '2026 salary', value: '$5,000,000' }],
      years: [
        { year: '2026', text: '$5,000,000', kind: 'salary', ifCut: '$2,500,000' },
        { year: '2027', text: '$5,500,000', kind: 'salary', escalated: true, simulated: true },
        { year: '2028', text: 'TO', kind: 'to-eligible' },
        { year: '2029', text: '—', kind: 'future-ufa' },
      ],
      ifCutLabel: 'If cut',
      options: [{ id: 'franchise', label: 'Franchise Tag', icon: 'icon-franchise-tag', disabled: true, detail: 'Opens in his final year (2028)' }],
      simulations: [{ id: 'cut-simulate', label: 'Simulate Cut', icon: 'icon-bar-chart', detail: '2026 space $1.98M → $4.48M' }],
    });
    expect(html).toContain('data-sheet-action="team-option"');
    expect(html).toContain('pdm-salyears__amt--simulated');
    expect(html).toContain('+10%');
    expect(html).toContain('<th scope="col">If cut</th>');
    expect(html).toMatch(/data-sheet-action="franchise" disabled/);
    expect(html).toContain('Opens in his final year (2028)');
    expect(html).toContain('Extend or tag');
    expect(html).toContain('Simulate');
  });

  it('no If-cut column when the opener sends no label', () => {
    const html = renderSalarySheet({
      tiles: [], years: [{ year: '2026', text: '$1', kind: 'salary' }], options: [], simulations: [],
    });
    expect(html).not.toContain('pdm-salyears__cut');
  });
});

describe('the modal wiring', () => {
  const modal = readFileSync('src/components/theleague/PlayerDetailsModal.astro', 'utf8');

  it('binds tabs and actions inside the per-init path, not on document', () => {
    const init = modal.slice(modal.indexOf('function initPlayerDetailsModal()'));
    expect(init).toContain("contentEl?.addEventListener('click'");
    expect(init).toContain("btn.addEventListener('keydown'");
    // The only document listeners stay the pre-existing, once-guarded ones.
    expect(modal).not.toMatch(/document\.addEventListener\('click'/);
  });

  it('reads onAction from the payload at click time, never from window', () => {
    expect(modal).toContain('sheetData?.onAction');
    expect(modal).not.toMatch(/window\.\w*onAction/);
  });

  it('tabs are real WAI-ARIA tabs', () => {
    expect(modal).toContain('role="tablist"');
    expect(modal).toMatch(/role="tab"[^>]*aria-controls="pdm-panel-salary"/);
    expect(modal).toContain("panel.setAttribute('role', 'tabpanel')");
  });
});
