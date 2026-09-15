/**
 * Guard: the Tuesday recap hero lands on the week in review.
 *
 * Both leagues shipped a recap card that did not point at a recap. The AFL's
 * `slot:recap` sent "READ THE RECAP" to `/afl-fantasy/news` — the whole feed,
 * mostly external NFL wire items — and TheLeague's `RecapCompositeHero` sent
 * "See the full week" to `/theleague/standings`. Neither is the week.
 *
 * The same card also named the WRONG WEEK. `getCurrentNFLWeek` rolls to the
 * upcoming week on TUESDAY, which is the exact morning the recap slot runs, so
 * on Tue Sep 15 2026 the hero read "Week 2 is in the books" while Week 1 was
 * what had just finished and Week 2 had not kicked off. The link and the copy
 * both key off `getLatestScoredWeek` now.
 *
 * These are the three things that must not rot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  findWeeklyRecapPost,
  resolveRecapDestination,
  weeklyRecapPostId,
} from '../src/utils/hero-recap-destination';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';

const recapPost = (year: number, week: number, extra: Record<string, unknown> = {}) => ({
  id: weeklyRecapPostId(year, week),
  type: 'article',
  link: `/theleague/news/${weeklyRecapPostId(year, week)}`,
  ...extra,
});

describe('weeklyRecapPostId is the archive id format', () => {
  it('keeps the shape the recap generator used to write', () => {
    // NOTHING WRITES THIS ID ANY MORE. scripts/article-types/weekly-recap.mjs
    // and its Tuesday 6am PT cron were removed (issue #1086 F3) — a weekly
    // recap column is not something owners wanted to read every week, and none
    // had generated for either league all 2026 season anyway. The lookup below
    // stays because the hero must keep working if a recap is ever back-filled
    // or an old archive is re-imported, and the id it matches on is fixed by
    // that history, not by a generator it can no longer be checked against.
    expect(weeklyRecapPostId(2026, 2)).toBe('sf_2026_weekly_recap_w02');
    expect(weeklyRecapPostId(2026, 12)).toBe('sf_2026_weekly_recap_w12');
  });
});

describe('findWeeklyRecapPost', () => {
  it('finds the recap for exactly that week', () => {
    const posts = [recapPost(2026, 1), recapPost(2026, 2)];
    expect(findWeeklyRecapPost(posts, 2026, 2)!.id).toBe('sf_2026_weekly_recap_w02');
  });

  it('does NOT accept another article published the same morning', () => {
    // RecapHero.astro used to grep headlines and then fall back to
    // `recentArticles[0]`, so a cut-watch column rendered under "Weekly Recap"
    // behind a "Read full recap" button. An id match cannot do that.
    const posts = [
      { id: 'sf_2026_cut_watch_0802', type: 'article', headline: 'Cut Watch: Week 2 Results Recap' },
      { id: 'sf_2026_schedule_release_afl', type: 'article', headline: 'Week 2 in review' },
    ];
    expect(findWeeklyRecapPost(posts, 2026, 2)).toBeNull();
  });

  it('does not reach into another season, or answer for week 0', () => {
    expect(findWeeklyRecapPost([recapPost(2025, 2)], 2026, 2)).toBeNull();
    expect(findWeeklyRecapPost([recapPost(2026, 2)], 2026, 0)).toBeNull();
  });
});

describe('resolveRecapDestination', () => {
  it('prefers Schefter’s own recap column when he wrote one', () => {
    const d = resolveRecapDestination({
      league: 'theleague',
      seasonYear: 2026,
      completedWeek: 2,
      posts: [recapPost(2026, 2)],
    });
    expect(d).toEqual({
      week: 2,
      href: '/theleague/news/sf_2026_weekly_recap_w02',
      label: 'Read the recap',
      isArticle: true,
    });
  });

  it('builds the href from THIS league, ignoring the post’s own link', () => {
    // The removed generator hardcoded `/theleague/news/<id>` and
    // `league: 'theleague'` while ignoring its own `{ league }` option, and the
    // workflow ran it for --league afl-fantasy too. Any recap still sitting in
    // an AFL feed therefore carries a TheLeague permalink for a post that only
    // exists in the AFL's — so the href stays CONSTRUCTED from the reader's
    // league rather than trusted from the post.
    const d = resolveRecapDestination({
      league: 'afl-fantasy',
      seasonYear: 2026,
      completedWeek: 1,
      posts: [recapPost(2026, 1, { link: '/theleague/news/sf_2026_weekly_recap_w01' })],
    });
    expect(d.href).toBe('/afl-fantasy/news/sf_2026_weekly_recap_w01');
    expect(d.href).not.toContain('theleague');
  });

  it('falls back to the completed week’s SCOREBOARD, never the news feed', () => {
    // The fallback is the thing the user actually asked for: a recap of the
    // games, not a dump of every wire item. No recap has generated for either
    // league all 2026 season, so this is the common path, not the edge case.
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      const d = resolveRecapDestination({ league, seasonYear: 2026, completedWeek: 1, posts: [] });
      expect(d.href).toBe(`/${league}/live-scoring?week=1`);
      expect(d.isArticle).toBe(false);
      expect(d.week).toBe(1);
      expect(d.href).not.toContain('/news');
      expect(d.href).not.toContain('/standings');
    }
  });

  it('pins the link to the week in the books, not the week number handed in', () => {
    const d = resolveRecapDestination({
      league: 'afl-fantasy',
      seasonYear: 2026,
      completedWeek: 1,
      posts: [recapPost(2026, 2, { link: '/afl-fantasy/news/sf_2026_weekly_recap_w02' })],
    });
    // Week 2's recap exists but week 1 is what is complete — the hero must not
    // hand the reader a recap of games that have not been played.
    expect(d.href).toBe('/afl-fantasy/live-scoring?week=1');
  });

  it('only degrades to the feed when nothing at all has been scored', () => {
    const d = resolveRecapDestination({
      league: 'afl-fantasy', seasonYear: 2026, completedWeek: 0, posts: [],
    });
    expect(d).toEqual({ week: 0, href: '/afl-fantasy/news', label: 'Read the latest', isArticle: false });
  });
});

describe('the AFL recap hero renders the resolved destination', () => {
  // Tuesday 15 Sep 2026, 9am PT — the recap slot, and the exact clock where
  // getCurrentNFLWeek answers 2 while Week 1 is the week in the books.
  const TUESDAY = '2026-09-15T16:00:00Z';

  const at = (recap?: unknown) =>
    resolveAflHeroState({ referenceDate: new Date(TUESDAY), rng: () => 0, recap } as any) as any;

  it('is really the recap slot at that clock', () => {
    expect(at().slot).toBe('recap');
  });

  it('uses the recap href + label rather than the news feed', () => {
    const state = at({
      week: 1, href: '/afl-fantasy/live-scoring?week=1', label: 'See the scores', isArticle: false,
    });
    expect(state.view.link).toBe('/afl-fantasy/live-scoring?week=1');
    expect(state.view.linkLabel).toBe('SEE THE SCORES');
    // `content` is a second object that also renders — fixing only `view`
    // leaves the old link live on whichever surface reads it.
    expect(state.content.link).toBe('/afl-fantasy/live-scoring?week=1');
  });

  it('names the COMPLETED week in the copy, not the upcoming one', () => {
    const state = at({
      week: 1, href: '/afl-fantasy/live-scoring?week=1', label: 'See the scores', isArticle: false,
    });
    expect(state.view.summary).toContain('Week 1 is in the books');
    expect(state.view.summary).not.toContain('Week 2');
    expect(state.content.title).toBe('Week 1 Recap');
  });

  it('never names a week when none is in the books', () => {
    // The week-0 fallback must not reach for `getCurrentNFLWeek` — that is the
    // upcoming week, i.e. the original bug restated.
    const state = at({ week: 0, href: '/afl-fantasy/news', label: 'Read the latest', isArticle: false });
    expect(state.view.summary).toContain('The week is in the books');
    expect(state.view.summary).not.toMatch(/Week \d/);
    expect(state.content.title).toBe('Weekly Recap');
    expect(state.content.title).not.toMatch(/Week \d/);
  });

  it('links Schefter’s column when there is one', () => {
    const state = at({
      week: 1, href: '/theleague/news/x', label: 'Read the recap', isArticle: true,
    });
    expect(state.view.link).toBe('/theleague/news/x');
    expect(state.view.linkLabel).toBe('READ THE RECAP');
  });
});

describe('no recap surface points at a non-recap page', () => {
  it('neither hero hardcodes /news or /standings for its recap CTA', () => {
    const afl = readFileSync('src/utils/afl-hero-resolver.ts', 'utf8');
    // From the SLOT_VIEW entry, not the SlotKey union that lists the name first.
    const start = afl.indexOf("'slot:recap': (");
    expect(start).toBeGreaterThan(-1);
    const slot = afl.slice(start, afl.indexOf("'slot:waiver-wire': ("));
    expect(slot).toContain('recap?.href');
    // The bare literal may survive only as the `??` fallback for a caller that
    // passed no destination at all.
    expect(slot.replace(/recap\?\.href \?\? '\/afl-fantasy\/news'/g, '')).not.toContain("'/afl-fantasy/news'");

    const tl = readFileSync('src/components/theleague/season-heroes/RecapCompositeHero.astro', 'utf8');
    expect(tl).toContain('resolveRecapDestination');
    expect(tl).not.toContain("r('/theleague/standings')");
  });
});
