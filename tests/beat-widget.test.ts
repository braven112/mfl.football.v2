import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import {
  widgetCss,
  WIDGET_CSS as BASE_CSS,
  isMflOrigin,
  renderAdWidget,
  renderNewsWidget,
  selectWidgetPosts,
  verifyWidgetKey,
  widgetKey,
  widgetSecret,
} from '../src/utils/beat-widget.mjs';

const secret = widgetSecret({ JWT_SECRET: 'test-secret' } as any)!;
const theleague = (LEAGUES as any).theleague;
const afl = (LEAGUES as any)['afl-fantasy'] ?? Object.values(LEAGUES as any).find((l: any) => l.id !== theleague.id);

describe('league keys', () => {
  it('a league key verifies only for its own league', () => {
    const key = widgetKey(theleague.id, secret);
    expect(verifyWidgetKey(theleague.id, key, secret)).toBe(true);
    expect(verifyWidgetKey(afl.id, key, secret)).toBe(false);
  });
  it('refuses junk, a missing secret, and a key from another secret', () => {
    expect(verifyWidgetKey(theleague.id, 'nope', secret)).toBe(false);
    expect(verifyWidgetKey(theleague.id, widgetKey(theleague.id, secret), null)).toBe(false);
    const other = widgetSecret({ JWT_SECRET: 'other' } as any)!;
    expect(verifyWidgetKey(theleague.id, widgetKey(theleague.id, other), secret)).toBe(false);
  });
  it('has no secret without either env var', () => {
    expect(widgetSecret({} as any)).toBeNull();
  });
});

describe('origins', () => {
  it('allows only https myfantasyleague.com pages', () => {
    expect(isMflOrigin('https://www49.myfantasyleague.com')).toBe(true);
    expect(isMflOrigin('https://myfantasyleague.com')).toBe(true);
    expect(isMflOrigin('http://www49.myfantasyleague.com')).toBe(false);
    expect(isMflOrigin('https://evilmyfantasyleague.com')).toBe(false);
    expect(isMflOrigin('https://myfantasyleague.com.evil.io')).toBe(false);
    expect(isMflOrigin(null)).toBe(false);
  });
});

describe('which posts leave our site', () => {
  const feed = {
    posts: [
      { id: 'a', type: 'transaction', headline: 'Trade', timestamp: '2026-11-10T00:00:00Z', franchiseIds: [] },
      { id: 'b', type: 'external', authorId: 'nfl-wire', headline: 'ESPN', timestamp: '2026-11-12T00:00:00Z', franchiseIds: [] },
      { id: 'c', type: 'odds', authorId: 'vegas-vic', headline: 'Odds', timestamp: '2026-11-12T00:00:00Z', franchiseIds: [] },
      { id: 'd', type: 'assistant', headline: 'Set your lineup', timestamp: '2026-11-12T00:00:00Z', franchiseIds: ['0001'] },
      { id: 'e', type: 'article', headline: 'Gauntlet', timestamp: '2026-11-11T00:00:00Z', franchiseIds: [], content: ['<p>x</p>'] },
      { id: 'f', type: 'transaction', transactionSubType: 'TRADE_PENDING', headline: 'Pending', timestamp: '2026-11-13T00:00:00Z', franchiseIds: [] },
    ],
  };
  it('keeps league news, the wire and the insiders; drops nudges and pending trades', () => {
    const { posts, leagueIds } = selectWidgetPosts(feed);
    expect(posts.map((p: any) => p.id)).toEqual(['b', 'c', 'e', 'a']);
    expect([...leagueIds].sort()).toEqual(['a', 'e']);
  });
  it('gives each tab its own limit, so the wire cannot push league news out', () => {
    const wire = Array.from({ length: 30 }, (_, i) => ({ id: `wire_${i}`, type: 'external', authorId: 'nfl-wire', headline: 'w', timestamp: `2026-11-20T00:00:${String(i).padStart(2, '0')}Z` }));
    const { posts, leagueIds } = selectWidgetPosts({ posts: [...wire, feed.posts[0]] }, { limit: 5 });
    expect(posts).toHaveLength(6);
    expect([...leagueIds]).toEqual(['a']);
  });
});

describe('rendering', () => {
  const absolute = (p: string) => `https://www.theleague.us${p}`;
  it('escapes post text', () => {
    const html = renderNewsWidget({
      posts: [{ id: 'x', type: 'transaction', headline: '<img onerror=1>', body: 'a & b', timestamp: '2026-11-10T00:00:00Z' }],
      reporter: { name: 'Max', report: 'The Insider Report', avatar: 'https://mfl.football/a.webp' },
      absolute,
      leagueSlug: 'theleague',
    });
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('a &amp; b');
  });
  it('every card links to our site: a column to its article, anything else to the news page', () => {
    const html = renderNewsWidget({
      posts: [
        { id: 'col 1', type: 'article', headline: 'Gauntlet', content: ['<p>x</p>'], timestamp: '2026-11-10T00:00:00Z' },
        { id: 'tx', type: 'transaction', headline: 'Pickup', timestamp: '2026-11-09T00:00:00Z' },
      ],
      reporter: { name: 'Max', report: 'The Insider Report', avatar: 'https://mfl.football/a.webp' },
      absolute,
      leagueSlug: 'theleague',
    });
    expect(html).toContain('href="https://www.theleague.us/theleague/news/col%201"');
    expect(html).toContain('href="https://www.theleague.us/theleague/news"');
    expect(html).not.toContain('<template');
    expect(html).not.toContain('<p>x</p>');
  });
  it('only a column carries a headline; a news post shows its text once', () => {
    const html = renderNewsWidget({
      posts: [{ id: 'tx', type: 'transaction', headline: 'Pigskins add Smith', body: 'Pigskins signed WR Smith.', timestamp: '2026-11-09T00:00:00Z' }],
      reporter: { name: 'Max', report: 'The Insider Report', avatar: 'https://mfl.football/a.webp' },
      absolute,
      leagueSlug: 'theleague',
    });
    expect(html).not.toContain('bw-headline');
    expect(html).not.toContain('Pigskins add Smith');
    expect(html).toContain('Pigskins signed WR Smith.');
  });
  it('each post wears its author, the wire opens on ESPN, and League/All tabs split the list', () => {
    const html = renderNewsWidget({
      posts: [
        { id: 'tx', type: 'transaction', headline: 'h', body: 'Pickup', timestamp: '2026-11-09T00:00:00Z' },
        { id: 'wire_1', type: 'external', authorId: 'nfl-wire', headline: 'Wire', body: 'Wire', link: 'https://www.espn.com/x', timestamp: '2026-11-10T00:00:00Z' },
      ],
      leagueIds: new Set(['tx']),
      bylineFor: (p: any) => (p.id === 'tx' ? { name: 'Claude Schefter', avatar: 'https://mfl.football/s.webp' } : { name: 'NFL Wire', avatar: 'https://mfl.football/w.webp' }),
      reporter: { name: 'Max', report: 'The Insider Report', avatar: 'https://mfl.football/a.webp' },
      absolute,
      leagueSlug: 'theleague',
    });
    expect(html).toContain('src="https://mfl.football/w.webp"');
    expect(html).toContain('NFL Wire');
    expect(html).toContain('href="https://www.espn.com/x"');
    expect(html).toContain('for="bw-tab-league"');
    expect(html.match(/bw-post--league/g)).toHaveLength(1);
    expect(html).toContain('>League</label>');
  });
  it('names the first tab My News when the viewer is known', () => {
    const html = renderNewsWidget({
      posts: [
        { id: 'tx', type: 'transaction', headline: 'h', body: 'Pickup', timestamp: '2026-11-09T00:00:00Z' },
        { id: 'wire_1', type: 'external', authorId: 'nfl-wire', headline: 'Wire', timestamp: '2026-11-10T00:00:00Z' },
      ],
      leagueIds: new Set(['tx']),
      firstTab: 'My News',
      reporter: { name: 'Max', report: 'The Insider Report', avatar: 'https://mfl.football/a.webp' },
      absolute,
      leagueSlug: 'theleague',
    });
    expect(html).toContain('>My News</label>');
  });
  it('the loader reads MFL\'s franchise_id global, never document.cookie', () => {
    const src = readFileSync('public/mfl/beat.js', 'utf8');
    expect(src).toContain('typeof franchise_id');
    expect(src).not.toMatch(/document\.cookie/);
  });
  it('the ad card sells, and links to our site', () => {
    const html = renderAdWidget({ origin: 'https://mfl.football', avatar: '/assets/x.webp' });
    expect(html).toContain('Get the Beat Reporter');
    expect(html).toContain('https://mfl.football/');
  });
});

describe('big news', () => {
  it('rides in the feed with a red badge, never a pinned strip or an alert box', () => {
    const html = renderNewsWidget({
      reporter: { name: 'Max', report: 'The Insider Report', avatar: 'https://mfl.football/a.webp' },
      absolute: (path: string) => `https://www.theleague.us${path}`,
      leagueSlug: 'theleague',
      posts: [{ id: 'tr', type: 'transaction', transactionSubType: 'TRADE', headline: 'Big trade', body: 'Blockbuster', timestamp: '2026-11-15T10:00:00Z' }],
    } as any);
    expect(html).toContain('bw-badge bw-badge--hot');
    expect(html).not.toContain('bw-breaking');
    expect(html).not.toContain('bw-alerts');
  });
});

describe('league colors', () => {
  it('sets the league pair and ignores anything that is not a hex color', () => {
    expect(widgetCss({ primary: '#1c497c', secondary: '#2e8743' })).toContain(':host{--bw-p:#1c497c;--bw-s:#2e8743}');
    expect(widgetCss({ primary: '#1c497c' })).toContain('--bw-s:#1c497c');
    expect(widgetCss({ primary: 'red;}body{display:none' })).toBe(BASE_CSS);
    expect(widgetCss()).toBe(BASE_CSS);
  });

  it('loads the display face on the page, from our origin', () => {
    const loader = readFileSync('public/mfl/beat.js', 'utf8');
    expect(loader).toContain('"BW Display"');
    expect(loader).toContain("origin + '/assets/fonts/UFCSans-'");
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const fonts = vercel.headers.find((h: any) => h.source === '/assets/fonts/(.*)');
    expect(fonts?.headers).toContainEqual({ key: 'Access-Control-Allow-Origin', value: '*' });
  });
});
