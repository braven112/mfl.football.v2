import { describe, it, expect } from 'vitest';
import { parseBroadcast } from '../src/utils/espn-game-detail';

describe('parseBroadcast — the network off an ESPN scoreboard competition', () => {
  it('prefers the named broadcast list', () => {
    expect(parseBroadcast({ broadcasts: [{ market: 'national', names: ['CBS'] }], geoBroadcasts: [{ type: { shortName: 'TV' }, media: { shortName: 'FOX' } }] })).toBe('CBS');
  });

  it('ignores a local-market TV affiliate in the geo fallback', () => {
    expect(parseBroadcast({ geoBroadcasts: [{ type: { shortName: 'TV' }, market: { type: 'Home' }, media: { shortName: 'WCBS' } }] })).toBe('');
  });

  it('falls back to a national TV geo-broadcast', () => {
    expect(parseBroadcast({ geoBroadcasts: [{ type: { shortName: 'Streaming' }, media: { shortName: 'ESPN+' } }, { type: { shortName: 'TV' }, market: { type: 'National' }, media: { shortName: 'NBC' } }] })).toBe('NBC');
  });

  it('tolerates a bare object where ESPN would send a list, and blanks', () => {
    expect(parseBroadcast({ broadcasts: { names: 'Prime Video' } })).toBe('Prime Video');
    expect(parseBroadcast({ broadcasts: [{ names: ['  '] }] })).toBe('');
    expect(parseBroadcast({})).toBe('');
    expect(parseBroadcast(null)).toBe('');
  });
});

describe('parseBroadcast — the geo fallback never names a radio network', () => {
  it('prefers national TV, then a national non-radio carrier, never Westwood One', () => {
    const radioOnly = { geoBroadcasts: [{ type: { shortName: 'TV' }, market: { type: 'Home' }, media: { shortName: 'WCBS' } }, { type: { shortName: 'Radio' }, market: { type: 'National' }, media: { shortName: 'Westwood One' } }] };
    expect(parseBroadcast(radioOnly)).toBe('');
    const streaming = { geoBroadcasts: [{ type: { shortName: 'Radio' }, market: { type: 'National' }, media: { shortName: 'Westwood One' } }, { type: { shortName: 'Streaming' }, market: { type: 'National' }, media: { shortName: 'Prime Video' } }] };
    expect(parseBroadcast(streaming)).toBe('Prime Video');
  });
});
