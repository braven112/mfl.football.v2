/**
 * Cut Watch GroupMe promo — regression coverage for the July 2026 bug where
 * the daily cut-watch article reached the site feed but never GroupMe.
 *
 * Root cause: scripts/schefter-weekly-articles.mjs only sends a GroupMe promo
 * when the article-type module exports buildGroupMePromo, and cut-watch.mjs
 * didn't define one. These tests pin the export's existence and its contract:
 * teaser stat + absolute link when teams are over the limit, falsy (skip)
 * when everyone is compliant.
 *
 * Also pins the cutdown-plan intel added afterwards: the promo prefers to
 * call out the worst offender WITHOUT a filed auto-cut plan, credits owners
 * who already made their picks, and the fact sheet carries counts only —
 * never the marked players (august-cuts privacy decision #10).
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain .mjs module without type declarations
import { buildGroupMePromo, buildFactSheet, buildPost, blendedCutValue } from '../scripts/article-types/cut-watch.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { isCutWindow } from '../scripts/article-utils/season-guards.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const post = { link: '/theleague/news/sf_2026_cut_watch_0720' };
// Mid cut window (Jul 15 – Aug 16), so the deadline countdown is positive.
const midWindow = new Date('2026-07-20T15:05:00Z');
const opts = { league: 'theleague', now: midWindow };

function rosterPlayers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    status: 'ROSTER',
    salary: String(i + 1),
    contractYear: '1',
  }));
}

function factSheetData() {
  return {
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
    }, opts);

    expect(text).toMatch(/^🚨 CUT WATCH/);
    expect(text).toContain('Midwestside Connection: 6 over the 22-man limit');
    expect(text).toContain('2 teams still need to shed 8 players combined');
    // Deadline is data-driven (3rd Sunday of August = Aug 16 in 2026).
    expect(text).toContain('Cutdown is Aug 16');
    // Canonical (cookie-safe) host — leagueOrigin, never bare domains[0].
    expect(text).toContain('https://www.theleague.us/theleague/news/sf_2026_cut_watch_0720');
  });

  it('picks the worst offender even when enrichment arrives unsorted', () => {
    const text = buildGroupMePromo(post, {
      overLimit: [
        { name: 'Small Fry', count: 24, over: 2 },
        { name: 'Midwestside Connection', count: 28, over: 6 },
      ],
    }, opts);

    expect(text).toContain('Midwestside Connection: 6 over the 22-man limit, the deepest hole in the league');
  });

  it('drops the multi-team spread line when only one team is over', () => {
    const text = buildGroupMePromo(post, {
      overLimit: [{ name: 'Midwestside Connection', count: 25, over: 3 }],
    }, opts);

    expect(text).toContain('Midwestside Connection: 3 over the 22-man limit.');
    expect(text).not.toContain('combined');
    expect(text).not.toContain('deepest hole');
  });

  it('returns null when every team is compliant (no GroupMe buzz on a non-story)', () => {
    expect(buildGroupMePromo(post, { overLimit: [] }, opts)).toBeNull();
    expect(buildGroupMePromo(post, {}, opts)).toBeNull();
    expect(buildGroupMePromo(post, undefined, opts)).toBeNull();
  });

  it('prefers calling out the worst offender WITHOUT a filed plan', () => {
    const text = buildGroupMePromo(post, {
      overLimit: [
        { name: 'Midwestside Connection', count: 28, over: 6, hasPlan: true, markedCount: 6 },
        { name: 'Sleepy Hollow', count: 24, over: 2, hasPlan: false, markedCount: 0 },
      ],
    }, opts);

    // Sleepy Hollow is only 2 over, but they have no plan — they get the heat.
    expect(text).toContain('Sleepy Hollow: 2 over the 22-man limit with NO cutdown plan on file');
    expect(text).not.toContain('deepest hole');
    // The planners get credit, not the spotlight.
    expect(text).toContain('1 has already made their picks');
  });

  it('acknowledges a lone over-limit team whose plan is already filed', () => {
    const text = buildGroupMePromo(post, {
      overLimit: [{ name: 'Midwestside Connection', count: 25, over: 3, hasPlan: true, markedCount: 3 }],
    }, opts);

    expect(text).toContain('Midwestside Connection: 3 over the 22-man limit.');
    expect(text).toContain('plan is already filed');
  });

  it('skips the promo entirely when the deadline has already passed', () => {
    const afterDeadline = new Date('2026-08-20T15:05:00Z'); // cutdown was Aug 16
    const text = buildGroupMePromo(post, {
      overLimit: [{ name: 'Midwestside Connection', count: 25, over: 3 }],
    }, { league: 'theleague', now: afterDeadline });

    expect(text).toBeNull();
  });
});

describe('buildFactSheet (cut-watch)', () => {
  it('surfaces over-limit teams sorted worst-first with plan status', async () => {
    // 9902 is 6 over with all 6 marked (FILED); 9901 is 3 over with only 2
    // marked (PARTIAL — hasPlan false: a plan that doesn't cover the overage
    // still leaves cuts to the auto-picker, so the owner stays call-out
    // eligible).
    const { factSheet, enrichment } = await buildFactSheet(factSheetData(), null, 2026, repoRoot, {
      cutdownPlans: new Map([['9902', 6], ['9901', 2]]),
      adp: null,
    });

    expect(enrichment.overLimit).toEqual([
      { name: 'Team 9902', count: 28, over: 6, hasPlan: true, markedCount: 6 },
      { name: 'Team 9901', count: 25, over: 3, hasPlan: false, markedCount: 2 },
    ]);

    // Counts only, never marked player ids (privacy decision #10).
    expect(factSheet).toContain('Cutdown plan: FILED — this owner has already marked 6 players');
    expect(factSheet).toContain('covers the overage');
    expect(factSheet).toContain('Cutdown plan: PARTIAL — 2 of 3 needed cuts marked');
  });

  it('reports NONE ON FILE when an over-limit owner has marked nothing', async () => {
    const { factSheet, enrichment } = await buildFactSheet(factSheetData(), null, 2026, repoRoot, {
      cutdownPlans: new Map([['9902', 0], ['9901', 0]]),
      adp: null,
    });

    expect(enrichment.overLimit.every((t: { hasPlan: boolean }) => t.hasPlan === false)).toBe(true);
    expect(factSheet).toContain('Cutdown plan: NONE ON FILE — this owner has not made their picks; all 6 cuts would be auto-chosen');
  });

  it('runs cleanly without plan intel (Redis unavailable)', async () => {
    const { factSheet, enrichment } = await buildFactSheet(factSheetData(), null, 2026, repoRoot, {
      cutdownPlans: null,
      adp: null,
    });

    expect(factSheet).not.toContain('Cutdown plan:');
    expect(enrichment.overLimit).toEqual([
      { name: 'Team 9902', count: 28, over: 6, hasPlan: null, markedCount: null },
      { name: 'Team 9901', count: 25, over: 3, hasPlan: null, markedCount: null },
    ]);
  });

  it('ranks cut candidates by weakest combined value, not salary', async () => {
    const data = {
      players: { players: { player: [] } },
      rosters: {
        rosters: {
          // 23 active = 1 over → 3 candidates surfaced.
          franchise: [{ id: '9901', player: rosterPlayers(23) }],
        },
      },
    };
    // p22 = highest salary but in NO ADP list (unranked → most cuttable).
    // p0 = cheapest player but a stud (ADP 5) → must NOT be a candidate.
    // Everyone else sits at ADP 120 except p10 (ADP 200, next-weakest).
    const redraft = new Map<string, number>();
    const dynasty = new Map<string, number>();
    for (let i = 0; i < 22; i++) {
      const pick = i === 0 ? 5 : i === 10 ? 200 : 120;
      redraft.set(`p${i}`, pick);
      dynasty.set(`p${i}`, pick);
    }

    const { factSheet } = await buildFactSheet(data, null, 2026, repoRoot, {
      cutdownPlans: null,
      adp: { redraft, dynasty },
    });

    const candidateLines = factSheet.split('\n').filter((l: string) => l.trim().startsWith('- '));
    expect(candidateLines[0]).toContain('Player p22');
    expect(candidateLines[0]).toContain('UNRANKED');
    expect(candidateLines[1]).toContain('Player p10');
    expect(candidateLines[1]).toContain('combined ADP 200.0');
    expect(factSheet).not.toMatch(/- .*Player p0 /);
    expect(factSheet).toContain('Likely cut candidates (weakest combined value first):');
    expect(factSheet).toContain('blended by contract length');
  });
});

describe('isCutWindow', () => {
  it('runs through the actual cutdown day (3rd Sunday of August), not a fixed Aug 16', () => {
    expect(isCutWindow(new Date(2028, 7, 20))).toBe(true);  // 2028 cutdown = Aug 20
    expect(isCutWindow(new Date(2028, 7, 21))).toBe(false);
    expect(isCutWindow(new Date(2026, 7, 16))).toBe(true);  // 2026 cutdown = Aug 16
    expect(isCutWindow(new Date(2026, 7, 17))).toBe(false);
    expect(isCutWindow(new Date(2026, 6, 15))).toBe(true);  // opens Jul 15
    expect(isCutWindow(new Date(2026, 6, 14))).toBe(false);
  });
});

describe('buildPost (cut-watch)', () => {
  const aiOutput = { headline: 'H', excerpt: 'E', content: ['<p>x</p>'] };

  it('derives link and league from the passed league (runner passes { league })', () => {
    const post = buildPost(aiOutput, {}, 'sf_2026_cut_watch_0726', { league: 'afl-fantasy' });
    expect(post.link).toBe('/afl-fantasy/news/sf_2026_cut_watch_0726');
    expect(post.league).toBe('afl-fantasy');
  });

  it('defaults to TheLeague when no league is passed', () => {
    const post = buildPost(aiOutput, {}, 'sf_2026_cut_watch_0726');
    expect(post.link).toBe('/theleague/news/sf_2026_cut_watch_0726');
    expect(post.league).toBe('theleague');
  });
});

describe('blendedCutValue', () => {
  it('is pure redraft at 1 year and pure dynasty at 5 years', () => {
    expect(blendedCutValue({ redraftAdp: 100, dynastyAdp: 200, contractYears: 1 }).blended).toBe(100);
    expect(blendedCutValue({ redraftAdp: 100, dynastyAdp: 200, contractYears: 5 }).blended).toBe(200);
  });

  it('mixes linearly in between (3yr = 50/50)', () => {
    const v = blendedCutValue({ redraftAdp: 100, dynastyAdp: 200, contractYears: 3 });
    expect(v.blended).toBe(150);
    expect(v.dynastyWeight).toBe(0.5);
    expect(blendedCutValue({ redraftAdp: 100, dynastyAdp: 200, contractYears: 2 }).blended).toBe(125);
    expect(blendedCutValue({ redraftAdp: 100, dynastyAdp: 200, contractYears: 4 }).blended).toBe(175);
  });

  it('clamps contract years outside 1-5', () => {
    expect(blendedCutValue({ redraftAdp: 100, dynastyAdp: 200, contractYears: 0 }).blended).toBe(100);
    expect(blendedCutValue({ redraftAdp: 100, dynastyAdp: 200, contractYears: 9 }).blended).toBe(200);
  });

  it('falls back to the available list when one side is missing', () => {
    expect(blendedCutValue({ redraftAdp: 80, dynastyAdp: undefined, contractYears: 5 }).blended).toBe(80);
    expect(blendedCutValue({ redraftAdp: undefined, dynastyAdp: 90, contractYears: 1 }).blended).toBe(90);
  });

  it('returns null blended when the player is in neither list', () => {
    expect(blendedCutValue({ redraftAdp: undefined, dynastyAdp: undefined, contractYears: 3 }).blended).toBeNull();
  });
});
