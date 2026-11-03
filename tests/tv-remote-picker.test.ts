/**
 * Which paired TV the phone remote talks to, and how the picker names them.
 *
 * Re-pairing a TV used to leave its old pass on the owner's list, and the
 * remote defaulted to the OLDEST entry, so every press went to a pass no
 * screen listened to (Brandon, Nov 2026). The TV's pairing route now retires
 * the old pass; these pin the remote's half: newest by default, a phone's own
 * choice kept while that TV is still paired, and duplicates told apart.
 */
import { describe, it, expect } from 'vitest';
import { defaultTvId, tvLabel, type PairedTv } from '../src/components/shared/live-broadcast/useTvRemote';

const nov = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime();
const tv = (id: string, device: string, createdAt: number): PairedTv => ({ id, device, createdAt });

describe('defaultTvId', () => {
  const tvs = [tv('old', 'Android TV', nov(1)), tv('mid', 'Fire TV', nov(1)), tv('new', 'Android TV', nov(2))];

  it('picks the newest pairing, never the oldest', () => {
    expect(defaultTvId(tvs, null)).toBe('new');
  });

  it('keeps the TV this phone chose while it is still paired', () => {
    expect(defaultTvId(tvs, 'mid')).toBe('mid');
  });

  it('drops a remembered TV that is no longer paired', () => {
    expect(defaultTvId(tvs, 'gone')).toBe('new');
  });

  it('has nothing to pick with no TVs', () => {
    expect(defaultTvId([], 'old')).toBeNull();
  });
});

describe('tvLabel', () => {
  it('leaves a one-of-a-kind TV alone', () => {
    const tvs = [tv('a', 'Fire TV', nov(1)), tv('b', 'Android TV', nov(2))];
    expect(tvLabel(tvs, tvs[0])).toBe('Fire TV');
  });

  it('names duplicates by the day they were paired', () => {
    const tvs = [tv('a', 'Android TV', nov(1)), tv('b', 'Android TV', nov(2))];
    expect(tvLabel(tvs, tvs[0])).toBe('Android TV, paired Nov 1');
    expect(tvLabel(tvs, tvs[1])).toBe('Android TV, paired Nov 2');
  });

  it('numbers duplicates paired the same day', () => {
    const tvs = [tv('a', 'Android TV', nov(2, 9)), tv('b', 'Android TV', nov(2, 18))];
    expect(tvLabel(tvs, tvs[0])).toBe('Android TV 1, paired Nov 2');
    expect(tvLabel(tvs, tvs[1])).toBe('Android TV 2, paired Nov 2');
  });
});
