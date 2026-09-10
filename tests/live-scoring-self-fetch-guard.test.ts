/**
 * Two rules the live-scoring board went blank for on the 2026 season opener,
 * both invisible in a diff and both mechanical to check.
 *
 * **1. The page must not fetch its own API to render itself.**
 * `assembleLiveScoringData` used to SSR by fetching
 * `https://<our domain>/api/live-scoring?…` — our own edge, over the public
 * internet, in the middle of the render. When that hop started failing the
 * page got `ok: false` with zero matchups, which is not even the offseason
 * sample's trigger (that requires `ok`), so the board printed "Scores will
 * appear here when games begin" over a live slate while the very same route
 * answered every external caller correctly. Nothing in the runtime logs tied
 * the two together: a request blocked at the edge never reaches the route, so
 * there was no failing entry to find. A server that already knows the
 * league's registry host has no business asking itself for what it can read
 * directly.
 *
 * **2. A `host=` param on `/api/live-scoring` is an SSRF signature.**
 * The route resolves a known `L` to its registry host outright and ignores
 * `host` entirely, so the param buys nothing — and a public URL carrying
 * `host=<hostname>` is what got the gameday health check's probes 403'd at
 * the edge (2026-09-03). Callers send `L` alone.
 *
 * A grep is the right shape for both: each is one URL-building line that reads
 * as perfectly sensible on its own.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/** Every source file that could build a live-scoring URL. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.(ts|tsx|astro|mjs|js)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const FILES = sourceFiles(join(ROOT, 'src')).map((path) => ({
  path: path.slice(ROOT.length + 1),
  text: readFileSync(path, 'utf-8'),
}));

describe('/api/live-scoring callers send `L` alone', () => {
  it('no source file pairs a live-scoring request with a host param', () => {
    const offenders: string[] = [];

    for (const { path, text } of FILES) {
      // The route itself still ACCEPTS the param (for a league id outside the
      // registry, where the hint is the only information available) and its
      // own tests exercise that path. This guards the CALLERS.
      if (path === 'src/pages/api/live-scoring.ts') continue;

      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('/api/live-scoring')) return;
        if (/host=/.test(line)) offenders.push(`${path}:${i + 1} — ${line.trim()}`);
      });

      // The URL-object form builds the query over several lines, so look for a
      // `host` search param anywhere in a file that talks to this route.
      if (text.includes("'/api/live-scoring'") && /searchParams\.set\(\s*'host'/.test(text)) {
        offenders.push(`${path} — searchParams.set('host', …) on a live-scoring URL`);
      }
    }

    expect(offenders, `send L alone — a host= param on a public URL reads as SSRF to a WAF:\n${offenders.join('\n')}`)
      .toEqual([]);
  });
});

describe('the live-scoring page reads MFL directly, not its own origin', () => {
  const assembler = FILES.find((f) => f.path === 'src/utils/live-scoring-data.ts')!;

  it('assembleLiveScoringData does not fetch our own /api route', () => {
    expect(assembler).toBeDefined();
    // A self-fetch is spelled `new URL('/api/…', siteUrl)` — an absolute
    // pathname resolved against our own origin, then handed to fetch().
    const selfFetch = /new URL\(\s*'\/api\//.test(assembler.text);
    expect(
      selfFetch,
      'live-scoring-data.ts must read MFL through loadLiveScoringPayload, not by fetching our own /api/live-scoring during SSR',
    ).toBe(false);
  });

  it('it goes through the shared loader, so route and page cannot drift', () => {
    expect(assembler.text).toContain('loadLiveScoringPayload');
    const route = FILES.find((f) => f.path === 'src/pages/api/live-scoring.ts')!;
    expect(route.text).toContain('loadLiveScoringPayload');
  });
});

describe('the MFL poller is not gated on the game-day hero schedule', () => {
  const board = FILES.find((f) => f.path === 'src/components/shared/LiveScoreboard.tsx')!;

  it('LiveScoreboard polls on the data, not on getDailySlot', () => {
    // `props.isLive` is `getDailySlot(now).slot === 'live-scoring'` — a hero
    // schedule that knows Thursday, Sunday and Monday and nothing else. It was
    // false for the 2026 Wednesday-night opener, and because it gated the poll
    // ENTIRELY the board never asked MFL for a score all game. It may set the
    // cadence; it may not decide whether to poll at all.
    expect(
      /if \(!isLive\) return;/.test(board.text),
      'LiveScoreboard must not skip polling because the hero schedule says it is not a game day',
    ).toBe(false);
    expect(board.text).toContain('shouldPollLive(');
  });
});
