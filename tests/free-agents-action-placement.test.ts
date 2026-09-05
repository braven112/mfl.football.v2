/**
 * Free agents — the action controls sit beside the player, and the waiver
 * priority dialog opens with an order already on screen.
 *
 * Both are regressions that reached owners on 2026-09-05 (hotfix):
 * - The Bid/Claim button and the ⋮ menu were the LAST columns of a table
 *   that scrolls sideways on a phone, so the one control that does anything
 *   was nine columns off-screen. They must come right after the player
 *   column, ahead of Age — in the header AND in the JS-built row.
 * - The priority dialog opened on a bare "Reading the live order…" line and,
 *   when the live read never settled, stayed there. It now renders the
 *   committed feed's order server-side, which needs the ranker imported in
 *   FRONTMATTER (the first cut imported it only in the client script and the
 *   signed-in AFL render died with "rankWithinConference is not defined").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const PAGES = ['src/pages/theleague/players.astro', 'src/pages/afl-fantasy/players.astro'];

describe('free-agent action controls sit beside the player column', () => {
  for (const page of PAGES) {
    it(`${page}: header puts the action columns before Age`, () => {
      const src = read(page);
      const player = src.indexOf('data-sort="name"');
      const age = src.indexOf('data-sort="age"');
      const claim = src.indexOf('<th class="col-fa-action"');
      const kebab = src.indexOf('<th class="col-player-actions"');
      expect(player).toBeGreaterThan(-1);
      expect(age).toBeGreaterThan(player);
      expect(claim).toBeGreaterThan(player);
      expect(claim).toBeLessThan(age);
      expect(kebab).toBeGreaterThan(player);
      expect(kebab).toBeLessThan(age);
    });

    it(`${page}: the row builder emits the action cells before the age cell`, () => {
      const src = read(page);
      const rowStart = src.indexOf('<tr class="${rosteredClass}"');
      expect(rowStart).toBeGreaterThan(-1);
      const row = src.slice(rowStart, src.indexOf('</tr>`', rowStart));
      const age = row.indexOf('<td class="cell-age">');
      const kebab = row.indexOf('${kebabCell}');
      expect(age).toBeGreaterThan(-1);
      expect(kebab).toBeGreaterThan(-1);
      expect(kebab).toBeLessThan(age);
      // The claim cell rides in the same slot, never appended after the row.
      expect(row.indexOf('col-fa-action')).toBeLessThan(age);
      expect(src.slice(rowStart).includes('html += kebabCell')).toBe(false);
    });
  }
});

describe('waiver priority dialog opens with an order on screen', () => {
  const src = read('src/components/shared/WaiverPriorityModal.astro');
  const frontmatter = src.slice(0, src.indexOf('\n---', 4));

  it('imports the ranker in FRONTMATTER, where the server-side list is built', () => {
    expect(frontmatter).toMatch(/import \{[^}]*rankWithinConference[^}]*\} from '\.\.\/\.\.\/utils\/waiver-order'/);
    expect(frontmatter).toContain('rankWithinConference(');
  });

  it('renders the synced order into the list and never hides it behind the status line', () => {
    expect(src).toContain('initialRanked.map(');
    expect(src).toMatch(/hidden=\{initialRanked\.length === 0\}/);
  });

  it('time-boxes the live read so the dialog cannot hang on the loading line', () => {
    expect(src).toMatch(/AbortController|setTimeout\(\(\) => [a-z]+\.abort\(\)/);
    expect(src).toContain('LIVE_READ_TIMEOUT_MS');
  });
});
