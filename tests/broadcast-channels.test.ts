import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mappings from '../data/theleague/broadcast-mappings.json';
import {
  COUNTRY_CODES,
  REDZONE_LOGO,
  SUNDAY_TICKET_LOGO,
  countryOptions,
  countryTimeZones,
  freeToAirOption,
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
  it('accepts every code case-insensitively and defaults to US', () => {
    expect(parseCountry('ca')).toBe('CA');
    expect(parseCountry(' AU ')).toBe('AU');
    expect(parseCountry('gb')).toBe('GB');
    expect(parseCountry('mx')).toBe('MX');
    expect(parseCountry(null)).toBe('US');
    expect(parseCountry('ZZ')).toBe('US');
  });

  // 'UK' is what a UK owner types, and it used to land them on the US board.
  it('reads the aliases people actually type', () => {
    expect(parseCountry('UK')).toBe('GB');
    expect(parseCountry('gbr')).toBe('GB');
    expect(parseCountry('MEX')).toBe('MX');
    expect(parseCountry('usa')).toBe('US');
  });

  it('offers the five countries with flags', () => {
    expect(countryOptions().map((c) => [c.code, c.name])).toEqual([
      ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'],
      ['GB', 'United Kingdom'], ['MX', 'Mexico'],
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
    expect(resolveChannel('NFL Network', 'US')).toMatchObject({ name: 'NFL Network', logo: '/assets/tv-logos/nfl-network.png' });
    expect(resolveChannel('Peacock', 'US')).toEqual({ name: 'Peacock', logo: null });
    expect(resolveChannel('', 'US')).toBeNull();
    expect(resolveChannel(undefined, 'CA')).toBeNull();
  });

  it('maps the Sunday networks to DAZN in Canada, NBC to CTV, ESPN to TSN', () => {
    expect(resolveChannel('CBS', 'CA')).toMatchObject({ name: 'DAZN Canada', logo: '/assets/tv-logos/dazn-black.png' });
    expect(resolveChannel('FOX', 'CA')?.name).toBe('DAZN Canada');
    expect(resolveChannel('NBC', 'CA')).toMatchObject({ name: 'CTV', note: 'Sunday Night Football' });
    expect(resolveChannel('ESPN', 'CA')?.name).toBe('TSN');
  });

  it('sends everything to Kayo in Australia', () => {
    for (const n of ['CBS', 'FOX', 'NBC', 'ESPN', 'ABC']) expect(resolveChannel(n, 'AU')?.name).toBe('Kayo Sports');
  });

  it('sends the UK slate to Sky Sports, including the Thursday game Prime does not carry there', () => {
    for (const n of ['CBS', 'FOX', 'NBC', 'ESPN', 'ABC', 'NFL Network']) {
      expect(resolveChannel(n, 'GB')?.name, n).toBe('Sky Sports NFL');
    }
    // Prime Video's Thursday package is US-only; in the UK that game is Sky's,
    // so the global-streamer shortcut must not win over an explicit mapping.
    expect(resolveChannel('Prime Video', 'GB')?.name).toBe('Sky Sports NFL');
    expect(resolveChannel('Netflix', 'GB')?.name).toBe('Netflix');
  });

  it('splits Mexico between FOX, ESPN and TUDN, with Game Pass as the catch-all', () => {
    expect(resolveChannel('FOX', 'MX')).toMatchObject({ name: 'FOX México', logo: '/assets/tv-logos/fox-mx.png' });
    expect(resolveChannel('CBS', 'MX')?.name).toBe('TUDN / ViX');
    expect(resolveChannel('NBC', 'MX')?.name).toBe('ESPN México');
    expect(resolveChannel('ESPN', 'MX')?.name).toBe('ESPN México');
    expect(resolveChannel('Peacock', 'MX')?.name).toBe('NFL Game Pass on DAZN');
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
    expect(sundayTicketProvider('GB')).toMatchObject({ name: 'NFL Game Pass on DAZN', logoDark: '/assets/tv-logos/dazn.png' });
    expect(sundayTicketProvider('MX')?.name).toBe('NFL Game Pass on DAZN');
    for (const code of COUNTRY_CODES) expect(sundayTicketProvider(code)?.note.length).toBeGreaterThan(20);
  });
});

describe('countryTimeZones', () => {
  it('reads ET/PT at home and the Australian clocks with auto labels', () => {
    expect(countryTimeZones('US').map((z) => z.label)).toEqual(['ET', 'PT']);
    expect(countryTimeZones('CA').map((z) => z.zone)).toEqual(['America/Toronto', 'America/Vancouver']);
    expect(countryTimeZones('AU')).toEqual([
      { zone: 'Australia/Sydney', label: 'auto', locale: 'en-AU' },
      { zone: 'Australia/Perth', label: 'auto', locale: 'en-AU' },
    ]);
  });

  // The UK is one clock, not two — the second slot is optional, not padding.
  it('gives the UK a single London clock and Mexico its two', () => {
    expect(countryTimeZones('GB')).toEqual([{ zone: 'Europe/London', label: 'auto', locale: 'en-GB' }]);
    expect(countryTimeZones('MX').map((z) => z.zone)).toEqual(['America/Mexico_City', 'America/Tijuana']);
  });
});

describe('freeToAirOption', () => {
  // Which of Sunday's games a free channel picks up is that channel's call,
  // so no US-network key can map to it; the board says it once instead.
  it('names the free channel where there is one, with its mark', () => {
    expect(freeToAirOption('GB')).toMatchObject({ name: 'Channel 5', logo: '/assets/tv-logos/channel-5-uk.png' });
    expect(freeToAirOption('AU')?.name).toBe('7mate');
    expect(freeToAirOption('MX')?.name).toBe('TUDN / ViX');
    for (const code of ['GB', 'AU', 'MX'] as const) {
      expect(freeToAirOption(code)!.note.length, code).toBeGreaterThan(20);
    }
  });

  it('is null where every game is behind a carrier the mapping already names', () => {
    expect(freeToAirOption('US')).toBeNull();
    expect(freeToAirOption('CA')).toBeNull();
  });
});
