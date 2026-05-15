import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  awardKey,
  diffNewAwards,
  buildMilestonePost,
  mergeMilestonePosts,
  phraseFor,
  tierFor,
} from '../scripts/lib/franchise-milestone-posts.mjs';

const pigskins = {
  franchiseId: '0001',
  currentName: 'Pacific Pigskins',
  currentNameMedium: 'Pigskins',
  currentNameShort: 'Pigskins',
};

const dangsters = {
  franchiseId: '0002',
  currentName: 'Da Dangsters',
  currentNameMedium: 'Dangsters',
  currentNameShort: 'Dangsters',
};

const badge = (id: string, awards: Record<string, unknown>[]) => ({
  id,
  name: id,
  description: id,
  icon: '*',
  tier: 'career',
  awards,
});

describe('awardKey', () => {
  it('keys by badge id alone when the award has no year/week', () => {
    expect(awardKey('century-club', { value: 100, suffix: 'wins' })).toBe('century-club');
  });

  it('includes year when present', () => {
    expect(awardKey('top-scorer', { year: 2025 })).toBe('top-scorer:y2025');
  });

  it('includes year + week for single-game records', () => {
    expect(awardKey('all-time-highest-score', { year: 2024, week: 7, score: 220 })).toBe(
      'all-time-highest-score:y2024:w7'
    );
  });

  it('ignores `value` so re-runs that bump a counter do not change the key', () => {
    // 100 wins and 150 wins both produce the same `century-club` key,
    // so the badge only fires the first time it's earned.
    expect(awardKey('century-club', { value: 100 })).toBe(awardKey('century-club', { value: 150 }));
  });
});

describe('diffNewAwards', () => {
  it('treats an empty prev as "every current award is new" (silent-seed is a caller-side concern)', () => {
    // diffNewAwards is pure. The caller in compute-franchise-history.mjs
    // short-circuits when the previous file doesn't exist on disk; tests
    // for that policy live alongside the caller. The pure diff just
    // reports every new award against an empty baseline.
    const next = {
      '0001': { ...pigskins, badges: [badge('century-club', [{ value: 105 }])] },
    };
    expect(diffNewAwards({}, next)).toHaveLength(1);
  });

  it('returns nothing when badges are unchanged', () => {
    const badges = [badge('century-club', [{ value: 105 }])];
    const prev = { '0001': { ...pigskins, badges } };
    const next = { '0001': { ...pigskins, badges } };
    expect(diffNewAwards(prev, next)).toEqual([]);
  });

  it('emits when a franchise earns a brand-new badge', () => {
    const prev = { '0001': { ...pigskins, badges: [] } };
    const next = {
      '0001': { ...pigskins, badges: [badge('century-club', [{ value: 100, suffix: 'wins' }])] },
    };
    const result = diffNewAwards(prev, next);
    expect(result).toHaveLength(1);
    expect(result[0].franchiseId).toBe('0001');
    expect(result[0].badge.id).toBe('century-club');
    expect(result[0].award).toEqual({ value: 100, suffix: 'wins' });
  });

  it('emits one entry per new year-keyed award (e.g. multi-year scoring champ backfill)', () => {
    const prev = { '0001': { ...pigskins, badges: [badge('top-scorer', [{ year: 2010 }])] } };
    const next = {
      '0001': {
        ...pigskins,
        badges: [badge('top-scorer', [{ year: 2010 }, { year: 2022 }, { year: 2025 }])],
      },
    };
    const result = diffNewAwards(prev, next);
    expect(result.map((r) => r.award.year)).toEqual([2022, 2025]);
  });

  it('does not re-fire when a counter-style badge value updates (105 -> 150 wins)', () => {
    const prev = {
      '0001': { ...pigskins, badges: [badge('century-club', [{ value: 105 }])] },
    };
    const next = {
      '0001': { ...pigskins, badges: [badge('century-club', [{ value: 150 }])] },
    };
    expect(diffNewAwards(prev, next)).toEqual([]);
  });

  it('handles badge graduation cleanly: century-club lost, double-century fires', () => {
    const prev = {
      '0001': { ...pigskins, badges: [badge('century-club', [{ value: 198 }])] },
    };
    const next = {
      '0001': { ...pigskins, badges: [badge('double-century', [{ value: 205 }])] },
    };
    const result = diffNewAwards(prev, next);
    expect(result).toHaveLength(1);
    expect(result[0].badge.id).toBe('double-century');
  });

  it('handles record-holder change: previous holder loses (no fire), new holder gains (fires)', () => {
    const prev = {
      '0001': {
        ...pigskins,
        badges: [badge('all-time-highest-score', [{ year: 2010, week: 5, value: 180 }])],
      },
      '0002': { ...dangsters, badges: [] },
    };
    const next = {
      '0001': { ...pigskins, badges: [] },
      '0002': {
        ...dangsters,
        badges: [badge('all-time-highest-score', [{ year: 2026, week: 4, value: 195 }])],
      },
    };
    const result = diffNewAwards(prev, next);
    expect(result).toHaveLength(1);
    expect(result[0].franchiseId).toBe('0002');
    expect(result[0].award.year).toBe(2026);
  });

  it('output is sorted by franchiseId, then badgeId, for stable test snapshots', () => {
    const prev = {};
    const next = {
      '0002': {
        ...dangsters,
        badges: [badge('top-scorer', [{ year: 2025 }]), badge('best-record', [{ year: 2025 }])],
      },
      '0001': { ...pigskins, badges: [badge('century-club', [{ value: 100 }])] },
    };
    // first run skips emission via the silent-seed rule — exercise the
    // ordering by faking a prev with empty badge lists for both.
    const prevSeeded = {
      '0001': { ...pigskins, badges: [] },
      '0002': { ...dangsters, badges: [] },
    };
    const result = diffNewAwards(prevSeeded, next);
    expect(result.map((r) => `${r.franchiseId}:${r.badge.id}`)).toEqual([
      '0001:century-club',
      '0002:best-record',
      '0002:top-scorer',
    ]);
  });
});

describe('buildMilestonePost', () => {
  const now = new Date('2026-05-15T18:00:00Z');

  it('produces a deterministic id (re-run yields the same id)', () => {
    const award = { value: 100, suffix: 'wins' };
    const b = badge('century-club', [award]);
    const a = buildMilestonePost({ franchiseId: '0001', badge: b, award, franchise: pigskins, now });
    const b2 = buildMilestonePost({ franchiseId: '0001', badge: b, award, franchise: pigskins, now });
    expect(a.id).toBe(b2.id);
    expect(a.id).toBe('sf_milestone_0001-century-club');
  });

  it('encodes year + week into the id for single-game records', () => {
    const award = { year: 2026, week: 4, value: 195 };
    const b = badge('all-time-highest-score', [award]);
    const post = buildMilestonePost({ franchiseId: '0002', badge: b, award, franchise: dangsters, now });
    expect(post.id).toBe('sf_milestone_0002-all-time-highest-score-y2026-w4');
  });

  it('uses the team medium-form display name in headline + body', () => {
    const award = { value: 100, suffix: 'wins' };
    const b = badge('century-club', [award]);
    const post = buildMilestonePost({ franchiseId: '0001', badge: b, award, franchise: pigskins, now });
    expect(post.headline).toContain('Pigskins');
    expect(post.body).toContain('Pacific Pigskins');
  });

  it('records `milestone` metadata for renderers / analytics', () => {
    const award = { year: 2025 };
    const b = { ...badge('top-scorer', [award]), name: 'League Scoring Champ', icon: '🚀', tier: 'season' as const };
    const post = buildMilestonePost({ franchiseId: '0001', badge: b, award, franchise: pigskins, now });
    expect(post.milestone).toEqual({
      badgeId: 'top-scorer',
      badgeName: 'League Scoring Champ',
      icon: '🚀',
      tier: 'season',
      awardKey: 'top-scorer:y2025',
      award: { year: 2025 },
    });
  });

  it('sets `type: "transaction"` + `transactionSubType: "milestone"` for renderer compatibility', () => {
    const post = buildMilestonePost({
      franchiseId: '0001',
      badge: badge('century-club', [{ value: 100 }]),
      award: { value: 100 },
      franchise: pigskins,
      now,
    });
    expect(post.type).toBe('transaction');
    expect(post.transactionSubType).toBe('milestone');
    expect(post.authorId).toBe('claude');
    expect(post.league).toBe('theleague');
    expect(post.franchiseIds).toEqual(['0001']);
  });
});

describe('tierFor', () => {
  it('promotes league-wide records to breaking', () => {
    expect(tierFor('all-time-highest-score')).toBe('breaking');
    expect(tierFor('most-active-trader')).toBe('breaking');
    expect(tierFor('perfect-regular-season')).toBe('breaking');
  });

  it('keeps career milestones at standard', () => {
    expect(tierFor('century-club')).toBe('standard');
    expect(tierFor('playoff-legend')).toBe('standard');
  });

  it('drops single-season honors to minor', () => {
    expect(tierFor('top-scorer')).toBe('minor');
    expect(tierFor('best-record')).toBe('minor');
  });
});

describe('phraseFor', () => {
  it('avoids exclamation marks (Iron Rule in personality.md)', () => {
    const text = phraseFor({
      badgeId: 'century-club',
      award: { value: 100 },
      name: 'Pigskins',
      fullName: 'Pacific Pigskins',
    });
    expect(text.headline).not.toContain('!');
    expect(text.body).not.toContain('!');
  });

  it('handles unknown badge ids with a fallback', () => {
    const text = phraseFor({
      badgeId: 'made-up-badge',
      award: { year: 2026 },
      name: 'Pigskins',
      fullName: 'Pacific Pigskins',
    });
    expect(text.headline).toContain('Pigskins');
    expect(text.body).toContain('2026');
  });
});

describe('mergeMilestonePosts', () => {
  const now = new Date('2026-05-15T18:00:00Z');
  const samplePost = (id: string) => ({ id, headline: '', body: '', timestamp: now.toISOString() });

  it('prepends new posts to the existing feed', () => {
    const existing = [samplePost('sf_existing_a')];
    const incoming = [samplePost('sf_milestone_0001-century-club')];
    const { posts, added } = mergeMilestonePosts(existing, incoming);
    expect(added).toBe(1);
    expect(posts[0].id).toBe('sf_milestone_0001-century-club');
    expect(posts[1].id).toBe('sf_existing_a');
  });

  it('dedups against an existing post id', () => {
    const id = 'sf_milestone_0001-century-club';
    const existing = [samplePost(id)];
    const incoming = [samplePost(id)];
    const { posts, added } = mergeMilestonePosts(existing, incoming);
    expect(added).toBe(0);
    expect(posts).toEqual(existing);
  });

  it('handles an empty feed gracefully', () => {
    const incoming = [samplePost('sf_milestone_0001-century-club')];
    const { posts, added } = mergeMilestonePosts([], incoming);
    expect(added).toBe(1);
    expect(posts).toHaveLength(1);
  });
});
