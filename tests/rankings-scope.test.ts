import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  DEFAULT_RANKINGS_SCOPE,
  activeRankingsScope,
  rankingsScopeForLeagueId,
  rankingsScopeForLeagueSlug,
  rankingsScopeForNavSlug,
  scopedKvKey,
  scopedLocalKey,
} from '../src/utils/rankings-scope';
import { LEAGUES } from '../src/config/leagues';

/**
 * The rankings system (Import Rankings → composite "My Rank" → the Custom
 * Rankings board) is per-owner data that must not be shared between leagues:
 * franchise ids collide (AFL 0001 and TheLeague 0001 are different teams), and
 * an owner's read on a player in a keeper league is a different opinion than
 * their read in a dynasty-contract league.
 *
 * These tests pin the two halves that are easy to break silently — the legacy
 * key strings, and the fact that AFL is genuinely separate.
 */
describe('rankings scope', () => {
  describe('legacy keys are byte-identical for TheLeague', () => {
    // Anything here that changes value logs an owner out of a board they built.
    it('keeps localStorage keys bare', () => {
      const scope = rankingsScopeForNavSlug('theleague');
      expect(scopedLocalKey('rankings.imports', scope)).toBe('rankings.imports');
      expect(scopedLocalKey('rankings.averagePosition', scope)).toBe('rankings.averagePosition');
      expect(scopedLocalKey('rankings.compositeConfig', scope)).toBe('rankings.compositeConfig');
      expect(scopedLocalKey('ri.localCache', scope)).toBe('ri.localCache');
      expect(scopedLocalKey('cr.localCache', scope)).toBe('cr.localCache');
    });

    it('keeps Redis keys as the pre-existing prefix:franchiseId', () => {
      const scope = rankingsScopeForNavSlug('theleague');
      expect(scopedKvKey('ri', scope, '0001')).toBe('ri:0001');
      expect(scopedKvKey('cr', scope, '0012')).toBe('cr:0012');
    });
  });

  describe('the AFL gets its own bucket', () => {
    it('namespaces localStorage', () => {
      const scope = rankingsScopeForNavSlug('afl');
      expect(scope).toBe('afl');
      expect(scopedLocalKey('rankings.imports', scope)).toBe('rankings.imports.afl');
      expect(scopedLocalKey('cr.localCache', scope)).toBe('cr.localCache.afl');
    });

    it('namespaces Redis so colliding franchise ids stay apart', () => {
      const afl = rankingsScopeForNavSlug('afl');
      const theLeague = rankingsScopeForNavSlug('theleague');
      expect(scopedKvKey('cr', afl, '0001')).toBe('cr:afl:0001');
      // The whole point: same franchise id, different key.
      expect(scopedKvKey('cr', afl, '0001')).not.toBe(scopedKvKey('cr', theLeague, '0001'));
    });
  });

  describe('best-ball has its own bucket', () => {
    // bb1 used to share TheLeague's bucket. It must not (commissioner,
    // 2026-08-20): a best-ball board is its own board. Pinned because the old
    // behavior was deliberate and documented, so a well-meaning revert is
    // plausible.
    it('does not share TheLeague’s storage', () => {
      const bb1 = rankingsScopeForNavSlug('bb1');
      expect(bb1).toBe('bb1');
      expect(bb1).not.toBe(DEFAULT_RANKINGS_SCOPE);
      expect(scopedLocalKey('rankings.imports', bb1)).toBe('rankings.imports.bb1');
      expect(scopedKvKey('ri', bb1, '0001')).toBe('ri:bb1:0001');
    });

    it('keeps all three leagues on distinct keys for the same franchise id', () => {
      const keys = ['theleague', 'afl', 'bb1'].map((slug) =>
        scopedKvKey('cr', rankingsScopeForNavSlug(slug), '0001'),
      );
      expect(new Set(keys).size).toBe(3);
    });
  });

  describe('resolution from the registry', () => {
    it('resolves canonical league slugs', () => {
      expect(rankingsScopeForLeagueSlug('theleague')).toBe('theleague');
      expect(rankingsScopeForLeagueSlug('afl-fantasy')).toBe('afl');
      expect(rankingsScopeForLeagueSlug('best-ball-1')).toBe('bb1');
    });

    it('resolves MFL league ids (what a session JWT carries)', () => {
      expect(rankingsScopeForLeagueId(LEAGUES['theleague'].id)).toBe('theleague');
      expect(rankingsScopeForLeagueId(LEAGUES['afl-fantasy'].id)).toBe('afl');
    });

    it('falls back to TheLeague for anything unattributable', () => {
      for (const value of [null, undefined, '', 'nope']) {
        expect(rankingsScopeForNavSlug(value as string)).toBe(DEFAULT_RANKINGS_SCOPE);
        expect(rankingsScopeForLeagueSlug(value as string)).toBe(DEFAULT_RANKINGS_SCOPE);
        expect(rankingsScopeForLeagueId(value as string)).toBe(DEFAULT_RANKINGS_SCOPE);
      }
    });

    it('covers every league in the registry', () => {
      // A new league added to the registry without a SCOPE_BY_NAV_SLUG entry
      // silently pools its owners' boards into TheLeague's. Fail here instead.
      const source = readFileSync('src/utils/rankings-scope.ts', 'utf8');
      const mapBlock = source.slice(
        source.indexOf('SCOPE_BY_NAV_SLUG'),
        source.indexOf('/** Resolve a league'),
      );
      for (const league of Object.values(LEAGUES)) {
        expect(mapBlock, `navSlug '${league.navSlug}' has no rankings scope`).toContain(
          `${league.navSlug}:`,
        );
      }
    });
  });

  describe('activeRankingsScope reads the live document', () => {
    // The suite runs in the `node` environment, so stub the one property
    // activeRankingsScope touches rather than pulling in jsdom for it.
    const dataset: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const k of Object.keys(dataset)) delete dataset[k];
      (globalThis as any).document = { documentElement: { dataset } };
    });

    afterEach(() => {
      delete (globalThis as any).document;
    });

    it('follows html[data-league]', () => {
      dataset.league = 'afl';
      expect(activeRankingsScope()).toBe('afl');
      // Re-read, not captured at module load: with the ClientRouter a single
      // module instance survives a navigation between leagues, so a captured
      // value would write the previous league's bucket.
      dataset.league = 'theleague';
      expect(activeRankingsScope()).toBe('theleague');
    });

    it('defaults when the attribute is absent', () => {
      expect(activeRankingsScope()).toBe(DEFAULT_RANKINGS_SCOPE);
    });

    it('defaults with no document at all (SSR)', () => {
      delete (globalThis as any).document;
      expect(activeRankingsScope()).toBe(DEFAULT_RANKINGS_SCOPE);
    });
  });

  describe('no component reaches past the scope helpers', () => {
    // A component reading `localStorage.getItem('rankings.compositeConfig')`
    // directly gets TheLeague's key on every page — on an AFL or best-ball
    // page that is the wrong league's config, or nothing at all. That shipped
    // once (ManageImportsSection) and rendered stale tick state on two of the
    // three leagues, so it is worth failing the build over.
    const BASE_KEYS = [
      'rankings.imports',
      'rankings.compositeConfig',
      'rankings.averagePosition',
      'rankings.hiddenBuiltins',
      'ri.localCache',
      'cr.localCache',
    ];

    it('never hardcodes a rankings storage key outside the scope helpers', () => {
      const files = execSync(
        "git ls-files 'src/components/**/*.tsx' 'src/components/**/*.astro' 'src/hooks/**/*.ts' 'src/pages/**/*.astro'",
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter(Boolean);

      const offenders: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const key of BASE_KEYS) {
          if (source.includes(`'${key}'`) || source.includes(`"${key}"`)) {
            offenders.push(`${file} → ${key}`);
          }
        }
      }
      expect(offenders, 'use the exports in rankings-storage.ts instead').toEqual([]);
    });
  });
});