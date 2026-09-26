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
  nextMenuIndex,
  placeSheetMenu,
  SHEET_MENU_GUTTER,
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

describe('kebab menu keys', () => {
  it('Down / Up wrap, Home / End jump, and nothing focused starts at an end', () => {
    expect(nextMenuIndex('ArrowDown', -1, 4)).toBe(0);
    expect(nextMenuIndex('ArrowUp', -1, 4)).toBe(3);
    expect(nextMenuIndex('ArrowDown', 3, 4)).toBe(0);
    expect(nextMenuIndex('ArrowUp', 0, 4)).toBe(3);
    expect(nextMenuIndex('Home', 2, 4)).toBe(0);
    expect(nextMenuIndex('End', 0, 4)).toBe(3);
    expect(nextMenuIndex('ArrowRight', 0, 4)).toBeNull();
    expect(nextMenuIndex('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('the kebab (a quick action with a menu)', () => {
  const kebab = {
    id: 'contract-menu', label: 'Contract options', icon: 'icon-menu',
    menu: [
      { id: 'extension', label: 'Veteran Extension', desc: 'Extend contract 1–2 years', icon: 'icon-coin' },
      { id: 'autocut-toggle', label: 'Mark for August auto-cut', icon: 'icon-clipboard', disabled: true },
      { id: 'release', label: 'Release…', icon: 'icon-user-times', tone: 'danger' as const },
    ],
  };
  const html = renderQuickActions([kebab], 'Lamar Jackson');

  it('is a menu button named for the player, collapsed, pointing at its menu', () => {
    expect(html).toMatch(/<button[^>]*data-sheet-menu="contract-menu"[^>]*aria-haspopup="menu" aria-expanded="false" aria-controls="pdm-kebab-menu"[^>]*aria-label="Contract options for Lamar Jackson"/);
    expect(html).toMatch(/<ul[^>]*id="pdm-kebab-menu" role="menu"[^>]*hidden>/);
  });

  it('the button does not act — only its items carry data-sheet-action', () => {
    const button = html.slice(0, html.indexOf('</button>'));
    expect(button).not.toContain('data-sheet-action');
    expect(html).toContain('role="menuitem" tabindex="-1" class="pdm-kebab__item" data-sheet-action="extension"');
  });

  it('disabled and danger items keep their state', () => {
    expect(html).toMatch(/data-sheet-action="autocut-toggle" disabled/);
    expect(html).toContain('pdm-kebab__item--danger');
  });

  it('escapes the subject', () => {
    expect(renderQuickActions([kebab], '<i>x</i>')).not.toContain('<i>x</i>');
  });
});

describe('the kebab menu stays on screen (placeSheetMenu)', () => {
  // The ⋮ sat near the START of the hero row and the menu was right-aligned
  // to it, so on a phone it ran off the left edge (user, 2026-09-26).
  // The sheet on a phone is full-bleed with ~16px padding; the ⋮ is the
  // second 44px circle in the row.
  const MENU = 256; // 16rem, the menu's min-width
  const phone = (vw: number, anchorLeft: number, menuWidth = MENU) => {
    const p = placeSheetMenu({
      anchorLeft, anchorRight: anchorLeft + 44, menuWidth, boundsLeft: 0, boundsRight: vw,
    });
    return { ...p, x: anchorLeft + p.left, right: anchorLeft + p.left + p.width };
  };

  for (const vw of [320, 360, 390, 767]) {
    it(`never leaves a ${vw}px viewport, wherever the ⋮ sits`, () => {
      for (let a = 16; a <= vw - 60; a += 7) {
        const m = phone(vw, a);
        expect(m.x).toBeGreaterThanOrEqual(SHEET_MENU_GUTTER);
        expect(m.right).toBeLessThanOrEqual(vw - SHEET_MENU_GUTTER);
        expect(m.width).toBeGreaterThan(0);
      }
    });
  }

  it('opens from the ⋮’s left edge, extending right, when it fits', () => {
    expect(phone(390, 76)).toMatchObject({ left: 0, width: MENU });
  });

  it('right-aligns to the ⋮ when extending right would overflow', () => {
    const m = phone(390, 330);
    expect(m.right).toBe(374);
    expect(m.width).toBe(MENU);
  });

  it('shrinks a menu wider than the room it has', () => {
    const m = phone(320, 60, 400);
    expect(m).toMatchObject({ x: SHEET_MENU_GUTTER, width: 320 - 2 * SHEET_MENU_GUTTER });
  });

  it('stays inside a centred desktop sheet, not just the viewport', () => {
    const p = placeSheetMenu({ anchorLeft: 900, anchorRight: 944, menuWidth: 320, boundsLeft: 400, boundsRight: 960 });
    expect(900 + p.left).toBeGreaterThanOrEqual(412);
    expect(900 + p.left + p.width).toBeLessThanOrEqual(948);
  });

  it('the modal measures on open, and the CSS fallback opens rightwards', () => {
    const modal = readFileSync('src/components/theleague/PlayerDetailsModal.astro', 'utf8');
    const open = modal.slice(modal.indexOf('const openSheetMenu'), modal.indexOf('const closeSheetMenu'));
    expect(open).toMatch(/list\.hidden = false;\s*positionSheetMenu\(btn, list\);/);
    const rule = modal.slice(modal.indexOf('.pdm-quick :global(.pdm-kebab__menu) {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/left: 0;/);
    expect(body).not.toMatch(/(^|[^-])right: 0;/m);
    expect(body).toMatch(/max-width: min\([^;]*100vw/);
  });

  it('re-measures when the hero row reflows under an open menu', () => {
    // Watch and "Trade for him" repaint when their server context lands, after
    // the menu may already be open — it once sat where the ⋮ used to be.
    const modal = readFileSync('src/components/theleague/PlayerDetailsModal.astro', 'utf8');
    const paintBody = (name: string) => {
      const from = modal.indexOf(`const ${name} = () => {`);
      return modal.slice(from, modal.indexOf('\n    };', from));
    };
    expect(paintBody('paintWatch')).toContain('repositionOpenSheetMenu();');
    expect(paintBody('paintClaim')).toContain('repositionOpenSheetMenu();');
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

  it('is a named modal dialog that takes focus, keeps Tab inside, and hands focus back', () => {
    // Every opener, tabbed or not (user, 2026-09-26): a screen reader hears a
    // dialog named for the player, and Tab cannot walk into the page behind.
    expect(modal).toMatch(/class="player-details-modal__content" role="dialog" aria-modal="true" aria-labelledby="detail-name" tabindex="-1"/);
    expect(modal).toContain("const opener = document.activeElement as HTMLElement | null;");
    expect(modal).toContain("?.focus({ preventScroll: true })");
    expect(modal).toMatch(/e\.key === 'Tab' && activeModal\?\.classList\.contains\('active'\)/);
    expect(modal).toContain('restoreSheetFocus();');
  });

  it('the kebab closes on Esc WITHOUT closing the sheet, and gives focus back', () => {
    const init = modal.slice(modal.indexOf('function initPlayerDetailsModal()'));
    expect(init).toContain("contentEl?.addEventListener('keydown'");
    expect(init).toMatch(/e\.key === 'Escape' && sheetMenuOpen\(\)\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*closeSheetMenu\(true\);/);
    expect(init).toContain("btn.setAttribute('aria-expanded', 'true')");
  });

  it('tabs are real WAI-ARIA tabs', () => {
    expect(modal).toContain('role="tablist"');
    expect(modal).toMatch(/role="tab"[^>]*aria-controls="pdm-panel-salary"/);
    expect(modal).toContain("panel.setAttribute('role', 'tabpanel')");
  });
});
