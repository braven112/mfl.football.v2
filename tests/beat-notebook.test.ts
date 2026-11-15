/**
 * "Notable + daily notebook" (scripts/lib/beat-notebook.mjs): which moves keep
 * their own post, and how the rest of a league day folds into one notebook
 * that later scans extend in place.
 */
import { describe, expect, it } from 'vitest';
import {
  adpRankLookup,
  foldDailyNotebook,
  isNotableMove,
  notebookId,
  notebookText,
  NOTEBOOK_MAX_LINES,
} from '../scripts/lib/beat-notebook.mjs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

// 2026-11-14 12:00 PT
const NOON = 1794772800 - 86400;
const ctx = {
  leagueSlug: 'archies',
  clockZone: 'America/Los_Angeles',
  bidOf: (t: any) => t.bid,
  adpRank: adpRankLookup({ adp: { player: [{ id: '100', rank: '12' }, { id: '200', rank: '170' }] } }),
};
const draft = (type: string, extra: Record<string, unknown> = {}, ts = NOON) => ({
  post: { tier: 'minor', sourceTimestamp: String(ts), transactionSubType: type, headline: `${type} move ${ts}`, franchiseIds: ['0001'], playerIds: ['9'] },
  txn: { type, timestamp: String(ts), ...extra },
});

describe('what stays its own post', () => {
  it('trades, big bids and IR moves for ranked players', () => {
    expect(isNotableMove(draft('TRADE'), ctx)).toBe(true);
    expect(isNotableMove(draft('BBID_WAIVER', { bid: 25 }), ctx)).toBe(true);
    expect(isNotableMove(draft('BBID_WAIVER', { bid: 4.5 }), ctx)).toBe(false);
    expect(isNotableMove(draft('IR', { deactivated: '100,' }), ctx)).toBe(true);
    expect(isNotableMove(draft('IR', { deactivated: '200,' }), ctx)).toBe(false);
    expect(isNotableMove(draft('FREE_AGENT'), ctx)).toBe(false);
  });

  it('a breaking post or big drop always stands alone', () => {
    const d = draft('FREE_AGENT');
    d.post.tier = 'breaking';
    expect(isNotableMove(d, ctx)).toBe(true);
  });
});

describe('the daily notebook', () => {
  it('folds the rest of the day into one post and keeps the notable ones', () => {
    const feed = { posts: [] as any[] };
    const out = foldDailyNotebook([draft('TRADE'), draft('FREE_AGENT', {}, NOON + 60), draft('BBID_WAIVER', { bid: 2 }, NOON + 120)], feed, ctx);
    expect(out).toHaveLength(2);
    const nb = out.find((d) => d.post.format === 'notebook')!.post;
    expect(nb.id).toBe(notebookId('archies', '2026-11-14'));
    expect(nb.headline).toBe('Around the league: Nov 14 notebook');
    expect(nb.body).toContain('- FREE_AGENT move');
    expect(nb.items).toHaveLength(2);
  });

  it('a later scan extends the same day in place', () => {
    const feed = { posts: [] as any[] };
    const [first] = foldDailyNotebook([draft('FREE_AGENT')], feed, ctx);
    feed.posts = [first.post, { id: 'other' }];
    const [second] = foldDailyNotebook([draft('FREE_AGENT', {}, NOON + 600)], feed, ctx);
    expect(second.post.id).toBe(first.post.id);
    expect(second.post.items).toHaveLength(2);
    expect(feed.posts.map((p) => p.id)).toEqual(['other']);
  });

  it('caps the lines it shows and counts the rest', () => {
    const items = Array.from({ length: NOTEBOOK_MAX_LINES + 3 }, (_, i) => ({ line: `m${i}` }));
    expect(notebookText(items, '2026-11-14').body).toMatch(/and 3 more moves on the wire/);
  });
});

describe('who opts in', () => {
  it("Archie's does; TheLeague and the AFL keep a post per move", () => {
    expect(getLeagueBySlug('archies')?.schefter?.newsVolume).toBe('notable');
    expect(getLeagueBySlug('theleague')?.schefter?.newsVolume).toBeUndefined();
    expect(getLeagueBySlug('afl-fantasy')?.schefter?.newsVolume).toBeUndefined();
  });
});
