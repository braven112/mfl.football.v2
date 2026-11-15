import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import {
  absolutizeLinks,
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
      { id: 'b', type: 'external', headline: 'ESPN', timestamp: '2026-11-12T00:00:00Z', franchiseIds: [] },
      { id: 'c', type: 'odds', headline: 'Odds', timestamp: '2026-11-12T00:00:00Z', franchiseIds: [] },
      { id: 'd', type: 'assistant', headline: 'Set your lineup', timestamp: '2026-11-12T00:00:00Z', franchiseIds: ['0001'] },
      { id: 'e', type: 'article', headline: 'Gauntlet', timestamp: '2026-11-11T00:00:00Z', franchiseIds: [], content: ['<p>x</p>'] },
      { id: 'f', type: 'transaction', transactionSubType: 'TRADE_PENDING', headline: 'Pending', timestamp: '2026-11-13T00:00:00Z', franchiseIds: [] },
    ],
  };
  it('keeps league news only, newest first', () => {
    expect(selectWidgetPosts(feed).map((p: any) => p.id)).toEqual(['e', 'a']);
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
  it('makes article links absolute, since the page lives on MFL', () => {
    expect(absolutizeLinks('<a href="/standings">x</a>', absolute)).toContain('href="https://www.theleague.us/standings"');
  });
  it('the ad card sells, and links to our site', () => {
    const html = renderAdWidget({ origin: 'https://mfl.football', avatar: '/assets/x.webp' });
    expect(html).toContain('Get the Beat Reporter');
    expect(html).toContain('https://mfl.football/');
  });
});
