/**
 * Pages read injuries through loadLiveInjuryMap: the roster sync's Redis copy
 * when it is at least as new as the bundled feed (now a once-a-day snapshot),
 * else the bundled feed — never an empty map because Redis was unreachable.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadInjuryMap } from '../src/utils/mfl-injuries';
import {
  LIVE_INJURIES_TTL_MS,
  liveInjuriesKey,
  liveIsFresher,
  loadLiveInjuryFeed,
  resetLiveInjuryMemo,
} from '../src/utils/mfl-injuries-live';
import { loadLiveInjuryMap } from '../src/utils/mfl-injuries-live-map';

const SLUG = 'theleague';
const NOW = Date.parse('2026-10-16T12:00:00Z');
const LIVE = { year: 9999, injuries: { '12345': { injuryStatus: 'Out', injuryBodyPart: 'Knee' } } };

const client = (value: unknown, onGet?: () => void) => async () => ({
  get: async <T,>(key: string) => {
    onGet?.();
    return (key === liveInjuriesKey(SLUG) ? value : null) as T | null;
  },
});

describe('loadLiveInjuryMap', () => {
  beforeEach(() => resetLiveInjuryMemo());

  it('serves the Redis copy when it is at least as new as the bundled feed', async () => {
    expect(await loadLiveInjuryMap(SLUG, client(LIVE), NOW)).toEqual(LIVE.injuries);
  });

  it('accepts the JSON-string form the REST writer stores', async () => {
    expect(await loadLiveInjuryMap(SLUG, client(JSON.stringify(LIVE)), NOW)).toEqual(LIVE.injuries);
  });

  it('ignores a Redis copy from an older year than the bundle', async () => {
    const old = { year: 1999, injuries: { '1': { injuryStatus: 'Out' } } };
    expect(await loadLiveInjuryMap(SLUG, client(old), NOW)).toEqual(loadInjuryMap(SLUG));
  });

  it('falls back to the bundled feed with no Redis, no key, or a broken read', async () => {
    expect(await loadLiveInjuryMap(SLUG, async () => null, NOW)).toEqual(loadInjuryMap(SLUG));
    resetLiveInjuryMemo();
    expect(await loadLiveInjuryMap(SLUG, client(null), NOW)).toEqual(loadInjuryMap(SLUG));
    resetLiveInjuryMemo();
    const broken = async () => ({ get: async () => { throw new Error('down'); } });
    expect(await loadLiveInjuryMap(SLUG, broken, NOW)).toEqual(loadInjuryMap(SLUG));
  });

  it('reuses one read per instance for the memo window', async () => {
    let gets = 0;
    const c = client(LIVE, () => { gets += 1; });
    await loadLiveInjuryMap(SLUG, c, NOW);
    await loadLiveInjuryMap(SLUG, c, NOW + LIVE_INJURIES_TTL_MS - 1);
    expect(gets).toBe(1);
    await loadLiveInjuryMap(SLUG, c, NOW + LIVE_INJURIES_TTL_MS);
    expect(gets).toBe(2);
  });
});

describe('freshness', () => {
  const BASE = { year: 2026, generatedAt: '2026-10-16T10:00:00Z' };

  it('a same-year live copy wins only when its stamp is no older than the base', () => {
    expect(liveIsFresher({ year: 2026, generatedAt: '2026-10-16T11:00:00Z', injuries: {} }, BASE)).toBe(true);
    expect(liveIsFresher({ year: 2026, generatedAt: '2026-10-16T10:00:00Z', injuries: {} }, BASE)).toBe(true);
    // A failed publish committed a newer report; the stale live copy must not override it.
    expect(liveIsFresher({ year: 2026, generatedAt: '2026-10-16T09:00:00Z', injuries: {} }, BASE)).toBe(false);
    expect(liveIsFresher({ year: 2026, injuries: {} }, BASE)).toBe(false);
  });

  it('year still decides across years, and an unstamped base loses to a same-year live copy', () => {
    expect(liveIsFresher({ year: 2027, injuries: {} }, BASE)).toBe(true);
    expect(liveIsFresher({ year: 2025, generatedAt: '2030-01-01T00:00:00Z', injuries: {} }, BASE)).toBe(false);
    expect(liveIsFresher({ year: 2026, injuries: {} }, { year: 2026 })).toBe(true);
  });
});

describe('loadLiveInjuryFeed', () => {
  beforeEach(() => resetLiveInjuryMemo());
  const DISK = { year: 2026, generatedAt: '2026-10-16T10:00:00Z', injuries: { '2': { injuryStatus: 'Questionable' } } };

  it('replaces the disk feed with a fresher live report for the same year', async () => {
    const live = { ...LIVE, year: 2026, generatedAt: '2026-10-16T11:00:00Z' };
    expect(await loadLiveInjuryFeed(SLUG, 2026, DISK, client(live), NOW)).toEqual(live);
  });

  it('keeps the disk feed when the live report is older, another year, or missing', async () => {
    const older = { ...LIVE, year: 2026, generatedAt: '2026-10-16T09:00:00Z' };
    expect(await loadLiveInjuryFeed(SLUG, 2026, DISK, client(older), NOW)).toBe(DISK);
    resetLiveInjuryMemo();
    expect(await loadLiveInjuryFeed(SLUG, 2026, DISK, client({ ...LIVE, year: 2027 }), NOW)).toBe(DISK);
    resetLiveInjuryMemo();
    expect(await loadLiveInjuryFeed(SLUG, 2026, null, client(null), NOW)).toBeNull();
  });
});
