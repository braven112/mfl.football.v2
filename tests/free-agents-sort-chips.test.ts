/**
 * The Free Agents phone sort pills (src/utils/free-agents-sort-chips.ts):
 * the roster page's chip row, on every league's Free Agents page.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildFaSortChips, faChipTap, sortSlotPlan, type FaSortHeader } from '../src/utils/free-agents-sort-chips';
import { renderSortChips } from '../src/utils/rosters/phone-sort';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const PAGES = {
  theleague: 'src/pages/theleague/players.astro',
  shared: 'src/components/shared/free-agents/FreeAgentsPage.astro',
} as const;

/** Every `data-sort` key in a page's players thead. */
function theadKeys(src: string): string[] {
  const thead = src.slice(src.indexOf('<table class="ui-table players-table"'), src.indexOf('</thead>'));
  return Array.from(thead.matchAll(/data-sort="([^"]+)"/g), (m) => m[1]!);
}

const h = (key: string, text = key, inView = true): FaSortHeader => ({ key, text, inView });

describe('buildFaSortChips', () => {
  it('offers only the columns in the view on screen', () => {
    const chips = buildFaSortChips([h('name'), h('age'), h('auctionTimeLeft', 'Time Left', false)]);
    expect(chips.map((c) => c.key)).toEqual(['name', 'age']);
  });

  it('leads with Proj · Pts · PPG · ADP, then thead order', () => {
    const chips = buildFaSortChips([h('name'), h('age'), h('adpDyn'), h('seasonPts', '2025 Pts'), h('ppg'), h('projected')]);
    expect(chips.map((c) => c.key)).toEqual(['projected', 'seasonPts', 'ppg', 'adpDyn', 'name', 'age']);
  });

  it('drops the # column and a key repeated across views', () => {
    const chips = buildFaSortChips([h('rank', '#'), h('auctionBid', 'Bid'), h('auctionBid', 'Bid')]);
    expect(chips.map((c) => c.key)).toEqual(['auctionBid']);
  });

  it('names terse headers and keeps the text of unknown ones', () => {
    const chips = buildFaSortChips([h('college', 'C'), h('seasonPts', '2025 Pts'), h('ranking___composite__', 'My Rank')]);
    expect(chips.map((c) => c.label)).toEqual(['2025 Pts', 'College', 'My Rank']);
  });
});

describe('faChipTap — sort, reverse, then back to the default', () => {
  it('a new chip sorts by its header', () => {
    expect(faChipTap('ppg', 'projected', { key: null, taps: 0 })).toEqual({ action: 'header', next: { key: 'ppg', taps: 1 } });
  });

  it('the second tap reverses, the third resets', () => {
    const second = faChipTap('ppg', 'ppg', { key: 'ppg', taps: 1 });
    expect(second).toEqual({ action: 'header', next: { key: 'ppg', taps: 2 } });
    expect(faChipTap('ppg', 'ppg', second.next).action).toBe('reset');
  });

  it('a sort that arrived another way counts as one tap', () => {
    // The page opened sorted by Proj: one tap reverses, the next resets.
    const first = faChipTap('projected', 'projected', { key: null, taps: 0 });
    expect(first.action).toBe('header');
    expect(faChipTap('projected', 'projected', first.next).action).toBe('reset');
  });
});

describe('sortSlotPlan — the sorted column is always on screen (user, 2026-10-21)', () => {
  const base = { phone: true, activeKey: 'weight', inView: true, hiddenOnPhone: true, projShown: true };

  it('a column the phone hides swaps into the Proj spot', () => {
    expect(sortSlotPlan(base)).toBe('swap');
  });

  it('a view with no Proj on the phone reveals the column instead', () => {
    expect(sortSlotPlan({ ...base, projShown: false })).toBe('reveal');
  });

  it('leaves the row alone when it already shows the sort, on desktop, or with no sort', () => {
    expect(sortSlotPlan({ ...base, hiddenOnPhone: false })).toBe('none');
    expect(sortSlotPlan({ ...base, phone: false })).toBe('none');
    expect(sortSlotPlan({ ...base, activeKey: null })).toBe('none');
    expect(sortSlotPlan({ ...base, activeKey: 'projected' })).toBe('none');
    // A sort by a column of another view (My Rank in Stats) has nowhere to go.
    expect(sortSlotPlan({ ...base, inView: false })).toBe('none');
  });

  it('the swapped header wears the sort label, on a phone only', () => {
    const css = read('src/styles/free-agents-mobile.css');
    const phone = css.slice(css.lastIndexOf('@media (max-width: 767px)'));
    expect(phone).toMatch(/th\[data-fa-slot\] > \.th-content \{\s*display: none;/);
    expect(phone).toMatch(/th\[data-fa-slot\]::after \{\s*content: attr\(data-fa-slot\);/);
  });
});

describe('every league\'s Free Agents page carries the pills', () => {
  for (const [name, file] of Object.entries(PAGES)) {
    const src = read(file);
    it(`${name}: renders the row above the table and wires it`, () => {
      expect(src).toMatch(/<div class="rr-chips fa-sort-chips">\s*<div class="rr-chips__row" role="group" aria-label="Sort players by" data-fa-sort-chips><\/div>/);
      expect(src.indexOf('data-fa-sort-chips')).toBeLessThan(src.indexOf('<table class="ui-table players-table"'));
      expect(src).toMatch(/import \{ initFaSortChips \} from '[./]+\/utils\/free-agents-sort-chips';/);
      expect(src).toContain("document.addEventListener('astro:page-load', initFaSortChips);");
      expect(src).toMatch(/import '[./]+\/styles\/sort-chips\.css';/);
    });

    it(`${name}: every column a phone hides has a chip`, () => {
      const keys = theadKeys(src);
      expect(keys.length).toBeGreaterThan(8);
      const chips = buildFaSortChips(keys.map((k) => h(k))).map((c) => c.key);
      for (const k of keys) if (k !== 'rank') expect(chips, `${k} has no chip`).toContain(k);
    });

    it(`${name}: the third tap restores the page's default through its own bus`, () => {
      // free-agents-sort-chips.ts resets with `rankings:set-sort` { key: null };
      // the page must still read a null key as "restore my default".
      expect(src).toMatch(/addEventListener\('rankings:set-sort'[\s\S]{0,400}e\.detail\.key == null/);
      expect(src).toContain("document.addEventListener('rankings:refresh-table'");
    });
  }

  it('both rosters pages load the shared pill styles', () => {
    expect(read('src/pages/theleague/rosters.astro')).toContain("import '../../styles/sort-chips.css';");
    expect(read('src/components/shared/rosters/RostersPage.astro')).toContain("import '../../../styles/sort-chips.css';");
  });

  it('the pills are hidden on desktop and scroll sideways on a phone', () => {
    const fa = read('src/styles/free-agents-mobile.css');
    expect(fa).toMatch(/^\.rr-chips\.fa-sort-chips \{\s*display: none;/m);
    const chips = read('src/styles/sort-chips.css');
    expect(chips).toMatch(/\.rr-chips__row \{[^}]*overflow-x: auto;/);
    // The absolute sr-only text must anchor to its chip, inside the scroller,
    // or an active chip at the row's edge widens the page (user, 2026-10-21).
    expect(chips).toMatch(/\.rr-chip \{\s*position: relative;/);
  });

  it('renders the roster page\'s chip markup', () => {
    const html = renderSortChips(buildFaSortChips([h('projected', 'Proj')]), { key: 'projected', dir: 'desc' });
    expect(html).toContain('class="rr-chip rr-chip--on" data-rr-chip="projected" aria-pressed="true"');
  });
});
