import { describe, it, expect } from 'vitest';
import { parseInstalledApps, watchCountry, watchRow, type InstalledApp } from '../src/utils/where-to-watch';
import type { WatchGame } from '../src/utils/broadcast-overlay';

const game = (over: Partial<WatchGame> = {}): WatchGame => ({
  id: '1',
  label: 'SEA @ SF',
  query: 'Seattle Seahawks vs San Francisco 49ers',
  network: 'FOX',
  live: false,
  detail: 'Sun 4:25 PM ET',
  kickoff: '2026-11-01T21:25:00Z',
  players: ['Smith-Njigba'],
  regional: false,
  ...over,
});

const YTTV: InstalledApp = { pkg: 'com.google.android.youtube.tvunplugged', label: 'YouTube TV' };
const PRIME: InstalledApp = { pkg: 'com.amazon.amazonvideo.livingroom', label: 'Prime Video' };
const DAZN_UNKNOWN_PKG: InstalledApp = { pkg: 'com.dazn.tv.somewhere', label: 'DAZN' };

describe('where to watch', () => {
  it('sends a US network game to the TV search, with YouTube TV as the fallback', () => {
    const row = watchRow(game(), { country: 'US', sundayTicket: false, installed: [YTTV, PRIME] });
    expect(row.how).toBe('YouTube TV');
    expect(row.action).toEqual({ kind: 'search', query: 'Seattle Seahawks vs San Francisco 49ers', fallback: YTTV.pkg });
  });

  it('opens a streamer directly', () => {
    const row = watchRow(game({ network: 'Prime Video' }), { country: 'US', sundayTicket: false, installed: [YTTV, PRIME] });
    expect(row.action).toEqual({ kind: 'app', pkg: PRIME.pkg });
    expect(row.how).toBe('Prime Video');
  });

  it('says a regional game may not be on without Sunday Ticket', () => {
    const without = watchRow(game({ regional: true }), { country: 'US', sundayTicket: false, installed: [YTTV] });
    expect(without.maybe).toBe(true);
    expect(without.how).toMatch(/local game/);
    const withTicket = watchRow(game({ regional: true }), { country: 'US', sundayTicket: true, installed: [YTTV] });
    expect(withTicket.maybe).toBe(false);
    expect(withTicket.how).toBe('YouTube TV · Sunday Ticket');
  });

  it('maps a Canadian viewer to DAZN, matching the app by its label', () => {
    const row = watchRow(game(), { country: 'CA', sundayTicket: false, installed: [DAZN_UNKNOWN_PKG] });
    expect(row.channel?.name).toMatch(/DAZN/);
    expect(row.action).toEqual({ kind: 'app', pkg: DAZN_UNKNOWN_PKG.pkg });
    // Regional splits are a US thing.
    expect(watchRow(game({ regional: true }), { country: 'CA', sundayTicket: false, installed: [] }).maybe).toBe(false);
  });

  it('falls back to the TV search when nothing installed fits', () => {
    const row = watchRow(game({ network: 'Netflix' }), { country: 'US', sundayTicket: false, installed: [YTTV] });
    expect(row.app).toBeNull();
    expect(row.action).toEqual({ kind: 'search', query: row.query });
  });

  it('names the likeliest app without a launch when the TV cannot list its apps', () => {
    const row = watchRow(game({ network: 'NBC' }), { country: 'US', sundayTicket: false, installed: null });
    expect(row.app).toEqual({ name: 'YouTube TV', pkg: null });
    expect(row.action.kind).toBe('search');
  });

  it('prefers the chosen country, then the connection, then the US', () => {
    expect(watchCountry('CA', 'US')).toBe('CA');
    expect(watchCountry(null, 'CA')).toBe('CA');
    expect(watchCountry(null, null)).toBe('US');
    expect(watchCountry(null, 'FR')).toBe('US');
  });

  it('reads the bridge answer defensively', () => {
    expect(parseInstalledApps('[{"pkg":"a","label":"A"},{"x":1}]')).toEqual([{ pkg: 'a', label: 'A' }]);
    expect(parseInstalledApps('nope')).toBeNull();
    expect(parseInstalledApps(undefined)).toBeNull();
  });
});
