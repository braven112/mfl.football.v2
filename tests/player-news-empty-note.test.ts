import { describe, it, expect, vi } from 'vitest';
import { playerNewsEmptyMessage } from '../src/utils/player-news-client';
import {
  PLAYER_NEWS_WINDOW_DAYS_IN_SEASON,
  PLAYER_NEWS_WINDOW_DAYS_OFFSEASON,
} from '../src/utils/player-news';

/**
 * The note shown when a player has nothing to list.
 *
 * It exists because "No recent ESPN stories" is indistinguishable from a broken
 * feature: an owner who opens three quiet players in a row reads it as an
 * outage. Naming the window turns that into information — the search happened,
 * it covered N days, and it found nothing.
 */
describe('playerNewsEmptyMessage', () => {
  it('names the window the server actually applied', () => {
    expect(playerNewsEmptyMessage(PLAYER_NEWS_WINDOW_DAYS_IN_SEASON, 'Josh Allen'))
      .toBe('No ESPN stories for Josh Allen in the last 30 days.');
    expect(playerNewsEmptyMessage(PLAYER_NEWS_WINDOW_DAYS_OFFSEASON, 'Josh Allen'))
      .toBe('No ESPN stories for Josh Allen in the last 90 days.');
  });

  it('drops the name when there is none to show', () => {
    expect(playerNewsEmptyMessage(30)).toBe('No ESPN stories in the last 30 days.');
    expect(playerNewsEmptyMessage(30, '')).toBe('No ESPN stories in the last 30 days.');
  });

  it('falls back to the vaguer wording when no window came back', () => {
    // The one path that never reaches the route: a subject with no id at all.
    // Inventing a number here would be worse than being vague — the browser
    // must not own a second copy of the season clock.
    expect(playerNewsEmptyMessage(undefined, 'Josh Allen'))
      .toBe('No recent ESPN stories for Josh Allen.');
    expect(playerNewsEmptyMessage(undefined)).toBe('No recent ESPN stories.');
  });

  it('does not print NaN or Infinity if a malformed window ever reaches it', () => {
    for (const bad of [NaN, Infinity]) {
      expect(playerNewsEmptyMessage(bad, 'Josh Allen'))
        .toBe('No recent ESPN stories for Josh Allen.');
    }
  });
});

describe('windowDays is normalized at the wire boundary', () => {
  // playerNewsEmptyMessage guards against these too, but a malformed number
  // should be dropped where it arrives rather than at each place that later
  // has to remember to re-check it — the state and the cache both carry it.
  it('rejects a non-finite or nonsensical window from the response body', async () => {
    const { loadPlayerNews, __resetPlayerNewsCacheForTests } =
      await import('../src/utils/player-news-client');

    for (const bad of [NaN, Infinity, -30, 0, '30', null]) {
      __resetPlayerNewsCacheForTests();
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'empty', items: [], windowDays: bad }),
      })));

      const states: unknown[] = [];
      await new Promise<void>((resolve) => {
        loadPlayerNews({ mflId: '13593' }, (state) => {
          states.push(state);
          if (state.kind !== 'loading') resolve();
        });
      });

      const terminal = states.at(-1) as { kind: string; windowDays?: number };
      expect(terminal.kind).toBe('empty');
      expect(terminal.windowDays).toBeUndefined();
    }
    vi.unstubAllGlobals();
  });

  it('keeps a well-formed window', async () => {
    const { loadPlayerNews, __resetPlayerNewsCacheForTests } =
      await import('../src/utils/player-news-client');
    __resetPlayerNewsCacheForTests();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: 'empty', items: [], windowDays: 30 }),
    })));

    const terminal = await new Promise<{ kind: string; windowDays?: number }>((resolve) => {
      loadPlayerNews({ mflId: '13593' }, (state) => {
        if (state.kind !== 'loading') resolve(state as never);
      });
    });
    expect(terminal.windowDays).toBe(30);
    vi.unstubAllGlobals();
  });
});
