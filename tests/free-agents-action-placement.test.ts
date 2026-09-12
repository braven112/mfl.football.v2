/**
 * Free agents — the action controls sit beside the player, and the waiver
 * priority dialog opens with an order already on screen.
 *
 * Both are regressions that reached owners on 2026-09-05 (hotfix):
 * - The Bid/Claim button and the ⋮ menu were the LAST columns of a table
 *   that scrolls sideways on a phone, so the one control that does anything
 *   was nine columns off-screen. The ⋮ must come right after the player
 *   column, ahead of Age — in the header AND in the JS-built row.
 * - The priority dialog opened on a bare "Reading the live order…" line and,
 *   when the live read never settled, stayed there. It now renders the
 *   committed feed's order server-side, which needs the ranker imported in
 *   FRONTMATTER (the first cut imported it only in the client script and the
 *   signed-in AFL render died with "rankWithinConference is not defined").
 *
 * There is only ONE action column now (Sep 2026): the acquisition pill moved
 * into the player modal so it could be offered on every page instead of only
 * these two, and the ⋮ column took the league's verb as its header. That is
 * pinned below too — a nameless action column is what sent owners looking for
 * the Bid button that used to sit next to it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const PAGES = ['src/pages/theleague/players.astro', 'src/pages/afl-fantasy/players.astro'];

describe('free-agent action controls sit beside the player column', () => {
  for (const page of PAGES) {
    it(`${page}: header puts the action column before Age`, () => {
      const src = read(page);
      const player = src.indexOf('data-sort="name"');
      const age = src.indexOf('data-sort="age"');
      const kebab = src.indexOf('<th class="col-player-actions"');
      expect(player).toBeGreaterThan(-1);
      expect(age).toBeGreaterThan(player);
      expect(kebab).toBeGreaterThan(player);
      expect(kebab).toBeLessThan(age);
    });

    it(`${page}: the action column is labelled with the league's verb`, () => {
      const src = read(page);
      const header = src.slice(
        src.indexOf('<th class="col-player-actions"'),
        src.indexOf('data-sort="age"'),
      );
      // Rendered from claimVerb(), never a literal: the ⋮ sheet and the player
      // modal read the same resolver, and a hardcoded 'Claim' here would call
      // a blind bid something it is not.
      expect(header).toContain('{claimVerb}');
      expect(src).toMatch(/const claimVerb = claimVerbFor\(/);
    });

    it(`${page}: the row builder emits the action cell before the age cell`, () => {
      const src = read(page);
      const rowStart = src.indexOf('<tr class="${rosteredClass}"');
      expect(rowStart).toBeGreaterThan(-1);
      const row = src.slice(rowStart, src.indexOf('</tr>`', rowStart));
      const age = row.indexOf('<td class="cell-age">');
      const kebab = row.indexOf('${kebabCell}');
      expect(age).toBeGreaterThan(-1);
      expect(kebab).toBeGreaterThan(-1);
      expect(kebab).toBeLessThan(age);
      expect(src.slice(rowStart).includes('html += kebabCell')).toBe(false);
    });

    it(`${page}: the ⋮ button carries the page's own free-agent verdict`, () => {
      const src = read(page);
      // The sheet cannot work this out for itself: in a duplicate-player
      // league availability is per-conference, which only the page knows.
      expect(src).toMatch(/data-pa-claimable="\$\{/);
    });

    it(`${page}: no second acquisition column survives`, () => {
      const src = read(page);
      expect(src).not.toContain('<th class="col-fa-action"');
      expect(src).not.toContain('<td class="col-fa-action">');
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
