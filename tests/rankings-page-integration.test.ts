import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

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

    it('the editor writes only through the storage helpers', () => {
      // The rebalance-to-100 rule and the `rankingsUpdated` broadcast live in
      // rankings-storage.ts. A second implementation here would drift from it
      // and leave the host page's columns stale.
      const src = read('src/components/shared/rankings/MyRankEditor.tsx');
      expect(src).toContain('toggleCompositeImport');
      expect(src).toContain('setCompositeWeight');
      expect(src).not.toMatch(/localStorage\.(set|get)Item/);
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
