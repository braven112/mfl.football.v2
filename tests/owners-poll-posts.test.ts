/**
 * Reveal payloads: per-voter push and the Schefter feed post
 * (scripts/lib/owners-poll-posts.mjs).
 */
import { describe, it, expect } from 'vitest';
import {
  buildVoterPushes,
  buildOpenPushes,
  buildNagPushes,
  buildRevealFeedPost,
  buildCallback,
  upsertFeedPost,
} from '../scripts/lib/owners-poll-posts.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const LEAGUE = LEAGUES.theleague;
const FIELD = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));
const teams = new Map(FIELD.map((fid, i) => [fid, { nameMedium: `Team ${i + 1}` }]));

function issue(over: Record<string, any> = {}) {
  return {
    year: 2026,
    week: 5,
    rankings: FIELD.map((franchiseId, i) => ({ franchiseId, rank: i + 1 })),
    ownersPoll: {
      status: 'closed',
      ballotsIn: 3,
      eligibleVoters: 16,
      ranked: [
        { rank: 1, franchiseId: '0001', points: 20, firstPlaceVotes: 2, delta: 0 },
        { rank: 2, franchiseId: '0002', points: 15, firstPlaceVotes: 1, delta: 5 },
        { rank: 3, franchiseId: '0003', points: 10, firstPlaceVotes: 0, delta: -1 },
      ],
      unranked: [],
      ballots: [
        { franchiseId: '0001', ranking: ['0001', '0002', '0003'], homerIndex: 0, contrarianIndex: 1 },
        { franchiseId: '0002', ranking: ['0002', '0001', '0003'], homerIndex: 4, contrarianIndex: 2 },
        { franchiseId: '0009', ranking: ['0001', '0002', '0003'], homerIndex: null, contrarianIndex: 1 },
      ],
      nonVoterCount: 13,
      ...over,
    },
  };
}

describe('buildVoterPushes', () => {
  it('sends one push per VOTER and none to anyone else', () => {
    // A "you missed it" push is a nag with no information in it. The absence
    // is the nudge: non-voters watch the chat compare numbers they don't have.
    const pushes = buildVoterPushes({ league: LEAGUE, issue: issue(), teams });
    expect(pushes.map((p: any) => p.franchiseId).sort()).toEqual(['0001', '0002', '0009']);
    expect(pushes.some((p: any) => p.franchiseId === '0005')).toBe(false);
  });

  it('tells each owner where the room put THEIR team', () => {
    const pushes = buildVoterPushes({ league: LEAGUE, issue: issue(), teams });
    const second = pushes.find((p: any) => p.franchiseId === '0002')!;
    expect(second.body).toContain('2nd');
    expect(second.body).toMatch(/5 spots higher than the computer/);
  });

  it('says so plainly when nobody ranked the voter', () => {
    // The more interesting message, not a gap to paper over.
    const pushes = buildVoterPushes({ league: LEAGUE, issue: issue(), teams });
    const unranked = pushes.find((p: any) => p.franchiseId === '0009')!;
    expect(unranked.body).toMatch(/nobody put you on a ballot/i);
  });

  it('calls out a homer, and only a homer', () => {
    const pushes = buildVoterPushes({ league: LEAGUE, issue: issue(), teams });
    expect(pushes.find((p: any) => p.franchiseId === '0002')!.body).toMatch(/yourself 4 higher/);
    expect(pushes.find((p: any) => p.franchiseId === '0001')!.body).not.toMatch(/higher than they did/);
  });

  it('reports last week\'s accuracy once this week can score it', () => {
    // Accuracy needs the FOLLOWING week, so the reveal is the first moment it
    // can be known — which makes it the natural place to say it.
    const previousIssue = {
      ownersPoll: {
        ballots: [{ franchiseId: '0001', ranking: ['0001', '0002', '0003'] }],
      },
    };
    const pushes = buildVoterPushes({ league: LEAGUE, issue: issue(), teams, previousIssue });
    expect(pushes.find((p: any) => p.franchiseId === '0001')!.body).toContain('100% accurate');
    // Nothing invented for a voter with no prior ballot.
    expect(pushes.find((p: any) => p.franchiseId === '0002')!.body).not.toMatch(/accurate/);
  });

  it('collapses re-runs with a per-week tag', () => {
    const pushes = buildVoterPushes({ league: LEAGUE, issue: issue(), teams });
    expect(new Set(pushes.map((p: any) => p.tag))).toEqual(new Set(['owners-poll-2026-5']));
  });

  it('sends nothing when nobody voted, or before the poll closes', () => {
    expect(
      buildVoterPushes({ league: LEAGUE, issue: issue({ ranked: null, ballotsIn: 0, ballots: [] }), teams }),
    ).toEqual([]);
    expect(buildVoterPushes({ league: LEAGUE, issue: issue({ status: 'open' }), teams })).toEqual([]);
  });
});

describe('buildRevealFeedPost', () => {
  it('builds a power-ranking post with a stable per-week id', () => {
    const post = buildRevealFeedPost({ league: LEAGUE, issue: issue(), teams })!;
    expect(post.id).toBe('sf_owners_poll_theleague_2026_w5');
    expect(post.type).toBe('power-ranking');
    expect(post.league).toBe('theleague');
    expect(post.link).toBe('/pecking-order/2026/5');
    expect(post.headline).toContain('Team 1');
  });

  it('tags only the named franchises, never the whole league', () => {
    // A post tagged with all 16 is noise on every franchise page.
    const post = buildRevealFeedPost({ league: LEAGUE, issue: issue(), teams })!;
    expect((post.franchiseIds as string[]).length).toBeLessThan(6);
    expect(post.franchiseIds).toContain('0001');
    expect(post.franchiseIds).toContain('0002'); // biggest split AND the homer
  });

  it('writes NO post for a week nobody voted in', () => {
    // The feed is a durable record. "Nobody used the feature" is not a record
    // worth keeping on every owner's homepage — same call as the chat post.
    expect(
      buildRevealFeedPost({
        league: LEAGUE,
        issue: issue({ ranked: null, ballotsIn: 0, ballots: [] }),
        teams,
      }),
    ).toBeNull();
  });

  it('still posts a light week — four ballots is a result, not a failure', () => {
    const post = buildRevealFeedPost({ league: LEAGUE, issue: issue({ ballotsIn: 4 }), teams })!;
    expect(post.headline).toContain('Team 1');
    expect(post.body).not.toMatch(/quorum|came up short|no consensus/i);
  });

  it('returns null before the poll closes', () => {
    expect(buildRevealFeedPost({ league: LEAGUE, issue: issue({ status: 'open' }), teams })).toBeNull();
  });
});

describe('upsertFeedPost', () => {
  it('adds a new post at the top', () => {
    const feed = { posts: [{ id: 'old' }] };
    const next = upsertFeedPost(feed, { id: 'new' });
    expect(next.posts.map((p: any) => p.id)).toEqual(['new', 'old']);
  });

  it('REPLACES a post with the same id rather than duplicating it', () => {
    // A re-run of the close pass must not leave two poll posts for one week.
    const feed = { posts: [{ id: 'a', headline: 'first' }, { id: 'b' }] };
    const next = upsertFeedPost(feed, { id: 'a', headline: 'second' });
    expect(next.posts).toHaveLength(2);
    expect(next.posts[0]).toMatchObject({ id: 'a', headline: 'second' });
  });

  it('preserves the rest of the feed document', () => {
    const feed = { lastScanTimestamp: 'x', posts: [] };
    expect(upsertFeedPost(feed, { id: 'a' }).lastScanTimestamp).toBe('x');
  });
});

describe('buildCallback', () => {
  /** An issue whose column ranks the field in the given order. */
  const columnOf = (week: number, order: string[]) => ({
    year: 2026,
    week,
    rankings: order.map((franchiseId, i) => ({ franchiseId, rank: i + 1 })),
  });

  /** A closed poll that ranked `ranked` and left `unranked` off. */
  const pollOf = (week: number, ranked: string[], unranked: string[]) => ({
    year: 2026,
    week,
    rankings: [...ranked, ...unranked].map((franchiseId, i) => ({ franchiseId, rank: i + 1 })),
    ownersPoll: {
      status: 'closed',
      hasQuorum: true,
      ranked: ranked.map((franchiseId, i) => ({ rank: i + 1, franchiseId, delta: 0 })),
      unranked: unranked.map((franchiseId, i) => ({ franchiseId, compositeRank: ranked.length + i + 1 })),
    },
  });

  it('uses the sharpest line when nobody ranked the team at all', () => {
    // "Not one owner put them on a ballot" is an argument; "had them 9th" is a
    // statistic. Prefer the argument when it's true.
    //
    // Realistic 16-team field: 0016 sat 8th of the unranked block in Week 5
    // (rank 15 overall) and leads the column now — a 14-spot swing.
    const ranked = FIELD.slice(0, 7);
    const unranked = FIELD.slice(7);
    const text = buildCallback({
      issue: columnOf(8, ['0016', ...FIELD.filter((f) => f !== '0016')]),
      priorIssues: [pollOf(5, ranked, unranked)],
      teams,
    })!;
    expect(text).toMatch(/not one owner put team 16 on a week 5 ballot/i);
    expect(text).toContain('1st now');
  });

  it('quotes the rank when the team WAS ranked, just wrongly', () => {
    const text = buildCallback({
      issue: columnOf(8, ['0007', ...FIELD.filter((f) => f !== '0007')]),
      priorIssues: [pollOf(5, FIELD.slice(0, 7), FIELD.slice(7))],
      teams,
    })!;
    expect(text).toMatch(/the room had team 7 7th in week 5/i);
    expect(text).toMatch(/1st now/);
  });

  it('ignores last week — something has to have had time to change', () => {
    expect(
      buildCallback({
        issue: columnOf(6, ['0016', ...FIELD.filter((f) => f !== '0016')]),
        priorIssues: [pollOf(5, FIELD.slice(0, 7), FIELD.slice(7))],
        teams,
      }),
    ).toBeNull();
  });

  it('stays quiet when nothing moved enough to be worth saying', () => {
    // Same order in both weeks: nothing to call back to.
    expect(
      buildCallback({
        issue: columnOf(8, FIELD),
        priorIssues: [pollOf(5, FIELD.slice(0, 7), FIELD.slice(7))],
        teams,
      }),
    ).toBeNull();
  });

  it('skips weeks with no published consensus', () => {
    // No consensus means there is no "the room" to have been wrong.
    const noQuorum = pollOf(5, FIELD.slice(0, 7), FIELD.slice(7));
    (noQuorum.ownersPoll as any).ranked = null;
    expect(
      buildCallback({
        issue: columnOf(8, ['0016', ...FIELD.filter((f) => f !== '0016')]),
        priorIssues: [noQuorum],
        teams,
      }),
    ).toBeNull();
  });

  it('picks the biggest swing across every eligible earlier week', () => {
    // Week 5 put 0016 8th of 16; Week 6 put it last. Now it is 1st, so Week 6
    // is the bigger swing and the one worth quoting.
    const text = buildCallback({
      issue: columnOf(9, ['0016', ...FIELD.filter((f) => f !== '0016')]),
      priorIssues: [
        // Week 5 ranked it 7th (a 6-spot swing) …
        pollOf(5, [...FIELD.slice(0, 6), '0016'], FIELD.slice(6).filter((f) => f !== '0016')),
        // … Week 6 left it dead last (a 15-spot swing), so Week 6 is the story.
        pollOf(6, FIELD.slice(0, 7), [...FIELD.slice(7).filter((f) => f !== '0016'), '0016']),
      ],
      teams,
    })!;
    expect(text).toContain('Team 16');
    expect(text).toContain('Week 6');
  });

  it('returns null with no prior polls at all', () => {
    expect(buildCallback({ issue: columnOf(3, ['0001']), priorIssues: [], teams })).toBeNull();
  });
});

describe('reveal post carries the callback', () => {
  it('appends the callback sentence when there is one', () => {
    // 0001 leads the column in `issue()`, but Week 2's room left it off every
    // ballot — a 15-spot swing, comfortably worth a callback.
    const prior = {
      year: 2026,
      week: 2,
      rankings: FIELD.map((franchiseId, i) => ({ franchiseId, rank: i + 1 })),
      ownersPoll: {
        status: 'closed',
        hasQuorum: true,
        ranked: FIELD.slice(1, 8).map((franchiseId, i) => ({ rank: i + 1, franchiseId, delta: 0 })),
        unranked: [...FIELD.slice(8), '0001'].map((franchiseId, i) => ({
          franchiseId,
          compositeRank: 8 + i,
        })),
      },
    };
    const post = buildRevealFeedPost({
      league: LEAGUE,
      issue: issue(),
      teams,
      priorIssues: [prior],
    })!;
    expect(post.body).toMatch(/week 2/i);
  });
});

describe('buildOpenPushes', () => {
  const openIssue = {
    year: 2026,
    week: 5,
    rankings: FIELD.map((franchiseId, i) => ({ franchiseId, rank: i + 1 })),
    ownersPoll: { status: 'open', slots: 7, closesAt: '2026-09-10T23:00:00.000Z' },
  };

  it('goes to EVERY owner — at open there are no voters yet', () => {
    const pushes = buildOpenPushes({ issue: openIssue, teams, eligibleFranchiseIds: FIELD });
    expect(pushes).toHaveLength(16);
    expect(pushes.map((p: any) => p.franchiseId)).toEqual(FIELD);
  });

  it('leads with the disagreement bait and names the result time', () => {
    const pushes = buildOpenPushes({ issue: openIssue, teams, eligibleFranchiseIds: FIELD });
    expect(pushes[0].body).toContain('Team 1');
    expect(pushes[0].body).toContain('Team 16');
    expect(pushes[0].body).toMatch(/always open/i);
    expect(pushes[0].body).toMatch(/Thursday/);
    expect(pushes[0].url).toContain('/pecking-order/ballot');
  });

  it('sends nothing once the poll is closed', () => {
    expect(
      buildOpenPushes({
        issue: { ...openIssue, ownersPoll: { status: 'closed', slots: 7 } },
        teams,
        eligibleFranchiseIds: FIELD,
      }),
    ).toEqual([]);
  });
});

describe('buildNagPushes — the "still good?" prompt', () => {
  const WEEK = 5;
  const CLOSES = '2026-09-10T23:00:00.000Z';
  const NOW = new Date('2026-09-09T12:00:00.000Z');
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 86400 * 1000).toISOString();

  const send = (standing: Array<{ franchiseId: string; updatedAt: string | null; stale?: boolean }>) =>
    buildNagPushes({ week: WEEK, closesAt: CLOSES, standing, now: NOW }) as any[];

  it('asks the owners whose ballot has gone stale', () => {
    const pushes = send([
      { franchiseId: '0001', updatedAt: daysAgo(25), stale: true },
      { franchiseId: '0002', updatedAt: daysAgo(1), stale: false },
    ]);
    expect(pushes.map((p) => p.franchiseId)).toEqual(['0001']);
    expect(pushes[0].body).toMatch(/3 weeks old/);
    expect(pushes[0].body).toMatch(/still how you see it/i);
  });

  it('also reaches an owner who has never voted', () => {
    const pushes = send([{ franchiseId: '0007', updatedAt: null, stale: false }]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body).toMatch(/no ballot on file/i);
  });

  it('does NOT ask a never-voter whether their ballot still stands', () => {
    // It shipped conflated and read "You have no ballot on file. Still how you
    // see it?" — a question about a ballot that does not exist. Two audiences,
    // two asks: a ballot-holder gets the question, a never-voter an invitation.
    const pushes = send([{ franchiseId: '0007', updatedAt: null, stale: false }]);
    expect(pushes[0].body).not.toMatch(/still how you see it/i);
    expect(pushes[0].body).toMatch(/rank the league/i);
  });

  it('sends NOTHING to an owner whose ballot is current', () => {
    // The whole reason the old nag was retired: it must never become a weekly
    // message to people who already did the thing.
    expect(send([{ franchiseId: '0002', updatedAt: daysAgo(2), stale: false }])).toEqual([]);
  });

  it('never names another owner', () => {
    // Count-only survives the repointing: a push is about YOUR ballot and
    // says nothing about anyone else's.
    const pushes = send([{ franchiseId: '0001', updatedAt: daysAgo(30), stale: true }]);
    for (const fid of FIELD.filter((f) => f !== '0001')) {
      expect(pushes[0].body).not.toContain(fid);
    }
    expect(pushes[0].body).not.toMatch(/Team \d/);
  });

  it('states when the result lands', () => {
    const pushes = send([{ franchiseId: '0001', updatedAt: daysAgo(30), stale: true }]);
    expect(pushes[0].body).toMatch(/Thursday/);
  });

  it('sends nothing when every ballot is current', () => {
    expect(send([])).toEqual([]);
  });
});
