import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_RANKING_COLUMNS,
  visibleRankingColumns,
} from '../src/utils/rankings-table';
import type { RankingColumn } from '../src/utils/rankings-lookup';

/**
 * The rankings display surfaces, pinned against the drift that keeps happening.
 *
 * `theleague/players.astro` / `afl-fantasy/players.astro` and the two
 * `lineup.astro` pages are near-identical siblings. A rankings change landing
 * in one and not the other is a recurring bug class here — it is exactly how
 * the AFL ended up with six loaded sources and no way to see them on the pages
 * an owner drafts and sets a lineup from.
 *
 * These tests don't check rendering. They check that each page still goes
 * through the SHARED module, because that is what makes a fix reach both.
 */

const read = (p: string) => readFileSync(p, 'utf8');

const FREE_AGENT_PAGES = [
  'src/pages/theleague/players.astro',
  'src/pages/afl-fantasy/players.astro',
];

const ROSTER_PAGES = [
  'src/pages/theleague/rosters.astro',
  'src/pages/afl-fantasy/rosters.astro',
];

const LINEUP_PAGES = ['src/pages/theleague/lineup.astro', 'src/pages/afl-fantasy/lineup.astro'];

describe('rankings reach every decision page', () => {
  describe('Free Agents', () => {
    it.each(FREE_AGENT_PAGES)('%s injects ranking columns via the shared module', (page) => {
      const src = read(page);
      expect(src).toContain("from '../../utils/rankings-table'");
      expect(src).toContain('initRankingTable(');
    });

    it.each(FREE_AGENT_PAGES)('%s answers the module over CustomEvents', (page) => {
      const src = read(page);
      // The inline table script is a classic (define:vars) script and cannot
      // import — this event pair is the entire bridge. Drop either half and the
      // columns render with no data behind them.
      for (const event of [
        'rankings:page-ready',
        'rankings:set-lookup',
        'rankings:get-sort',
        'rankings:set-sort',
        'rankings:refresh-table',
        'rankings:refilter',
      ]) {
        expect(src, `${page} is missing ${event}`).toContain(event);
      }
    });

    it.each(FREE_AGENT_PAGES)('%s lets the shared module pick the columns', (page) => {
      // Which ranking columns show is one rule for both leagues (the owner's
      // composite, capped). A page passing its own budget is how the two
      // tables drifted apart the first time.
      expect(read(page)).not.toContain('maxColumns');
    });

    it.each(FREE_AGENT_PAGES)('%s ignores bridge events once its own table is detached', (page) => {
      // After a ClientRouter swap the previous page's inline script is still
      // alive and still answers these document-level events — measured: two
      // handlers responded to rankings:get-sort on the AFL page after
      // navigating from TheLeague's. Both pages use the same element ids, so a
      // stale handler otherwise reads or repaints the live page.
      const src = read(page);
      expect(src).toContain("const OWN_TABLE = document.getElementById('players-table')");
      expect(src).toContain('OWN_TABLE.isConnected');
      // Every bridge handler must be guarded, not just some of them.
      const guards = src.match(/if \(!isLivePage\(\)\) return;/g) ?? [];
      expect(guards.length).toBeGreaterThanOrEqual(5);
    });

    it.each(FREE_AGENT_PAGES)('%s restores its own sort when the last ranking column goes', (page) => {
      // Hiding the last ranking source used to leave the table ordered by a
      // column that no longer exists, with no header left to click.
      expect(read(page)).toContain('e.detail.key == null');
    });

    it.each(FREE_AGENT_PAGES)('%s styles its injected ranking headers globally', (page) => {
      // The ranking <th>s are created in JS, so they never carry the page's
      // Astro scope class and every scoped `th` rule misses them — including
      // `white-space: nowrap`, which is why "My Rank" and "FBG ®" wrapped onto
      // two lines while every static header stayed on one. The fix has to be
      // global CSS; a scoped rule silently does nothing here.
      expect(read(page)).toContain("import '../../styles/ranking-columns.css'");
    });

    it('the injected-header stylesheet keeps ranking titles on one line', () => {
      const css = read('src/styles/ranking-columns.css');
      const block = css.slice(css.indexOf('th[data-ranking-col] {'));
      expect(block.slice(0, block.indexOf('}'))).toMatch(/white-space:\s*nowrap/);
      // Scoping it would put it back out of reach of the very elements it targets.
      expect(css).not.toContain(':global(');
    });

    it.each(FREE_AGENT_PAGES)('%s re-applies column visibility after render', (page) => {
      // render() rebuilds tbody with innerHTML, which wipes every inline
      // display style. Without this call the hidden group reappears on any
      // sort, filter or "load more".
      const src = read(page);
      expect(src).toContain('applyGroupVisibility()');
    });
  });

  describe('Rosters', () => {
    it.each(ROSTER_PAGES)('%s fills its Rank column via the shared module', (page) => {
      const src = read(page);
      expect(src).toContain("from '../../utils/rankings-roster-column'");
      expect(src).toContain('initRosterRankColumn(');
    });

    it('the roster module does nothing when its own rows are absent', () => {
      // Same ClientRouter hazard: a stale instance from the other league still
      // answers astro:page-load, and both leagues use `.ranking-col`.
      const src = read('src/utils/rankings-roster-column.ts');
      expect(src).toContain('if (!document.querySelector(options.rowsSelector)) return lookup;');
    });

    it('TheLeague scopes its column selector away from the AFL table', () => {
      const src = read('src/pages/theleague/rosters.astro');
      expect(src).not.toMatch(/columnSelector:\s*'\.ranking-col'/);
      expect(src).toContain(".roster-table:not(.roster-table--afl) .ranking-col");
    });

    it.each(ROSTER_PAGES)('%s has a rank cell for the module to fill', (page) => {
      const src = read(page);
      expect(src).toContain('ranking-cell');
    });
  });

  describe('Set Lineup', () => {
    it.each(LINEUP_PAGES)('%s reads the owner board via the shared module', (page) => {
      const src = read(page);
      expect(src).toContain("from '../../utils/lineup-rankings'");
      expect(src).toContain('loadLineupRankings()');
    });

    it.each(LINEUP_PAGES)('%s shows a rank per candidate and re-sorts by it', (page) => {
      const src = read(page);
      // The candidate list is the decision surface — a rank that only appears
      // on the current starter is not the feature.
      expect(src).toContain('cdm-td--rank');
      expect(src).toContain('cdm-th--rank');
      expect(src).toContain('byRank(rankings)');
    });

    it.each(LINEUP_PAGES)('%s puts a rank chip on the starters AND the bench', (page) => {
      const src = read(page);
      // The replacement sheet alone was not discoverable: an owner scanning
      // their lineup has no reason to tap a slot they weren't already
      // suspicious of, so a rank only behind a tap is a rank never seen.
      expect(src).toContain('applyRankChips(');
      expect(src).toContain(".lineup-slot[data-player-id]");
      expect(src).toContain(".lineup-bench-row[data-player-id]");
    });

    it.each(LINEUP_PAGES)('%s re-hangs chips from one place, not per caller', (page) => {
      const src = read(page);
      // Six different paths rewrite a slot's innerHTML and destroy its chip.
      // The wrapper is what keeps the seventh from being missed.
      expect(src).toContain('renderSlotCardBody(slotIndex);');
      expect(src).toContain('refreshRankChips();');
    });

    it.each(LINEUP_PAGES)('%s degrades to no column when there is no board', (page) => {
      const src = read(page);
      // Every rank surface is gated on `rankings.available`, so an owner who
      // has imported nothing sees no empty column and no dead toggle.
      expect(src).toContain('rankings.available');
    });
  });

  describe('which ranking columns the table shows', () => {
    const col = (over: Partial<RankingColumn>): RankingColumn => ({
      importId: over.importId ?? 'x',
      source: 'custom',
      type: 'overall',
      header: over.importId ?? 'x',
      fullName: over.importId ?? 'x',
      playerCount: 10,
      importDate: '2026-08-21',
      ...over,
    });

    const composite = col({ importId: '__composite__', isComposite: true });
    const average = col({ importId: '__average__', isAverage: true });
    const members = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) =>
      col({ importId: id, isCompositeMember: true }),
    );
    const others = ['o1', 'o2'].map((id) => col({ importId: id }));

    it('drops the Average column', () => {
      // Average is the unweighted mean of EVERY import — including the ones
      // the owner deliberately left out of their composite, which makes it a
      // second opinion contradicting the one they built on purpose.
      const out = visibleRankingColumns([composite, average, ...members.slice(0, 2)]);
      expect(out.some((c) => c.isAverage)).toBe(false);
    });

    it('shows only My Rank and the sources feeding it', () => {
      const out = visibleRankingColumns([composite, ...members.slice(0, 2), ...others]);
      expect(out.map((c) => c.importId)).toEqual(['__composite__', 'm1', 'm2']);
    });

    it(`never shows more than ${MAX_RANKING_COLUMNS} columns`, () => {
      const out = visibleRankingColumns([composite, ...members]);
      expect(out).toHaveLength(MAX_RANKING_COLUMNS);
      // My Rank always takes one of the slots — it is the whole point.
      expect(out[0].isComposite).toBe(true);
    });

    it('falls back to the raw imports when there is no composite', () => {
      // An owner who unticked everything should still see their boards rather
      // than a table that silently lost its ranking columns.
      const out = visibleRankingColumns([average, ...others]);
      expect(out.map((c) => c.importId)).toEqual(['o1', 'o2']);
    });

    it('drops the member separator, which has nothing left to separate', () => {
      const last = col({ importId: 'm2', isCompositeMember: true, isLastCompositeMember: true });
      const out = visibleRankingColumns([composite, members[0], last]);
      expect(out.some((c) => c.isLastCompositeMember)).toBe(false);
    });
  });

  describe('My Rank editor', () => {
    // Re-weighting the composite used to mean leaving the page for Import
    // Rankings and coming back. Every page that SHOWS the composite should be
    // able to edit it.
    const EDITOR_HOSTS = [...FREE_AGENT_PAGES, ...ROSTER_PAGES];

    it.each(EDITOR_HOSTS)('%s mounts the editor', (page) => {
      const src = read(page);
      expect(src).toContain('components/shared/rankings/MyRankEditor.astro');
      expect(src).toMatch(/<MyRankEditor\s+league="(theleague|afl)"/);
    });

    it.each(FREE_AGENT_PAGES)('%s keeps the trigger out of the View group', (page) => {
      // My Rank opens a dialog; it is not a fourth view. Sitting inside the
      // "View:" pill group it read as one.
      const src = read(page);
      const toggles = src.slice(
        src.indexOf('class="col-group-toggles"'),
        src.indexOf('</div>', src.indexOf('class="col-group-toggles"')),
      );
      expect(toggles).not.toContain('MyRankEditor');
    });

    it('the editor writes only through the storage helpers', () => {
      // The rebalance-to-100 rule and the `rankingsUpdated` broadcast live in
      // rankings-storage.ts. A second implementation here would drift from it
      // and leave the host page's columns stale.
      const src = read('src/components/shared/rankings/MyRankEditor.tsx');
      expect(src).toContain('toggleCompositeImport');
      expect(src).toContain('setCompositeWeight');
      expect(src).not.toMatch(/localStorage\.(set|get)Item/);
    });

    it('the editor is client:only, never hydrated', () => {
      // The component returns null until it is opened, so SSR emits an EMPTY
      // <astro-island> and a hydrating directive then asks React to hydrate a
      // root that had no server output — which React 19 reports as a mismatch
      // (#418) on every single page load. It shipped that way once. There is
      // nothing to hydrate here anyway: the modal is always closed on first
      // paint and its contents come from localStorage.
      const src = read('src/components/shared/rankings/MyRankEditor.astro');
      expect(src).toContain('client:only="react"');
      // Strip comments first — the directive is explained in prose right above
      // the tag, and that prose names the directive it is warning against.
      const code = src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/client:(load|idle|visible)/);
    });

    it('the trigger retries until the island answers', () => {
      // The button is plain HTML and works from first paint; the island
      // arrives whenever its chunk does. Without the retry a fast click lands
      // before the listener exists and the button silently does nothing.
      expect(read('src/components/shared/rankings/MyRankEditor.astro')).toContain('detail.handled');
      expect(read('src/components/shared/rankings/MyRankEditor.tsx')).toContain('detail.handled = true');
    });

    it('the editor derives its Import Rankings link from the registry', () => {
      // A hardcoded '/theleague/import-rankings' sends AFL owners to the wrong
      // league's board — and tests/league-literal-guard.test.ts would not see
      // it, because the slug is not one of the literals it scans for.
      const src = read('src/components/shared/rankings/MyRankEditor.astro');
      expect(src).toContain('getLeaguePrefix(');
      expect(src).toContain('resolveLeaguePath(');
      expect(src).not.toMatch(/["'`]\/(theleague|afl-fantasy)\/import-rankings/);
    });
  });

  it('no page reads a ranking board without going through the scoped helpers', () => {
    // buildRankingLookup() defaults to getAllImports(), which rankings-scope.ts
    // has already pointed at this league's bucket. A page that builds its own
    // lookup from a raw localStorage read gets TheLeague's board on every page.
    // (tests/rankings-scope.test.ts pins the key literals; this pins the shape.)
    for (const page of [...FREE_AGENT_PAGES, ...ROSTER_PAGES, ...LINEUP_PAGES]) {
      expect(read(page), `${page} parses rankings storage directly`).not.toMatch(
        /localStorage\.getItem\(\s*['"`]rankings/,
      );
    }
  });
});

describe('Saved Rankings table layout', () => {
  // `display: flex` on a <td> takes the cell out of the table's column layout:
  // it stops aligning with its header and draws its border-bottom across its
  // own box instead of the row, which showed up as a stray line under the
  // Actions column. Space the buttons on the children instead.
  it('never makes a table cell a flex container', () => {
    const css = readFileSync('src/components/shared/rankings-import/ImportRankingsPage.astro', 'utf8');
    const block = css.slice(css.indexOf('.ri-manage__actions {'));
    const decls = block.slice(0, block.indexOf('}'));
    expect(decls).not.toMatch(/display:\s*(flex|grid|inline-flex)/);
  });
});
