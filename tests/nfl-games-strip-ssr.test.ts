import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import NflGamesStrip from '../src/components/shared/NflGamesStrip';
import type { NflGame } from '../src/types/live-scoring';

/**
 * The rail must produce MARKUP on the server.
 *
 * This is the test that would have caught the bug the whole fix exists for, and
 * the scan-style guard beside it (`tests/network-badge.test.ts`) did not: that
 * one asserts the page passes `initialGames={nflGames}`, which was true while
 * the hook quietly ignored the prop — `fallbackGames` was read only when
 * `enabled` was false, i.e. demo mode. The page looked correct, the guard
 * passed, and the island still server-rendered nothing.
 *
 * Nothing rendered means an `<astro-island>` with no children, and Astro's
 * `client:visible` observes an island's CHILDREN — so an empty one is never
 * observed and never hydrates, silently and permanently. Asserting on the
 * rendered STRING is the only version of this check that cannot be satisfied by
 * plumbing that does not work.
 */

const game = (over: Partial<NflGame> = {}): NflGame => ({
  id: 'g1',
  state: 'pre',
  shortDetail: 'Sun 1:00 PM',
  period: 0,
  clock: '0:00',
  home: { code: 'BUF', score: 0 },
  away: { code: 'NE', score: 0 },
  possession: null,
  date: '2026-09-13T17:00Z',
  situation: null,
  broadcast: 'CBS',
  ...over,
});

const ssr = (props: Record<string, unknown>) =>
  renderToString(createElement(NflGamesStrip as any, { week: 1, year: 2026, ...props }));

describe('NflGamesStrip — server render', () => {
  it('renders the rail from initialGames on the REAL path (demo off)', () => {
    const html = ssr({ initialGames: [game()], demo: false });
    expect(html, 'the rail produced no markup — the island would have no children').not.toBe('');
    expect(html).toContain('nfl-strip');
    expect(html).toContain('nfl-game');
  });

  it('draws the network mark server-side, so the badge is in the first paint', () => {
    const html = ssr({ initialGames: [game({ broadcast: 'CBS' })], demo: false, country: 'US' });
    expect(html).toContain('net-badge');
    expect(html).toMatch(/\/assets\/tv-logos\/[^"]+\.png/);
  });

  it('resolves the mark for the viewer country, not the US network, server-side', () => {
    const au = ssr({ initialGames: [game({ broadcast: 'CBS' })], demo: false, country: 'AU' });
    expect(au).not.toContain('cbs-nfl-us.png');
  });

  it('withholds the live dot while the slate is unconfirmed by any poll', () => {
    // A server slate with a live game renders its score and clock, but not the
    // pulsing dot: no poll has landed, so the clock is frozen. "Wrong while
    // looking live" is the state this whole feature's no-store/ok discipline
    // exists to prevent.
    const html = ssr({ initialGames: [game({ state: 'in', shortDetail: 'Q2 8:45' })], demo: false });
    expect(html).toContain('Q2 8:45');
    expect(html, 'a frozen clock must not pulse').not.toContain('nfl-dot');
  });

  it('keeps the live dot in demo mode, where the bundled slate is authoritative', () => {
    const html = ssr({ initialGames: [game({ state: 'in', shortDetail: 'Q2 8:45' })], demo: true });
    expect(html).toContain('nfl-dot');
  });

  it('still renders in demo mode', () => {
    // The one path that always worked; pinned so a fix here cannot break it.
    expect(ssr({ initialGames: [game()], demo: true })).toContain('nfl-strip');
  });

  it('renders nothing when there are genuinely no games', () => {
    // Correct and deliberate — but it is exactly why the mount must not be
    // `client:visible`, which the scan guard pins separately.
    expect(ssr({ initialGames: [], demo: false })).toBe('');
    expect(ssr({ demo: false })).toBe('');
  });
});
