/**
 * The AFL's phone roster (docs/plans/rosters-mobile-layout.md § 8): the card
 * reads like TheLeague's Coach card, and the player sheet hands every roster
 * move to AFLActionModal rather than growing a second implementation.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildPhoneLineSpans, teamSpread } from '../src/utils/rosters/phone-row';
import { recentScoreAverage } from '../src/utils/afl-player-scoring';
import {
  AFL_SHEET_ACTION_IDS,
  buildAflMoreActions,
  buildAflQuickActions,
  createAflSheetActionHandler,
} from '../src/utils/rosters/afl-phone-sheet';
import type { SheetActionApi } from '../src/utils/player-modal-trigger';

const page = readFileSync('src/pages/afl-fantasy/rosters.astro', 'utf8');
const css = readFileSync('src/styles/rosters-mobile.css', 'utf8');
const modal = readFileSync('src/components/afl-fantasy/AFLActionModal.astro', 'utf8');

describe('teamSpread signs the line the way TheLeague’s badge does', () => {
  it('favoured team reads +, the underdog -', () => {
    expect(teamSpread('KC -3.5', 'KC')).toEqual({ text: '+3.5', tone: 'fav' });
    expect(teamSpread('KC -3.5', 'BUF')).toEqual({ text: '-3.5', tone: 'dog' });
  });

  it('normalises both codes (ESPN WSH vs MFL WAS)', () => {
    const norm = (c: string) => (c === 'WSH' ? 'WAS' : c);
    expect(teamSpread('WSH -2.5', 'WAS', norm)?.tone).toBe('fav');
  });

  it('prints nothing for a pick’em, an unpriced game or junk', () => {
    expect(teamSpread('KC 0', 'KC')).toBeNull();
    expect(teamSpread('', 'KC')).toBeNull();
    expect(teamSpread('N/A', 'KC')).toBeNull();
    expect(teamSpread('KC -3.5', '')).toBeNull();
  });
});

describe('the AFL line-3 spans', () => {
  it('carry no text (the desktop table cannot change)', () => {
    const html = buildPhoneLineSpans({
      spread: { text: '+3.5', tone: 'fav' },
      lastThree: '14.2',
      weather: '72° ☀️',
      overUnder: '47.5',
    });
    expect(html.replace(/<[^>]+>/g, '')).toBe('');
    expect(html).toContain('class="rr-ph rr-ph--spread rr-ph--fav" data-t="+3.5"');
    expect(html).toContain('rr-ph--l3" data-t="14.2"');
    expect(html).toContain('rr-ph--wx" data-t="72° ☀️"');
    expect(html).toContain('rr-ph--ou" data-t="47.5"');
  });

  it('TheLeague’s rows (which send none of them) are unchanged', () => {
    const html = buildPhoneLineSpans({ opponent: 'buf' });
    expect(html).not.toMatch(/rr-ph--(spread|l3|wx|ou)/);
  });
});

describe('recentScoreAverage', () => {
  it('averages the three most recent scored weeks, zeros included', () => {
    const scores = new Map([['1', { 1: 30, 2: 10, 3: 0, 4: 20 } as Record<number, number>]]);
    expect(recentScoreAverage(scores as any, '1')).toBe(10);
    expect(recentScoreAverage(scores as any, 'nobody')).toBeNull();
  });
});

describe('the AFL sheet offers AFLActionModal’s own actions', () => {
  const owner = { isOwner: true, status: 'ROSTER', onTradeBait: false };

  it('owner: trade block + a ⋮ menu of roster moves', () => {
    const quick = buildAflQuickActions(owner);
    expect(quick.map((a) => a.id)).toEqual(['trade-bait-add', 'player-menu']);
    expect(quick[1].menu?.map((a) => a.id)).toEqual(['ir-to', 'trade', 'cut']);
    expect(buildAflQuickActions({ ...owner, onTradeBait: true })[0]).toMatchObject({ id: 'trade-bait-remove', state: 'on' });
    expect(buildAflMoreActions({ ...owner, status: 'INJURED_RESERVE' })[0].id).toBe('ir-from');
  });

  it('a non-owner gets no writes (Watch is the sheet’s own)', () => {
    expect(buildAflQuickActions({ ...owner, isOwner: false })).toEqual([]);
    expect(buildAflMoreActions({ ...owner, isOwner: false })).toEqual([]);
  });

  it('every id it can offer is one the modal knows', () => {
    const union = /type ModalAction = ([^;]+);/.exec(modal)?.[1] ?? '';
    for (const id of AFL_SHEET_ACTION_IDS) expect(union, id).toContain(`'${id}'`);
  });

  it('routes by closing the sheet and opening the modal on that action', () => {
    const open = vi.fn();
    const sheet = { close: vi.fn(), rerender: vi.fn(), announce: vi.fn() } as unknown as SheetActionApi;
    const handle = createAflSheetActionHandler(open);
    handle('cut', sheet);
    expect(sheet.close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('cut');
    open.mockClear();
    handle('player-menu', sheet);
    expect(open).not.toHaveBeenCalled();
  });

  it('the modal opens on a handed-off action only when it is shown to the viewer', () => {
    expect(modal).toMatch(/const direct = payload\.action;\s*if \(direct && direct !== 'watch' && actionButtons\[direct\] && !actionButtons\[direct\]\.hidden\)/);
  });
});

describe('the page wiring', () => {
  it('opens the sheet from the whole row on a phone, with the AFL payload', () => {
    expect(page).toMatch(/initPlayerModalTrigger\(pageRoot, \{\s*rowTapMedia: '\(max-width: 767px\)',\s*enrich:/);
    expect(page).toContain('buildAflSheetFields(row,');
  });

  it('imports the shared phone stylesheet from the frontmatter', () => {
    const frontmatter = page.split('\n---')[0];
    expect(frontmatter).toContain("import '../../styles/rosters-mobile.css';");
  });

  it('names the AFL table beside TheLeague’s in the card rules, not in a copy', () => {
    expect(css).toContain(".roster-page[data-league='afl-fantasy'] .roster-table--afl > tbody > tr.roster-row,\n  .roster-page[data-league='theleague'] #rosterTableBody > tr.roster-row {");
    expect(css).toContain(".roster-page[data-league='afl-fantasy'],\n  .roster-page[data-league='theleague'] {\n    grid-template-columns: minmax(0, 1fr);");
  });
});
