import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards the on-demand-season split of the rosters page.
 *
 * The page used to inline every season into #roster-config (8.2 MB of it).
 * Now only the LIVE seasons ship inline and everything frozen is fetched from
 * /api/roster-season/[league]/[year]. Two things have to stay true for that to
 * be safe, and neither is obvious from reading either file alone:
 *
 *  1. The endpoint can actually serve every frozen season the page will ask
 *     for — otherwise the season picker silently dead-ends on some years.
 *  2. Each served payload still carries `salaryAdjustments`, because the
 *     separate `adjustmentsBySeason` config key that used to carry that data
 *     was removed as a duplicate. If a payload lost it, dead money would
 *     silently render as zero rather than failing loudly.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const derivedPath = path.join(
  repoRoot,
  'data/theleague/derived/roster-season-payloads.json',
);

describe('roster season on-demand endpoint', () => {
  const derived = JSON.parse(fs.readFileSync(derivedPath, 'utf8'));
  const seasons: Record<string, any> = derived.seasons ?? {};

  it('has derived payloads to serve', () => {
    expect(Object.keys(seasons).length).toBeGreaterThan(0);
  });

  it('every derived season carries its own salaryAdjustments array', () => {
    // The removed `adjustmentsBySeason` config key was a byte-identical copy of
    // exactly these arrays. Dropping it is only safe while every payload still
    // embeds its own — a payload without one renders dead money as zero.
    const missing = Object.entries(seasons)
      .filter(([, payload]) => !Array.isArray((payload as any)?.salaryAdjustments))
      .map(([season]) => season);
    expect(missing, 'derived seasons missing salaryAdjustments').toEqual([]);
  });

  it('every derived season has a teams map', () => {
    const missing = Object.entries(seasons)
      .filter(([, payload]) => {
        const teams = (payload as any)?.teams;
        return !teams || typeof teams !== 'object' || Object.keys(teams).length === 0;
      })
      .map(([season]) => season);
    expect(missing, 'derived seasons with no teams').toEqual([]);
  });

  it('the route exists and is registry-driven rather than league-hardcoded', () => {
    const routePath = path.join(
      repoRoot,
      'src/pages/api/roster-season/[league]/[year].ts',
    );
    expect(fs.existsSync(routePath), 'endpoint route file').toBe(true);
    const src = fs.readFileSync(routePath, 'utf8');
    // Resolves the league through the registry...
    expect(src).toContain('getLeagueBySlug');
    // ...and discovers payload files by glob, so adding a league is data-only.
    expect(src).toContain('import.meta.glob');
    // Rejects a non-year param before it reaches a lookup.
    expect(src).toMatch(/\\d\{4\}/);
  });

  it('the rosters page inlines only live seasons and points at the endpoint', () => {
    const pageSrc = fs.readFileSync(
      path.join(repoRoot, 'src/pages/theleague/rosters.astro'),
      'utf8',
    );
    // The config must carry the endpoint so the client never builds a league
    // path itself, and must serialize the filtered map rather than the full one.
    expect(pageSrc).toContain('seasonEndpoint');
    expect(pageSrc).toContain('seasons: inlineSeasons');
    expect(pageSrc).toContain('liveSeasonKeys');
    // The three deduplicated keys must not come back.
    expect(pageSrc).not.toMatch(/^\s*initialSeasonData,\s*$/m);
    expect(pageSrc).not.toMatch(/^\s*initialTeamData,\s*$/m);
    expect(pageSrc).not.toMatch(/adjustmentsBySeason:\s*adjustmentsBySeasonAllYears/);
  });
});
