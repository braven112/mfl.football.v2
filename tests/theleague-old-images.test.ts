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
