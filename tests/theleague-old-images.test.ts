import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import report from '../scripts/inmotion-migration/theleague-report.json';
import { resolveLeagueRewrite } from '../src/utils/league-host-map';

/**
 * TheLeague's 2011-2024 MFL seasons load franchise art from
 * theleague.us/images/…, which src/pages/theleague/images/[...path].ts serves
 * from Blob. This pins that the old URLs reach that route and that every one
 * the synced feeds name was copied.
 */
const FEEDS = path.resolve(__dirname, '../data/theleague/mfl-feeds');

function feedImagePaths(): Set<string> {
  const found = new Set<string>();
  for (const year of readdirSync(FEEDS)) {
    let text: string;
    try {
      text = readFileSync(path.join(FEEDS, year, 'league.json'), 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/https?:\/\/(?:www\.)?theleague\.us(\/images\/[^"\s]+)/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

describe('TheLeague old /images URLs', () => {
  it('rewrite to the theleague images route on both theleague.us hosts', () => {
    for (const host of ['theleague.us', 'www.theleague.us']) {
      expect(resolveLeagueRewrite(host, '/images/team_banners/x.png')?.newPath).toBe(
        '/theleague/images/team_banners/x.png',
      );
    }
  });

  it('were all copied to Blob', () => {
    const copied = new Set(report.files.filter((f) => f.status === 'blob').map((f) => f.path));
    const missing = [...feedImagePaths()].filter((p) => !copied.has(p));
    expect(missing).toEqual([]);
  });
});

describe('TheLeague old /images URLs on mfl.football', () => {
  // Some TheLeague seasons on MFL name mfl.football/images/… instead of
  // theleague.us/images/… (both hosts served one InMotion folder). The
  // missed-files report caught the_league_commish.png falling through to the
  // InMotion backup that way, so the root route must answer from the same copy.
  it('redirects a copied file to its Blob copy', async () => {
    const { GET } = await import('../src/pages/images/[...path].ts');
    const url = new URL('https://mfl.football/images/team_banners/the_league_commish.png');
    const res = (await GET({
      params: { path: 'team_banners/the_league_commish.png' },
      url,
      request: new Request(url),
      rewrite: () => {
        throw new Error('should not rewrite a copied file');
      },
    } as never)) as Response;
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe(
      `${report.blobHost}/${report.blobPrefix}/images/team_banners/the_league_commish.png`,
    );
  });
});
