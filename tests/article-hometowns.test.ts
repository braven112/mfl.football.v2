import { describe, expect, it, vi, afterEach } from 'vitest';
import { hometownFact, loadHometowns } from '../scripts/article-utils/hometowns.mjs';
import { hometownsKey } from '../src/utils/hometown-geo.mjs';

const nameOf = (id: string) => ({ '0001': 'Pacific Pigskins', '0002': 'Midwestside Connection' })[id] ?? id;
const SPOKANE = { name: 'Spokane', region: 'WA', lat: 47.66, lng: -117.43, kind: 'city' };
const DES_MOINES = { name: 'Des Moines', region: 'IA', lat: 41.59, lng: -93.62, kind: 'city' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hometown fact-sheet line', () => {
  it('names both cities and the miles, as the card prints them', () => {
    const line = hometownFact('0001', '0002', { '0001': SPOKANE, '0002': DES_MOINES }, nameOf);
    expect(line).toBe('Hometowns: Pacific Pigskins represent Spokane, WA; Midwestside Connection represent Des Moines, IA. 1,238 miles apart.');
  });

  it('says nothing unless both teams have picked', () => {
    expect(hometownFact('0001', '0002', { '0001': SPOKANE }, nameOf)).toBeNull();
  });

  it('calls a same-city game what it is', () => {
    expect(hometownFact('0001', '0002', { '0001': SPOKANE, '0002': SPOKANE }, nameOf)).toMatch(/same-city/);
  });

  it('flags a state pick so the copy does not invent a city', () => {
    const florida = { name: 'Florida', region: 'US', lat: 28.6, lng: -82.4, kind: 'state' };
    expect(hometownFact('0001', '0002', { '0001': florida, '0002': DES_MOINES }, nameOf)).toMatch(/Florida \(a whole state/);
  });
});

describe('loadHometowns', () => {
  it('reads the league-scoped hash and drops bad rows', async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      expect(JSON.parse(init.body)).toEqual(['HGETALL', hometownsKey('afl-fantasy')]);
      return new Response(JSON.stringify({ result: ['0001', JSON.stringify(SPOKANE), '0002', 'not json', '0003', '{"name":"x"}'] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const homes = await loadHometowns('afl-fantasy', { redis: { url: 'https://example.test', token: 't' } });
    expect(Object.keys(homes)).toEqual(['0001']);
    expect(homes['0001'].name).toBe('Spokane');
  });

  it('never throws: an outage means no hometowns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
    await expect(loadHometowns('theleague', { redis: { url: 'https://example.test', token: 't' } })).resolves.toEqual({});
    await expect(loadHometowns('theleague', { redis: null })).resolves.toEqual({});
  });
});
