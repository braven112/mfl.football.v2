import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET } from '../src/pages/api/roster-season/[league]/[year]';

/**
 * Guards the on-demand-season split of the rosters page.
 *
 * The page used to inline every season into #roster-config (8.2 MB of it).
 * Now only the LIVE seasons ship inline and everything frozen is fetched from
 * /api/roster-season/[league]/[year].
 *
 * These call the real handler and assert the real Response. An earlier version
 * of this file grepped the route's source for `getLeagueBySlug` and
 * `import.meta.glob`, which is the failure mode `docs/claude/rules/league-urls.md`
 * records biting twice in one PR: a `toContain` is satisfied by an import line
 * or a doc comment and stays green while the behavior it claims to pin is gone.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const derived = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/theleague/derived/roster-season-payloads.json'), 'utf8'),
);
const seasons: Record<string, any> = derived.seasons ?? {};

/** The handler only reads `params`; everything else in the Astro context is unused. */
const call = (league: string, year: string) =>
  (GET as any)({ params: { league, year } }) as Promise<Response>;

describe('GET /api/roster-season/[league]/[year]', () => {
  it('serves every frozen season the page can ask for', async () => {
    const years = Object.keys(seasons);
    expect(years.length).toBeGreaterThan(0);

    // Every one, not a sample — a single unservable year is a season the
    // picker would silently dead-end on.
    const failures: string[] = [];
    for (const year of years) {
      const res = await call('theleague', year);
      if (res.status !== 200) failures.push(`${year} -> ${res.status}`);
    }
    expect(failures, 'derived seasons the endpoint cannot serve').toEqual([]);
  });

  it('returns the payload under the documented shape', async () => {
    const year = Object.keys(seasons)[0];
    const res = await call('theleague', year);
    const body = await res.json();
    expect(body.season).toBe(year);
    expect(body.payload?.teams).toBeTruthy();
    expect(Object.keys(body.payload.teams).length).toBeGreaterThan(0);
  });

  it('carries salaryAdjustments on every payload it serves', async () => {
    // The separate `adjustmentsBySeason` config key was removed as a
    // byte-identical duplicate of exactly these arrays. That is only safe
    // while every payload still embeds its own — without it dead money
    // renders as zero rather than failing loudly.
    const missing: string[] = [];
    for (const year of Object.keys(seasons)) {
      const body = await (await call('theleague', year)).json();
      if (!Array.isArray(body.payload?.salaryAdjustments)) missing.push(year);
    }
    expect(missing, 'served seasons missing salaryAdjustments').toEqual([]);
  });

  it('404s a season it does not hold, rather than serving an empty one', async () => {
    // A live season is built in the page frontmatter from the feeds; a stale
    // derived copy would be wrong, so this route must not answer for one.
    const res = await call('theleague', '2099');
    expect(res.status).toBe(404);
  });

  it('rejects a non-year param before any lookup', async () => {
    for (const bad of ['abcd', '20', '../../etc', '2013x']) {
      const res = await call('theleague', bad);
      expect(res.status, `year "${bad}"`).toBe(400);
    }
  });

  it('404s an unknown league rather than guessing one', async () => {
    const res = await call('not-a-league', '2013');
    expect(res.status).toBe(404);
  });

  it('caches a hit and never caches a miss', async () => {
    const hit = await call('theleague', Object.keys(seasons)[0]);
    expect(hit.headers.get('Cache-Control')).toContain('max-age=');

    const miss = await call('theleague', '2099');
    expect(miss.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('rosters page payload invariants', () => {
  const pageSrc = fs.readFileSync(
    path.join(repoRoot, 'src/pages/theleague/rosters.astro'),
    'utf8',
  );

  it('serializes the filtered season map, not the full one', () => {
    expect(pageSrc).toContain('seasons: inlineSeasons');
    expect(pageSrc).toContain('liveSeasonKeys');
  });

  it('does not re-add the three deduplicated config keys', () => {
    expect(pageSrc).not.toMatch(/^\s*initialSeasonData,\s*$/m);
    expect(pageSrc).not.toMatch(/^\s*initialTeamData,\s*$/m);
    expect(pageSrc).not.toMatch(/adjustmentsBySeason:\s*adjustmentsBySeasonAllYears/);
  });

  it('does not prefetch seasons in the background', () => {
    // An idle prefetch pulled all 18 frozen seasons — 7.09 MB, the entire
    // payload this page stopped shipping — back over the wire to warm a cache
    // nothing can read, since there is no season picker. If a picker ships,
    // warm from its interaction, never unconditionally on load.
    expect(pageSrc).not.toContain('prefetchRemainingSeasons');
    // Not a blanket ban on requestIdleCallback — the page uses it legitimately
    // to warm the analytics/planner views (scheduleIdleWork). What must not
    // come back is an idle callback that calls loadSeason.
    expect(pageSrc).not.toMatch(/requestIdleCallback[\s\S]{0,400}?loadSeason/);
  });
});
