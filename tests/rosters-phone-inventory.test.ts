/**
 * Every roster column has a home on a phone (docs/plans/rosters-mobile-layout.md,
 * rule 1). Below 768px both roster pages hide the header row and turn rows into
 * cards; a new desktop column that nobody placed would simply vanish on a
 * phone. This scan fails on any `<th data-column>` with no entry in
 * PHONE_HOMES, and on any entry whose column is gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PHONE_HOMES, phoneHomeKey, type PhoneInventoryLeague } from '../src/utils/rosters/phone-inventory';

const PAGES: Record<PhoneInventoryLeague, string> = {
  theleague: 'src/pages/theleague/rosters.astro',
  'afl-fantasy': 'src/pages/afl-fantasy/rosters.astro',
};

/**
 * The page's header columns: literal `data-column="x"`, and a template's
 * static prefix (`data-column={\`year${…}\`}` → `year` + a family marker).
 * A column name built entirely at runtime (`"${columnKey}"`) has no static
 * name to check and is skipped.
 */
function headerColumns(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/<th\b[^>]*?data-column=(?:"([^"$]+)"|\{`([a-z-]+)\$\{)/g)) {
    out.add(m[1] ?? `${m[2]}1`);
  }
  return [...out].sort();
}

describe('every roster column has a phone home', () => {
  for (const league of Object.keys(PAGES) as PhoneInventoryLeague[]) {
    const columns = headerColumns(readFileSync(PAGES[league], 'utf8'));

    it(`${league}: finds its header columns`, () => {
      expect(columns.length).toBeGreaterThan(5);
    });

    it(`${league}: no column is left without a home`, () => {
      const orphans = columns.filter((c) => phoneHomeKey(league, c) === null);
      expect(orphans, 'add each to PHONE_HOMES in src/utils/rosters/phone-inventory.ts').toEqual([]);
    });

    it(`${league}: no home outlives its column`, () => {
      const used = new Set(columns.map((c) => phoneHomeKey(league, c)));
      const stale = Object.keys(PHONE_HOMES[league]).filter((k) => !used.has(k));
      expect(stale).toEqual([]);
    });
  }
});
