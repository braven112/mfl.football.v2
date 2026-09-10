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

describe('server-side live-scoring reads MFL directly, not our own origin', () => {
  // Both SSR assemblers, not just the one the outage was reported against.
  // The first version of this guard named `live-scoring-data.ts` alone, and
  // `live-scoring-hero-props.ts` — the homepage's copy of the same self-fetch —
  // sailed straight past it. A guard scoped to the file you happened to edit
  // is how a half-applied fix looks green.
  const SSR_ASSEMBLERS = [
    'src/utils/live-scoring-data.ts',
    'src/utils/live-scoring-hero-props.ts',
  ];

  it.each(SSR_ASSEMBLERS)('%s does not fetch our own /api route', (path) => {
    const file = FILES.find((f) => f.path === path);
    expect(file, `${path} not found`).toBeDefined();
    // A self-fetch is an absolute /api pathname resolved against our own
    // origin, then handed to fetch() — in either the URL-object or the
    // template-literal spelling.
    const selfFetch = /new URL\(\s*['`]\/api\//.test(file!.text)
      || /['`]\/api\/live-scoring\?/.test(file!.text);
    expect(
      selfFetch,
      `${path} must read MFL through loadLiveScoringPayload, not by fetching our own /api/live-scoring during SSR`,
    ).toBe(false);
    expect(file!.text).toContain('loadLiveScoringPayload');
  });

  it('routes both the API and the assemblers through the one loader', () => {
    const route = FILES.find((f) => f.path === 'src/pages/api/live-scoring.ts')!;
    expect(route.text).toContain('loadLiveScoringPayload');
    // And the loader owns host resolution, so a caller cannot pair one
    // league's `L` with another league's MFL server.
    const source = FILES.find((f) => f.path === 'src/utils/live-scoring-source.ts')!;
    expect(source.text).toContain('export function resolveHost');
    for (const path of SSR_ASSEMBLERS) {
      const file = FILES.find((f) => f.path === path)!;
      expect(
        /host:\s*`https:\/\//.test(file.text),
        `${path} must not hand its own host to the loader — PUBLIC_MFL_HOST overrides every league`,
      ).toBe(false);
    }
  });
});

describe('the game-day hint sets cadence, it does not gate polling', () => {
  // Every island that polls MFL, not only the board. `LiveScoringHero` had the
  // identical `if (!isLive) return;` one file over and froze the HOMEPAGE for
  // the same Wednesday game.
  const POLLING_ISLANDS = [
    'src/components/shared/LiveScoreboard.tsx',
    'src/components/shared/LiveScoringHero.tsx',
  ];

  it.each(POLLING_ISLANDS)('%s polls on the data, not on getDailySlot', (path) => {
    const file = FILES.find((f) => f.path === path);
    expect(file, `${path} not found`).toBeDefined();
    // `props.isLive` is `getDailySlot(now).slot === 'live-scoring'` — a hero
    // schedule that knows Thursday, Sunday and Monday and nothing else. It may
    // set the interval; it may not decide whether to poll at all.
    expect(
      /if \(!(props\.)?isLive\) return;/.test(file!.text),
      `${path} must not skip polling because the hero schedule says it is not a game day`,
    ).toBe(false);
  });

  it('every /api/live-scoring consumer gates on the ok flag', () => {
    // 200 + `ok: false` is the upstream-MFL failure, and its empty collections
    // are indistinguishable from a healthy quiet week unless the flag is read.
    // A consumer that writes it through paints `0.0 - 0.0` over a real game or,
    // on the playoffs page, reads as "all final" and kills its own refresh.
    const CONSUMERS = [
      'src/components/shared/LiveScoreboard.tsx',
      'src/components/shared/LiveScoringHero.tsx',
      'src/hooks/useLiveScoringFeed.ts',
      'src/pages/theleague/playoffs.astro',
      'src/pages/afl-fantasy/playoffs.astro',
    ];
    const missing = CONSUMERS.filter((path) => {
      const file = FILES.find((f) => f.path === path);
      return !file || !/\bok === false\b/.test(file.text);
    });
    expect(missing, `these read /api/live-scoring without checking ok:\n${missing.join('\n')}`)
      .toEqual([]);
  });
});

describe('a body we could not read is a failed read, not an empty week', () => {
  // MFL answers a throttled request with an HTML page under a 200. That parses
  // to an empty snapshot, and `ok: true` + no matchups is the OFFSEASON shape —
  // so the live-scoring page would swap in last season's sample replay, "Sample
  // data" badge and all, during an in-season outage. Copilot caught this on
  // PR #1046; it had been true since the logic lived in the route.
  it('reports ok:false for a 200 carrying a non-JSON body', async () => {
    const { loadLiveScoringPayload } = await import('../src/utils/live-scoring-source');
    const html = () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    }) as unknown as Response;

    const original = globalThis.fetch;
    globalThis.fetch = (async () => html()) as typeof fetch;
    try {
      const payload = await loadLiveScoringPayload({ leagueId: '13522', year: 2026, week: 1 });
      expect(payload.ok, 'HTML under a 200 is an upstream failure, not a quiet week').toBe(false);
      expect(payload.matchups).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('reports ok:false for a JSON body carrying an error key', async () => {
    const { loadLiveScoringPayload } = await import('../src/utils/live-scoring-source');
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: 'Live scoring is not available' }),
    })) as unknown as typeof fetch;
    try {
      const payload = await loadLiveScoringPayload({ leagueId: '13522', year: 2026, week: 1 });
      expect(payload.ok).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('still reports ok:true for a HEALTHY but empty week', async () => {
    // The offseason feed really is a well-formed 200 with nothing in it, and
    // that is what the sample fallback is FOR. The two must stay distinct.
    const { loadLiveScoringPayload } = await import('../src/utils/live-scoring-source');
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ liveScoring: { week: '1' } }),
    })) as unknown as typeof fetch;
    try {
      const payload = await loadLiveScoringPayload({ leagueId: '13522', year: 2026, week: 1 });
      expect(payload.ok).toBe(true);
      expect(payload.matchups).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
