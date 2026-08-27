/**
 * The My Draft List board must seed its OWN ranking sources.
 *
 * Regression guard for a dead end that shipped: `syncBuiltinImports` was
 * called from the Import Rankings page and nowhere else, so a browser that
 * had never opened that page had no composite. The board's only two seeds
 * were the composite and MFL — so an owner with no MFL draft list landed on
 * an empty board with no way to build one, which is exactly the owner the
 * importer exists for. Vercel logs showed the symptom precisely: page loads
 * and GETs, and not one POST, because the push was stopped by the
 * empty-board guard before it ever left the browser.
 *
 * Source-scanning rather than behavioral because the failure was structural —
 * a call site that did not exist. tests/draft-list-ui-loads.test.ts covers
 * that the module still compiles.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');

const ISLAND = 'src/components/theleague/custom-rankings/CustomRankingsPage.tsx';
const PAGE = 'src/components/shared/custom-rankings/CustomRankingsPage.astro';

describe('My Draft List board seeds its own ranking sources', () => {
  it('the island reconciles the built-in sources', () => {
    expect(read(ISLAND)).toContain('syncBuiltinImports');
  });

  it('it seeds BEFORE reading the composite, not after', () => {
    // Order is the whole fix: a composite read first is a composite read empty.
    const src = read(ISLAND);
    expect(src.indexOf('syncBuiltinImports(')).toBeGreaterThan(-1);
    expect(src.indexOf('syncBuiltinImports(')).toBeLessThan(src.indexOf('buildCompositePlayerList()'));
  });

  it('the Astro page hands down the snapshot and the league defaults', () => {
    const src = read(PAGE);
    expect(src).toContain('builtinSnapshotJson=');
    expect(src).toContain('defaultSourceIds=');
    expect(src).toContain('data/ranking-sources/');
  });

  it('every league ticks at least 2 default sources — below that no composite forms', async () => {
    // getCompositeConfig() returns null under 2 members, which would put the
    // board right back in the empty state this test exists to prevent.
    const { LEAGUES, defaultRankingSourcesFor } = await import('../src/config/leagues-data.mjs');
    for (const slug of Object.keys(LEAGUES)) {
      expect(defaultRankingSourcesFor(slug).length, `${slug} default sources`).toBeGreaterThanOrEqual(2);
    }
  });
});
