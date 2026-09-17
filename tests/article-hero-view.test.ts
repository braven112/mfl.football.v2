import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  articleDateLabel,
  articleExcerpt,
  articleHeroView,
  emptyArticleHeroView,
  pickLatestArticle,
  stripHeadlineKicker,
  type ArticleHeroSource,
} from '../src/utils/article-hero-view';
import type { CompositeHeroTreatment } from '../src/types/composite-hero';

const ROOT = join(__dirname, '..');
const COMPOSITE: CompositeHeroTreatment = { wordmark: 'NEWS', accent: 'navy', tone: null, scope: 'league' };
const BYLINE = { name: 'Claude Schefter', avatar: '/assets/claude-schefter-avatar.webp' };

const OPTS = {
  pill: 'WAIVER REPORT',
  composite: COMPOSITE,
  byline: BYLINE,
  fallbackLink: '/afl-fantasy/news',
};

function post(over: Partial<ArticleHeroSource> = {}): ArticleHeroSource {
  return {
    type: 'article',
    headline: 'Week 2 Wall: League Walks Into Buzz Saw',
    body: 'Dark Magicians of Chaos face the hardest road in the league at 54 difficulty.',
    link: '/theleague/news/sf_2026_gauntlet_w02',
    linkLabel: 'Read The Gauntlet',
    timestamp: '2026-09-16T19:27:28.364Z',
    authorId: 'claude',
    ...over,
  };
}

describe('articleHeroView — the CTA is the article, never the listing', () => {
  // THE BUG: the AFL's news card printed a headline and then sent the reader
  // to /afl-fantasy/news to go find the story it had just named.
  it('links the article’s own permalink', () => {
    const view = articleHeroView(post(), OPTS);
    expect(view.link).toBe('/theleague/news/sf_2026_gauntlet_w02');
    expect(view.link).not.toBe(OPTS.fallbackLink);
    expect(view.linkLabel).toBe('Read The Gauntlet');
  });

  it('falls back to the listing ONLY for a post with no permalink', () => {
    const view = articleHeroView(post({ link: undefined, linkLabel: undefined }), OPTS);
    expect(view.link).toBe('/afl-fantasy/news');
  });

  it('carries the post’s byline, so an external report is not attributed to the house', () => {
    const external = { name: 'Adam Schefter', avatar: '/assets/schefter/adam-schefter-avatar.webp' };
    const view = articleHeroView(post({ authorId: 'adam-schefter' }), { ...OPTS, byline: external });
    expect(view.byline).toEqual(external);
  });

  it('names the story — the headline is the article’s, not a hardcoded line', () => {
    const view = articleHeroView(post(), OPTS);
    expect(`${view.headline} ${view.accentWord}`).toContain('Buzz Saw');
    expect(view.headline).not.toMatch(/AROUND THE/i);
  });

  it('keeps the caller’s palette — the league picks its own colours', () => {
    expect(articleHeroView(post(), OPTS).composite).toEqual(COMPOSITE);
  });
});

describe('the empty desk card', () => {
  // The one honest use of the listing CTA: no article means no story to link.
  it('is the only state that may point at the listing', () => {
    const view = emptyArticleHeroView({
      pill: 'AROUND THE AFL',
      headline: 'AROUND THE',
      accentWord: 'AFL.',
      summary: 'Schefter covers the moves.',
      composite: COMPOSITE,
      byline: BYLINE,
      link: '/afl-fantasy/news',
      linkLabel: 'READ THE LATEST',
    });
    expect(view.link).toBe('/afl-fantasy/news');
    expect(view.byline).toEqual(BYLINE);
  });
});

describe('pickLatestArticle', () => {
  const older = post({ headline: 'Older story', timestamp: '2026-09-01T00:00:00.000Z' });
  const newer = post({ headline: 'Newer story', timestamp: '2026-09-16T00:00:00.000Z' });

  it('sorts by TIMESTAMP, not feed position', () => {
    // MFL array order is nondeterministic and the feeds are cron-merged, so
    // posts[0] is a guess that happens to be right most days.
    expect(pickLatestArticle([older, newer])?.headline).toBe('Newer story');
    expect(pickLatestArticle([newer, older])?.headline).toBe('Newer story');
  });

  it('ignores non-article posts', () => {
    const tx = post({ type: 'transaction', headline: 'Trade', timestamp: '2026-09-17T00:00:00.000Z' });
    expect(pickLatestArticle([tx, newer])?.headline).toBe('Newer story');
  });

  it('prefers a matching headline inside the window', () => {
    const waiver = post({ headline: 'Waiver wire winners', timestamp: '2026-09-15T00:00:00.000Z' });
    const picked = pickLatestArticle([newer, waiver], { prefer: /waiver/i, now: new Date('2026-09-17T00:00:00Z') });
    expect(picked?.headline).toBe('Waiver wire winners');
  });

  it('falls back to the newest when nothing matches', () => {
    expect(pickLatestArticle([older, newer], { prefer: /nothing/ })?.headline).toBe('Newer story');
  });

  it('honours `within` — a stale feed does not become this week’s news…', () => {
    const stale = post({ headline: 'June story', timestamp: '2026-06-01T00:00:00.000Z' });
    const now = new Date('2026-09-17T00:00:00Z');
    const week = 7 * 24 * 60 * 60 * 1000;
    // …but an ALL-stale feed still shows its newest rather than nothing: the
    // slot is already on the page, and the card degrades by being old, not by
    // being empty.
    expect(pickLatestArticle([stale], { now, within: week })?.headline).toBe('June story');
    expect(pickLatestArticle([stale, newer], { now, within: week })?.headline).toBe('Newer story');
  });

  it('returns null for a feed with no article', () => {
    expect(pickLatestArticle([post({ type: 'transaction' })])).toBeNull();
  });
});

describe('copy shaping', () => {
  it('drops a short leading kicker so the display line is the headline', () => {
    expect(stripHeadlineKicker('Week 2 Wall: League Walks Into Buzz Saw')).toBe('League Walks Into Buzz Saw');
  });

  it('keeps a long lead — it IS the headline, not a kicker', () => {
    const title = '204 Games. Four to Circle. The AFL Schedule Is Out.';
    expect(stripHeadlineKicker(title)).toBe(title);
  });

  it('never strips down to a fragment', () => {
    expect(stripHeadlineKicker('Breaking: done')).toBe('Breaking: done');
  });

  it('truncates the excerpt on a word boundary', () => {
    const view = articleHeroView(post({ body: 'word '.repeat(80) }), OPTS);
    expect(view.summary.length).toBeLessThanOrEqual(182);
    expect(view.summary.endsWith('…')).toBe(true);
    expect(view.summary).not.toMatch(/wor…$/);
  });

  it('leaves a short body alone', () => {
    expect(articleExcerpt('Short one.')).toBe('Short one.');
  });

  it('returns no dateline rather than "Invalid Date"', () => {
    expect(articleDateLabel(undefined)).toBeUndefined();
    expect(articleDateLabel('not-a-date')).toBeUndefined();
    expect(articleDateLabel('2026-09-16T19:27:28.364Z')).toMatch(/Sep/);
  });
});

describe('both leagues render the ONE shared card', () => {
  // ~57,800 lines across 24 forked siblings is what a second copy costs here.
  // If a league grows its own article hero again, this is the test that says so.
  const files = [
    'src/components/theleague/season-heroes/ArticleHero.astro',
    'src/components/afl/AflHero.astro',
  ];

  it.each(files)('%s routes through LeagueCompositeHero', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    expect(src).toMatch(/LeagueCompositeHero/);
  });

  it('TheLeague’s article hero has no bespoke layout of its own', () => {
    const src = readFileSync(join(ROOT, 'src/components/theleague/season-heroes/ArticleHero.astro'), 'utf8');
    // It used to carry ~430 lines of its own composite + bordered-card CSS.
    expect(src).not.toMatch(/<style>/);
    expect(src).not.toMatch(/article-hero__/);
  });

  it('the AFL news slot no longer hardcodes the listing page as its CTA', () => {
    const src = readFileSync(join(ROOT, 'src/utils/afl-hero-resolver.ts'), 'utf8');
    const slot = src.slice(src.indexOf("'slot:article':"), src.indexOf("feature: ({ now, whatsNewEntry"));
    // The listing may appear as the FALLBACK and as the empty-desk link, but
    // the slot must go through the shared builder to decide.
    expect(slot).toMatch(/articleHeroView\(/);
    expect(slot).toMatch(/emptyArticleHeroView\(/);
  });
});
