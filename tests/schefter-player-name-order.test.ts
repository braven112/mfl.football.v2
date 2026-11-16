import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * MFL's players export stores names "Last, First". Any Schefter path that
 * puts that raw string into post copy or an AI prompt reads like two players
 * ("WR Samuel, Deebo"), and the AI rewrite then splits one player into two
 * ("WR Samuel and WR Deebo", TheLeague feed, 2026-11-14). Every name taken
 * from the players map in the scanner must go through formatPlayerName.
 */
const scan = readFileSync('scripts/schefter-scan.mjs', 'utf8');

describe('Schefter scanner never prints a raw "Last, First" name', () => {
  it('does not copy a players-map name straight into a display field', () => {
    // loadPlayers builds the map itself and keeps MFL's raw name on purpose.
    const loaderStart = scan.indexOf('async function loadPlayers');
    const loaderEnd = scan.indexOf('\n}\n', loaderStart);
    const before = scan.slice(0, loaderStart).split('\n').length;
    const after = scan.slice(0, loaderEnd).split('\n').length;
    const raw = scan
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ n }) => n < before || n > after)
      .filter(({ line }) => /\bname:\s*(p|player)\??\.name\b/.test(line) && !line.includes('formatPlayerName('));
    expect(raw, raw.map((r) => `schefter-scan.mjs:${r.n} ${r.line}`).join('\n')).toEqual([]);
  });

  it('formats trade-block tip names First Last', () => {
    const body = scan.slice(scan.indexOf('function buildTradeBaitTip'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    expect(fn).toMatch(/formatPlayerName\(p\.name\)/);
  });
});
