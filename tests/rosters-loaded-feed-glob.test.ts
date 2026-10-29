import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLeagueBySlug } from '../src/config/leagues';
import { globKeyFor, loadFeedGlob } from '../src/utils/rosters/loaded-feed-glob';
import { __setLeagueDataManifestForTests } from '../src/utils/league-data';

/**
 * TheLeague's roster page replaced nine eager `import.meta.glob`s with
 * `loadFeedGlob`, and ~7k lines downstream still read the result by the glob's
 * own keys (`../../../data/<league>/mfl-feeds/<year>/schedule.json`). A key
 * that drifts by one `../` is a silent empty lookup, not an error.
 */
const repoRoot = path.resolve(__dirname, '..');
const DATA = getLeagueBySlug('theleague')!.dataPath;
const PAGE_DIR = 'src/pages/theleague';

beforeEach(() => __setLeagueDataManifestForTests(null));

describe('globKeyFor', () => {
  it('keys a path exactly as Vite keyed the glob in the page', () => {
    expect(globKeyFor(`${DATA}/mfl-feeds/2025/players.json`, PAGE_DIR)).toBe(
      `../../../${DATA}/mfl-feeds/2025/players.json`,
    );
    expect(globKeyFor('src/data/mfl-salary-averages-2025.json', PAGE_DIR)).toBe(
      '../../data/mfl-salary-averages-2025.json',
    );
    expect(globKeyFor('src/pages/theleague/x.json', PAGE_DIR)).toBe('./x.json');
  });
});

describe('loadFeedGlob', () => {
  it('returns the eager-glob shape: relative keys, { default } values, filtered', async () => {
    const out = await loadFeedGlob(`${DATA}/mfl-feeds/*/league.json`, {
      relativeTo: PAGE_DIR,
      keep: (p) => p.includes('/2025/'),
    });
    const key = `../../../${DATA}/mfl-feeds/2025/league.json`;
    expect(Object.keys(out)).toEqual([key]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(repoRoot, DATA, 'mfl-feeds/2025/league.json'), 'utf8'));
    expect((out[key] as { default: unknown }).default).toEqual(onDisk);
  });

  it("returns bare data with importDefault, like the glob's import: 'default'", async () => {
    const out = await loadFeedGlob(`${DATA}/mfl-feeds/*/league.json`, {
      relativeTo: PAGE_DIR,
      keep: (p) => p.includes('/2025/'),
      importDefault: true,
    });
    const value = out[`../../../${DATA}/mfl-feeds/2025/league.json`] as Record<string, unknown>;
    expect(value).toHaveProperty('league');
    expect(value).not.toHaveProperty('default');
  });

  it('matches every season the pattern lists when nothing filters it', async () => {
    const out = await loadFeedGlob('src/data/mfl-salary-averages-*.json', { relativeTo: PAGE_DIR });
    const onDisk = fs.readdirSync(path.join(repoRoot, 'src/data')).filter((f) => /^mfl-salary-averages-.*\.json$/.test(f));
    expect(Object.keys(out).length).toBe(onDisk.length);
    expect(onDisk.length).toBeGreaterThan(5);
  });
});
