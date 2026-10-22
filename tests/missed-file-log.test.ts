import { describe, it, expect } from 'vitest';
import {
  inMotionFallbackResponse,
  inMotionFallbackUrl,
  missedFileEntry,
  NO_REFERRER,
} from '../src/utils/missed-file-log';

describe('missedFileEntry', () => {
  it('counts a miss on the old InMotion host with the referring page, query dropped', () => {
    expect(
      missedFileEntry(
        new URL('https://mfl.football/afl-fantasy.com/images/x.png'),
        'https://www44.myfantasyleague.com/2019/home/12345?MODULE=X',
      ),
    ).toEqual({
      path: '/afl-fantasy.com/images/x.png',
      referrer: 'https://www44.myfantasyleague.com/2019/home/12345',
    });
  });

  it('counts www.mfl.football too, and records a missing referrer as such', () => {
    expect(missedFileEntry(new URL('https://www.mfl.football/assets/js/a.js'), null)).toEqual({
      path: '/assets/js/a.js',
      referrer: NO_REFERRER,
    });
  });

  it('ignores every other host: league domains, v2, staging, previews', () => {
    for (const host of ['theleague.us', 'afl-fantasy.com', 'v2.mfl.football', 'staging.mfl.football']) {
      expect(missedFileEntry(new URL(`https://${host}/nope`), null)).toBeNull();
    }
  });

  it('ignores the internal 404 rewrite target so a miss is not counted twice', () => {
    expect(missedFileEntry(new URL('https://mfl.football/_not-found'), null)).toBeNull();
  });
});

describe('inMotionFallbackUrl', () => {
  it('sends a miss on the old host to the same path and query on old.mfl.football', () => {
    expect(inMotionFallbackUrl(new URL('https://mfl.football/assets/js/a.js?v=2'))).toBe(
      'https://old.mfl.football/assets/js/a.js?v=2',
    );
  });

  it('leaves every other host to the ordinary 404', () => {
    expect(inMotionFallbackUrl(new URL('https://theleague.us/nope'))).toBeNull();
    expect(inMotionFallbackUrl(new URL('https://mfl.football/_not-found'))).toBeNull();
  });

  it('answers with an uncached temporary redirect, so every miss is counted', () => {
    const res = inMotionFallbackResponse('https://old.mfl.football/x.png');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://old.mfl.football/x.png');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
