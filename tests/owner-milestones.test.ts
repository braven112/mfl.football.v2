import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  OWNER_MILESTONES,
  MAX_NEW_PER_RUN,
  careerStats,
  heldMilestones,
  newMilestones,
  milestoneText,
  allHeldKeys,
  buildOwnerMilestonePost,
  legacyFeedPostId,
} from '../scripts/lib/owner-milestones.mjs';
import { feedEligibleAwards, OWNER_SCOPED_BADGES } from '../scripts/lib/franchise-milestone-posts.mjs';
import { milestoneLeagues, MILESTONE_KIND, claimKey } from '../scripts/post-owner-milestones.mjs';
import { isExempt } from '../scripts/lib/groupme-day-plan.mjs';

const ROOT = path.resolve(__dirname, '..');

const season = (year: number, extra: Record<string, unknown> = {}) => ({ year, ...extra });

const owner = (over: Record<string, any> = {}) => ({
  ownerId: 'own-0001',
  slug: 'bring-the-pain-2007',
  displayName: 'Todd Gibel',
  isCurrent: true,
  yearStart: 2007,
  identities: [{ name: 'Bring The Pain', nameMedium: 'Bring The Pain', yearEnd: 2026 }],
  tenures: [{ seasons: Array.from({ length: 20 }, (_, i) => season(2007 + i)) }],
  totals: { wins: 200, losses: 148, ties: 0, playoffAppearances: 14 },
  ...over,
});

describe('which milestones an owner holds', () => {
  it('reads the OWNER totals, not a franchise', () => {
    const ids = heldMilestones(owner()).map((m) => m.id);
    expect(ids).toEqual(['wins-100', 'wins-200', 'playoffs-5', 'playoffs-10', 'seasons-10']);
  });

  it('does not count an unstarted, rolled-over season', () => {
    const o = owner({
      tenures: [{ seasons: [...Array.from({ length: 9 }, (_, i) => season(2017 + i)), season(2026, { seasonNotStarted: true })] }],
    });
    expect(careerStats(o).seasons).toBe(9);
    expect(heldMilestones(o).map((m) => m.id)).not.toContain('seasons-10');
  });

  it('never renames a milestone id (the id is the dedupe key)', () => {
    expect(OWNER_MILESTONES.map((m) => m.id)).toEqual([
      'wins-100', 'wins-200', 'wins-300', 'playoffs-5', 'playoffs-10', 'seasons-10',
    ]);
  });
});

describe('what is new', () => {
  const tenures = { owners: [owner()] };

  it('is held now and absent from the baseline', () => {
    const baseline = allHeldKeys(tenures).filter((k: string) => k !== 'own-0001:wins-200');
    expect(newMilestones(tenures, baseline).map((f) => f.key)).toEqual(['own-0001:wins-200']);
  });

  it('is nothing when the baseline already has it all', () => {
    expect(newMilestones(tenures, allHeldKeys(tenures))).toEqual([]);
  });

  it('skips former owners — their numbers cannot move', () => {
    expect(newMilestones({ owners: [owner({ isCurrent: false })] }, [])).toEqual([]);
  });

  it('caps a run so a broken input cannot flood the chat', () => {
    expect(MAX_NEW_PER_RUN).toBeLessThanOrEqual(5);
  });
});

describe('the chat text', () => {
  const wins200 = OWNER_MILESTONES.find((m) => m.id === 'wins-200')!;

  it('leads with the TEAM name, gives the owner record, and ends on the link', () => {
    const text = milestoneText({
      owner: owner(),
      milestone: wins200,
      ownerUrl: 'https://www.theleague.us/owners/bring-the-pain-2007',
    });
    expect(text.split('\n')[0]).toBe('MILESTONE: Bring The Pain hits 200 career wins.');
    expect(text).toContain('Todd Gibel, owner since 2007, is 200-148 all time');
    expect(text).not.toContain('!');
    expect(text.split('\n').at(-1)).toBe('https://www.theleague.us/owners/bring-the-pain-2007');
  });
});

describe('the feed post', () => {
  const wins200 = OWNER_MILESTONES.find((m) => m.id === 'wins-200')!;
  const now = new Date('2026-11-26T20:30:00Z');

  it('has a stable id per league + owner + milestone, and links the owner page', () => {
    const league = { slug: 'theleague', navSlug: 'theleague' };
    const a = buildOwnerMilestonePost({ league, owner: owner(), milestone: wins200, now });
    const b = buildOwnerMilestonePost({ league, owner: owner(), milestone: wins200, now: new Date() });
    expect(a.id).toBe(b.id);
    expect(a.id).toBe('sf_milestone_owner_theleague_own-0001_wins-200');
    expect(a.headline).toBe('Bring The Pain hits 200 career wins');
    expect(a.link).toBe('/theleague/owners/bring-the-pain-2007');
    expect(a.transactionSubType).toBe('milestone');
    expect(a.milestone.tier).toBe('career');
  });

  it('keys the AFL post by its own league, since both leagues have an own-0001', () => {
    const afl = buildOwnerMilestonePost({ league: { slug: 'afl-fantasy', navSlug: 'afl' }, owner: owner(), milestone: wins200, now });
    expect(afl.id).not.toBe('sf_milestone_owner_theleague_own-0001_wins-200');
    expect(afl.link).toBe('/afl-fantasy/owners/bring-the-pain-2007');
  });

  it('recognizes the franchise post the old lane already wrote for the same mark', () => {
    expect(legacyFeedPostId('0008', 'wins-200')).toBe('sf_milestone_0008-double-century');
  });
});

describe('the franchise lane hands career marks to the owner lane', () => {
  const award = (id: string) => ({ franchiseId: '0001', badge: { id }, award: {} });

  it('no longer posts career wins, playoff trips or seasons per franchise', () => {
    const kept = feedEligibleAwards([award('double-century'), award('playoff-legend'), award('top-scorer')]);
    expect(kept.map((a: any) => a.badge.id)).toEqual(['top-scorer']);
  });

  it('covers every owner milestone with its old franchise badge', () => {
    for (const m of OWNER_MILESTONES) {
      const legacy = legacyFeedPostId('0001', m.id)!.replace('sf_milestone_0001-', '');
      expect(OWNER_SCOPED_BADGES.has(legacy), m.id).toBe(true);
    }
  });
});

describe('the lane', () => {
  it('is exempt from the one-post-a-day cap', () => {
    expect(isExempt(MILESTONE_KIND)).toBe(true);
  });

  it('runs for both GroupMe leagues, and each has a baseline', () => {
    const baseline = JSON.parse(readFileSync(path.join(ROOT, 'src/data/owner-milestones-baseline.json'), 'utf8'));
    const slugs = milestoneLeagues().map((l: any) => l.slug);
    expect(slugs).toEqual(expect.arrayContaining(['theleague', 'afl-fantasy']));
    for (const slug of slugs) expect(Array.isArray(baseline[slug]), slug).toBe(true);
  });

  it('keys the dedupe per league, since both leagues have an own-0001', () => {
    expect(claimKey('theleague', 'own-0001:wins-200')).not.toBe(claimKey('afl', 'own-0001:wins-200'));
  });

  it('is wired into the derived chain lane, after the commit, default branch only', () => {
    const wf = readFileSync(path.join(ROOT, '.github/workflows/derived-history-chain.yml'), 'utf8');
    const commit = wf.indexOf('commit-feed-and-push.mjs');
    const post = wf.indexOf('post-owner-milestones.mjs');
    expect(post).toBeGreaterThan(commit);
    expect(wf.slice(commit, post)).toContain('github.event.repository.default_branch');
  });
});
