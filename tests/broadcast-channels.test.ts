import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mappings from '../data/theleague/broadcast-mappings.json';
import {
  COUNTRY_CODES,
  REDZONE_LOGO,
  SUNDAY_TICKET_LOGO,
  countryOptions,
  normalizeUsNetwork,
  parseCountry,
  resolveChannel,
  sundayTicketProvider,
} from '../src/utils/broadcast-channels';

const LOGOS = resolve(__dirname, '../public/assets/tv-logos');

describe('broadcast-mappings.json — every mark it names is on disk', () => {
  // A logo filename that does not exist renders as a broken image on the
  // multiview box. The NFL Network entry once pointed at a file that was never
  // committed; the chip now falls back to text, and this keeps it that way.
  it('channel logos', () => {
    const missing: string[] = [];
    for (const [code, country] of Object.entries((mappings as any).countries)) {
      for (const [key, ch] of Object.entries((country as any).channels as Record<string, any>)) {
        if (ch.logo && !existsSync(resolve(LOGOS, ch.logo))) missing.push(`${code}/${key} -> ${ch.logo}`);
      }
      const st = (country as any).sundayTicket;
      for (const f of [st?.logo, st?.logoDark]) if (f && !existsSync(resolve(LOGOS, f))) missing.push(`${code}/sundayTicket -> ${f}`);
    }
    expect(missing).toEqual([]);
  });

  it('RedZone and Sunday Ticket marks', () => {
    expect(existsSync(resolve(LOGOS, REDZONE_LOGO.split('/').pop()!))).toBe(true);
    expect(existsSync(resolve(LOGOS, SUNDAY_TICKET_LOGO.split('/').pop()!))).toBe(true);
  });

  it('every country the resolver offers has a mapping with a default carrier (outside the US)', () => {
    for (const code of COUNTRY_CODES) {
      expect((mappings as any).countries[code], code).toBeTruthy();
      if (code !== 'US') expect((mappings as any).countries[code].mapping?.default, `${code} default`).toBeTruthy();
    }
  });
});

describe('parseCountry / countryOptions', () => {
  it('accepts the three codes case-insensitively and defaults to US', () => {
    expect(parseCountry('ca')).toBe('CA');
    expect(parseCountry(' AU ')).toBe('AU');
    expect(parseCountry('UK')).toBe('US');
    expect(parseCountry(null)).toBe('US');
  });

  it('offers US, Canada and Australia with flags', () => {
    expect(countryOptions().map((c) => [c.code, c.name])).toEqual([
      ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'],
    ]);
    expect(countryOptions().every((c) => c.flag.length > 0)).toBe(true);
  });
});

describe('normalizeUsNetwork — ESPN names to mapping keys', () => {
  it('canonicalizes the aliases ESPN actually emits', () => {
    expect(normalizeUsNetwork('cbs')).toBe('CBS');
    expect(normalizeUsNetwork('NFL Net')).toBe('NFL Network');
    expect(normalizeUsNetwork('ESPN/ABC')).toBe('ESPN');
    expect(normalizeUsNetwork('Prime Video')).toBe('Prime Video');
    expect(normalizeUsNetwork('Amazon')).toBe('Prime Video');
    expect(normalizeUsNetwork('Netflix')).toBe('Netflix');
    expect(normalizeUsNetwork('Peacock')).toBe('Peacock');
    expect(normalizeUsNetwork('')).toBe('');
  });
});

describe('resolveChannel', () => {
  it('in the US returns the network with its mark, or the bare name for an unknown one', () => {
    expect(resolveChannel('FOX', 'US')).toMatchObject({ name: 'FOX', logo: '/assets/tv-logos/fox.png' });
    expect(resolveChannel('NFL Network', 'US')).toMatchObject({ name: 'NFL Network', logo: null });
    expect(resolveChannel('Peacock', 'US')).toEqual({ name: 'Peacock', logo: null });
    expect(resolveChannel('', 'US')).toBeNull();
    expect(resolveChannel(undefined, 'CA')).toBeNull();
  });

  it('maps the Sunday networks to DAZN in Canada, NBC to CTV, ESPN to TSN', () => {
    expect(resolveChannel('CBS', 'CA')).toMatchObject({ name: 'DAZN Canada', logo: '/assets/tv-logos/dazn-ca-black.png' });
    expect(resolveChannel('FOX', 'CA')?.name).toBe('DAZN Canada');
    expect(resolveChannel('NBC', 'CA')).toMatchObject({ name: 'CTV', note: 'Sunday Night Football' });
    expect(resolveChannel('ESPN', 'CA')?.name).toBe('TSN');
  });

  it('sends everything to Kayo in Australia', () => {
    for (const n of ['CBS', 'FOX', 'NBC', 'ESPN', 'ABC']) expect(resolveChannel(n, 'AU')?.name).toBe('Kayo Sports');
  });

  it('keeps a global streamer as itself abroad, and sends an unknown TV network to the default carrier', () => {
    expect(resolveChannel('Netflix', 'CA')?.name).toBe('Netflix');
    expect(resolveChannel('Netflix', 'AU')?.logo).toBe('/assets/tv-logos/netflix.png');
    expect(resolveChannel('YouTube', 'CA')).toEqual({ name: 'YouTube', logo: null }); // the São Paulo game: worldwide, never DAZN
    expect(resolveChannel('Peacock', 'CA')?.name).toBe('DAZN Canada');
    expect(resolveChannel('Peacock', 'AU')?.name).toBe('Kayo Sports');
  });
});

describe('sundayTicketProvider', () => {
  it('names the carrier per country with a mark on disk', () => {
    expect(sundayTicketProvider('US')).toMatchObject({ name: 'YouTube TV', logo: '/assets/tv-logos/youtube-tv-black.png' });
    expect(sundayTicketProvider('CA')?.name).toBe('DAZN Canada');
    expect(sundayTicketProvider('AU')?.name).toBe('Kayo Sports');
    for (const code of COUNTRY_CODES) expect(sundayTicketProvider(code)?.note.length).toBeGreaterThan(20);
  });
});

describe('countryTimeZones', () => {
  it('reads ET/PT at home and the Australian clocks with auto labels', async () => {
    const { countryTimeZones } = await import('../src/utils/broadcast-channels');
    expect(countryTimeZones('US').map((z) => z.label)).toEqual(['ET', 'PT']);
    expect(countryTimeZones('CA').map((z) => z.zone)).toEqual(['America/Toronto', 'America/Vancouver']);
    expect(countryTimeZones('AU')).toEqual([
      { zone: 'Australia/Sydney', label: 'auto', locale: 'en-AU' },
      { zone: 'Australia/Perth', label: 'auto', locale: 'en-AU' },
    ]);
  });
});
