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

    it.each(LINEUP_PAGES)('%s degrades to no column when there is no board', (page) => {
      const src = read(page);
      // Every rank surface is gated on `rankings.available`, so an owner who
      // has imported nothing sees no empty column and no dead toggle.
      expect(src).toContain('rankings.available');
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
