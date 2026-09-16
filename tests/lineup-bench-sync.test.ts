/**
 * The Set Lineup bench is a DERIVED VIEW of the nine slots, and it has to move
 * when they do.
 *
 * Both pages rendered the bench once, server-side, from a `usedPlayerIds` set
 * accumulated during the auto-fill — and then never touched it again, while the
 * slots above it were re-rendered on every swap by the page's own client
 * script. So the moment an owner seated someone off the bench, the page showed
 * him TWICE (in his new slot AND still on the bench) and dropped the man he
 * replaced off the page entirely. Reported 2026-09-15: "I added DJ Moore to my
 * starting lineup but he still shows on the bottom."
 *
 * The derivation and the row markup now live in `src/utils/lineup-bench.ts` and
 * BOTH renders go through it, so the server and client views cannot disagree.
 *
 * See docs/claude/rules/lineups.md.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './helpers/js-source';
import { selectBenchPlayers, buildBenchRowHTML } from '../src/utils/lineup-bench';

const PAGES = [
  ['TheLeague', 'src/pages/theleague/lineup.astro'],
  ['the AFL', 'src/pages/afl-fantasy/lineup.astro'],
] as const;

function pageSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
}

/** The bundled controller `<script>` only, comments blanked (see the clientrouter guard). */
function controllerScript(file: string): string {
  const src = pageSource(file);
  const start = src.indexOf('\n  <script>\n');
  const end = src.indexOf('\n  </script>', start);
  expect(start, `${file}: no bundled controller script`).toBeGreaterThan(-1);
  return stripComments(src.slice(start, end));
}

const player = (id: string, projection: number | null, over: Partial<Parameters<typeof buildBenchRowHTML>[0]> = {}) => ({
  id,
  name: `Player ${id}`,
  headshot: '',
  position: 'WR',
  nflTeam: 'CHI',
  projection,
  gameLocked: false,
  gameIndex: 0,
  isBye: false,
  ...over,
});

describe('selectBenchPlayers', () => {
  it('drops everyone the slots seated, and keeps everyone they did not', () => {
    const roster = [player('a', 5), player('b', 9), player('c', 1)];
    const bench = selectBenchPlayers(roster, [{ playerId: 'b' }, { playerId: null }]);
    expect(bench.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('is the ONLY thing that decides the bench — a seated player is never also on it', () => {
    // The shipped bug, as a test: 'dj' is in a slot, so he cannot be on the bench.
    const roster = [player('dj', 12.3), player('other', 8)];
    const bench = selectBenchPlayers(roster, [{ playerId: 'dj' }]);
    expect(bench.map((p) => p.id)).toEqual(['other']);
  });

  it('orders by projection, best first, with no projection last', () => {
    const roster = [player('a', 3), player('b', null), player('c', 11)];
    expect(selectBenchPlayers(roster, []).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate the roster it was handed', () => {
    const roster = [player('a', 3), player('c', 11)];
    selectBenchPlayers(roster, []);
    expect(roster.map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('buildBenchRowHTML', () => {
  const game = { home: 'CHI', away: 'DET', channel: { name: 'Prime Video', logo: '/x.svg', title: 'Prime Video' } };

  it('carries the hooks the CSS and the rank chips address', () => {
    const html = buildBenchRowHTML(player('13635', 12.3), game);
    expect(html).toContain('class="lineup-bench-row"');
    expect(html).toContain('data-player-id="13635"');
    expect(html).toContain('lineup-bench-row__player');
    expect(html).toContain('>12.3<');
  });

  it('marks a locked player and a bye', () => {
    expect(buildBenchRowHTML(player('a', 1, { gameLocked: true }), game)).toContain('lineup-bench-row--locked');
    expect(buildBenchRowHTML(player('a', 1, { isBye: true }), game)).toContain('lineup-bench-row__bye');
  });

  it('names the opponent from the player’s own side of the game', () => {
    expect(buildBenchRowHTML(player('a', 1, { nflTeam: 'CHI' }), game)).toContain('/assets/nfl-logos/DET.svg');
    expect(buildBenchRowHTML(player('a', 1, { nflTeam: 'DET' }), game)).toContain('/assets/nfl-logos/CHI.svg');
  });

  it('re-emits the server-resolved channel badge, and omits it when there is none', () => {
    expect(buildBenchRowHTML(player('a', 1), game)).toContain('net-badge');
    expect(buildBenchRowHTML(player('a', 1), { ...game, channel: null })).not.toContain('net-badge');
  });

  it('emits one well-formed <li> — this string goes straight into innerHTML', () => {
    const html = buildBenchRowHTML(player('a', 12.3), game);
    for (const tag of ['li', 'div', 'span']) {
      const open = html.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0;
      const close = html.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0;
      expect(close, `unbalanced <${tag}>`).toBe(open);
    }
    expect(html.match(/<li[\s>]/g)).toHaveLength(1);
  });

  it('escapes what it interpolates', () => {
    const html = buildBenchRowHTML(player('a', 1, { name: '<img onerror=1>' }), game);
    expect(html).not.toContain('<img onerror=1>');
  });

  it('renders no row content for a player with no scheduled game', () => {
    const html = buildBenchRowHTML(player('a', null, { gameIndex: null }), null);
    expect(html).not.toContain('lineup-bench-row__opp');
    expect(html).not.toContain('lineup-bench-row__proj');
  });
});

describe.each(PAGES)('%s lineup page keeps its bench in sync', (_league, file) => {
  const SRC = pageSource(file);
  const SCRIPT = controllerScript(file);

  it('server-renders the bench from the shared derivation, not an inline filter', () => {
    expect(SRC).toContain("import { selectBenchPlayers } from '../../utils/lineup-bench'");
    expect(SRC, 'the bench <ul> must map the derived list').toContain('{benchRoster.map(player => {');
    expect(SRC, 'the count must be the derived list’s length, not a subtraction that can drift')
      .toContain('<strong id="bench-count">{benchRoster.length}</strong>');
    expect(SRC, 'a hand-rolled bench filter is how the two renders drift apart')
      .not.toContain('roster.filter(p => !usedPlayerIds.has(p.id))');
  });

  it('re-renders the bench client-side from the LIVE slots', () => {
    expect(SCRIPT).toContain("from '../../utils/lineup-bench'");
    expect(SCRIPT, 'the client needs its own renderBench()').toContain('function renderBench()');
    expect(SCRIPT, 'the bench must be derived from currentSlots, never from the server payload’s slots')
      .toMatch(/selectBenchPlayers\([^)]*currentSlots\)/);
    expect(SCRIPT, 'the count moves with the list').toContain('benchCount.textContent');
    expect(SCRIPT, 'innerHTML wipes the rank chips, so they have to be reapplied')
      .toMatch(/benchList\.innerHTML[\s\S]{0,300}refreshRankChips\(\)/);
  });

  it('emits every class the .astro row does — the two renders are one pair', () => {
    // The server row and the client row sit in different files and are styled by
    // ONE stylesheet. A class that exists in only one of them is an unstyled row
    // after the first swap, or a rank chip with nowhere to hang.
    const block = SRC.slice(
      SRC.indexOf('<ul class="lineup-bench-list"'),
      SRC.indexOf('</ul>', SRC.indexOf('<ul class="lineup-bench-list"')),
    );
    const classesIn = (s: string) => new Set(s.match(/lineup-bench-row[\w-]*|net-badge[\w-]*/g) ?? []);

    const logoGame = { home: 'CHI', away: 'DET', channel: { name: 'Prime Video', logo: '/x.svg', title: 'Prime' } };
    const textGame = { home: 'CHI', away: 'DET', channel: { name: 'CBS', logo: null, title: 'CBS' } };
    const built = [
      buildBenchRowHTML(player('a', 12.3, { gameLocked: true }), logoGame),
      buildBenchRowHTML(player('b', 1), textGame),
      buildBenchRowHTML(player('c', 1, { isBye: true }), logoGame),
      buildBenchRowHTML(player('d', null, { gameIndex: null }), null),
    ].join('');

    const missing = [...classesIn(block)].filter((c) => !classesIn(built).has(c));
    expect(missing, 'the client row is missing classes the server row emits').toEqual([]);
  });

  it('refuses to run once the router has replaced its page', () => {
    // Submit success schedules updateSubmitBar() 2s later, and an in-flight
    // submit resolves whenever it resolves. Everything else in that function
    // touches nodes the closure captured — detached, harmless. renderBench()
    // reaches the LIVE document through refreshRankChips(), so a delayed call
    // from the DEPARTED league strips the arriving league's rank chips and
    // re-applies the wrong board to its rows. Caught by Codex on PR #1120.
    const start = SCRIPT.indexOf('function renderBench()');
    const body = SCRIPT.slice(start, SCRIPT.indexOf('\n      }', start));
    expect(body, 'renderBench must bail when its node is no longer in the document')
      .toContain('if (!benchList.isConnected) return;');
    expect(
      body.indexOf('isConnected'),
      'the guard must precede the render, not follow it',
    ).toBeLessThan(body.indexOf('benchList.innerHTML'));
  });

  it('hangs renderBench() off the funnel EVERY mutation path already goes through', () => {
    // performSwap, undoLastSwap, undoClear, setOptimalLineup, clearLineup and
    // the init-time draft restore all call updateSubmitBar(). Calling renderBench
    // from there is what makes the bench correct on all six without six edits
    // that the seventh mutation path would forget.
    const start = SCRIPT.indexOf('function updateSubmitBar()');
    expect(start, 'updateSubmitBar() is the change funnel').toBeGreaterThan(-1);
    const body = SCRIPT.slice(start, SCRIPT.indexOf('\n      }', start));
    expect(body, 'updateSubmitBar() must re-render the bench').toContain('renderBench()');

    for (const fn of ['function performSwap(', 'function undoLastSwap(', 'function undoClear(', 'function setOptimalLineup(', 'function clearLineup(']) {
      const at = SCRIPT.indexOf(fn);
      expect(at, `${fn} missing`).toBeGreaterThan(-1);
      expect(SCRIPT.slice(at, SCRIPT.indexOf('\n      }', at)), `${fn} must go through updateSubmitBar()`)
        .toContain('updateSubmitBar()');
    }
  });
});
