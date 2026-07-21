/**
 * Cut Watch GroupMe promo — regression coverage for the July 2026 bug where
 * the daily cut-watch article reached the site feed but never GroupMe.
 *
 * Root cause: scripts/schefter-weekly-articles.mjs only sends a GroupMe promo
 * when the article-type module exports buildGroupMePromo, and cut-watch.mjs
 * didn't define one. These tests pin the export's existence and its contract:
 * teaser stat + absolute link when teams are over the limit, falsy (skip)
 * when everyone is compliant.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain .mjs module without type declarations
import { buildGroupMePromo, buildFactSheet } from '../scripts/article-types/cut-watch.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const post = { link: '/theleague/news/sf_2026_cut_watch_0720' };
// Mid cut window (Jul 15 – Aug 16), so the deadline countdown is positive.
const midWindow = new Date('2026-07-20T15:05:00Z');

function rosterPlayers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    status: 'ROSTER',
    salary: String(i + 1),
    contractYear: '1',
  }));
}

describe('buildGroupMePromo (cut-watch)', () => {
  it('is exported — the runner only posts to GroupMe when this export exists', () => {
    expect(typeof buildGroupMePromo).toBe('function');
  });

  it('leads with the worst offender and links the article on the public origin', () => {
    const text = buildGroupMePromo(post, {
      overLimit: [
        { name: 'Midwestside Connection', count: 28, over: 6 },
        { name: 'Team 0002', count: 24, over: 2 },
      ],
    }, { league: 'theleague', now: midWindow });

    expect(text).toMatch(/^🚨 CUT WATCH/);
    expect(text).toContain('Midwestside Connection: 6 over the 22-man limit');
    expect(text).toContain('2 teams still need to shed 8 players combined');
    // Deadline is data-driven (3rd Sunday of August = Aug 16 in 2026).
    expect(text).toContain('Cutdown is Aug 16');
    expect(text).toMatch(/https:\/\/[a-z0-9.-]+\/theleague\/news\/sf_2026_cut_watch_0720/);
  });

  it('drops the multi-team spread line when only one team is over', () => {
    const text = buildGroupMePromo(post, {
      overLimit: [{ name: 'Midwestside Connection', count: 25, over: 3 }],
    }, { league: 'theleague', now: midWindow });

    expect(text).toContain('Midwestside Connection: 3 over the 22-man limit.');
    expect(text).not.toContain('combined');
    expect(text).not.toContain('deepest hole');
  });

  it('returns null when every team is compliant (no GroupMe buzz on a non-story)', () => {
    expect(buildGroupMePromo(post, { overLimit: [] }, { league: 'theleague', now: midWindow })).toBeNull();
    expect(buildGroupMePromo(post, {}, { league: 'theleague', now: midWindow })).toBeNull();
    expect(buildGroupMePromo(post, undefined, { league: 'theleague', now: midWindow })).toBeNull();
  });
});

describe('buildFactSheet enrichment (cut-watch)', () => {
  it('surfaces over-limit teams sorted worst-first for the promo', async () => {
    const data = {
      players: { players: { player: [{ id: 'p0', name: 'Smith, John', position: 'RB', team: 'FA' }] } },
      rosters: {
        rosters: {
          franchise: [
            { id: '9901', player: rosterPlayers(25) }, // 3 over
            { id: '9902', player: rosterPlayers(28) }, // 6 over
            { id: '9903', player: rosterPlayers(20) }, // under
            { id: '9904', player: rosterPlayers(22) }, // at limit
          ],
        },
      },
    };

    const { enrichment } = await buildFactSheet(data, null, 2026, repoRoot);
    expect(enrichment.overLimit).toEqual([
      { name: 'Team 9902', count: 28, over: 6 },
      { name: 'Team 9901', count: 25, over: 3 },
    ]);
  });
});
