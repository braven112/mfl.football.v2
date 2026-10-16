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
  loadLiveInjuryMap,
  resetLiveInjuryMemo,
} from '../src/utils/mfl-injuries-live';

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
