/**
 * The Free Agents "nothing matched" row.
 *
 * A table that renders zero rows and says nothing is ambiguous: "your filters
 * matched nothing" and "this page broke" look identical, and this repo treats
 * that distinction as load-bearing everywhere else (see
 * docs/claude/rules/lineups.md on "no lineup on file" vs "we couldn't read
 * it"). These tests pin the part that makes the row worth having — that it
 * names what is actually narrowing the list, so the reader can undo the right
 * control instead of opening the filter panel to go looking.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeReasons,
  playersEmptyStateRow,
  PLAYERS_EMPTY_RESET_ID,
} from '../src/scripts/players/empty-state';

describe('describeReasons', () => {
  it('names a search by what was typed', () => {
    expect(describeReasons({ search: 'Mahomes' })).toBe(
      'No players match your search for &ldquo;Mahomes&rdquo;.',
    );
  });

  it('names the position filter on its own', () => {
    expect(describeReasons({ position: 'QB' })).toBe('No players match the QB filter.');
  });

  it('counts advanced filters, and gets the singular right', () => {
    expect(describeReasons({ advancedFilters: 1 })).toBe('No players match 1 advanced filter.');
    expect(describeReasons({ advancedFilters: 3 })).toBe('No players match 3 advanced filters.');
  });

  it('joins two reasons with "and", and three with a comma', () => {
    expect(describeReasons({ search: 'x', position: 'RB' })).toBe(
      'No players match your search for &ldquo;x&rdquo; and the RB filter.',
    );
    expect(describeReasons({ search: 'x', position: 'RB', advancedFilters: 2 })).toBe(
      'No players match your search for &ldquo;x&rdquo;, the RB filter and 2 advanced filters.',
    );
  });

  it('falls back to a plain statement when nothing is narrowing the list', () => {
    // A genuinely empty pool — an owner who has filtered nothing and still sees
    // no rows is being told something different, and must not be offered a
    // "clear your filters" button that would do nothing.
    expect(describeReasons({})).toBe('No players are available right now.');
    expect(playersEmptyStateRow(12, {})).not.toContain(PLAYERS_EMPTY_RESET_ID);
  });

  it('escapes the search text, which is the one attacker-controlled value here', () => {
    const out = describeReasons({ search: '<img src=x onerror=alert(1)>' });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});

describe('playersEmptyStateRow', () => {
  it('spans the whole table, so the message is not stuck under one column', () => {
    expect(playersEmptyStateRow(14, { search: 'x' })).toContain('colspan="14"');
  });

  it('offers a way out whenever something is narrowing the list', () => {
    expect(playersEmptyStateRow(12, { position: 'TE' })).toContain(PLAYERS_EMPTY_RESET_ID);
  });
});

describe('both leagues use it', () => {
  // The recurring bug class on these two pages is a fix landing in one league
  // and not the other. One shared module is what makes that impossible here.
  const scripts = [
    'src/scripts/players/theleague-players.ts',
    'src/scripts/players/afl-players.ts',
  ];

  it.each(scripts)('%s renders the shared empty state instead of a blank tbody', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    expect(src).toContain("from './empty-state'");
    expect(src).toContain('total === 0 ? currentEmptyStateRow() : html');
  });

  it.each(scripts)('%s wires the reset to clear search and position too', (file) => {
    // The panel's own clear button deliberately leaves those alone; this one
    // cannot, or "Show all players" lands on a still-empty table.
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    const handler = src.slice(src.indexOf(`closest(\`#\${PLAYERS_EMPTY_RESET_ID}\`)`));
    expect(handler).toContain('clearAdvancedFilters()');
    expect(handler).toContain("searchQuery = ''");
    expect(handler).toContain("activePosition = 'ALL'");
  });
});

describe('the hero count tracks the filtered pool', () => {
  // It is the largest number on the page. TheLeague rendered it once on the
  // server and never touched it, so a search that matched nothing left the
  // hero claiming 629 available players above pills that all read 0.
  it.each([
    'src/scripts/players/theleague-players.ts',
    'src/scripts/players/afl-players.ts',
  ])('%s rewrites it on every filter pass', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    expect(src).toContain("getElementById('hero-count-num')");
    expect(src).toContain('String(counts.ALL)');
  });

  it.each([
    'src/pages/theleague/players.astro',
    'src/pages/afl-fantasy/players.astro',
  ])('%s gives it an id to write to', (file) => {
    expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain('id="hero-count-num"');
  });
});
