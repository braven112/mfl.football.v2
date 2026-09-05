/**
 * Broadcast channels by country — which channel a US network is on in
 * Canada or Australia, and what to draw for it.
 *
 * PURE over `data/theleague/broadcast-mappings.json` (site-wide data that
 * happens to live under TheLeague's data path; the hero and Schefter's
 * broadcast guide read the same file). ESPN gives us the US network per game;
 * this maps it to the viewer's country, with the logo filename under
 * `/assets/tv-logos/` when one exists and the plain name when it doesn't.
 *
 * The original matchup-preview page did this swap client-side from the
 * browser's timezone. Here the country is a URL param remembered in a cookie
 * (`sunday-ticket-selection.ts`), so it renders server-side, stories from
 * props, and needs no script.
 */

import mappings from '../../data/theleague/broadcast-mappings.json';

export type CountryCode = 'US' | 'CA' | 'AU';

export const COUNTRY_CODES: readonly CountryCode[] = ['US', 'CA', 'AU'];
export const DEFAULT_COUNTRY: CountryCode = 'US';

const FLAGS: Record<CountryCode, string> = { US: '🇺🇸', CA: '🇨🇦', AU: '🇦🇺' };

export interface CountryOption {
  code: CountryCode;
  name: string;
  flag: string;
}

export interface ChannelInfo {
  /** Display name in the viewer's country, e.g. "DAZN Canada". */
  name: string;
  /** `/assets/tv-logos/<file>`, or null when the channel has no mark on disk. */
  logo: string | null;
  /** Per-country note ("Most games", "Sunday Night Football"), when the mapping has one. */
  note?: string;
  /** What you need to have — "Cable/Antenna", "DAZN". */
  subscription?: string;
}

/** A clock a viewer reads kickoffs in — see `formatKickoffZones` in the slate module. */
export interface KickoffZone {
  zone: string;
  /** Fixed label (the site's ET / PT convention) or 'auto' for Intl's short name (AEST / AEDT). */
  label: string;
  /** Locale for the auto label; en-AU spells the Australian zones, en-US would say GMT+10. */
  locale?: string;
}

export interface SundayTicketProvider {
  name: string;
  logo: string | null;
  /** A dark-surface variant when the mark has one. */
  logoDark: string | null;
  note: string;
}

const LOGO_BASE = '/assets/tv-logos/';

/** ESPN's short names → the mapping file's US channel keys. */
const US_NETWORK_ALIASES: Record<string, string> = {
  'NFL NET': 'NFL Network',
  NFLN: 'NFL Network',
  'ESPN/ABC': 'ESPN',
  'ABC/ESPN': 'ABC',
  'ESPN+': 'ESPN',
  'ESPN2': 'ESPN',
  AMAZON: 'Prime Video',
  'AMAZON PRIME VIDEO': 'Prime Video',
  'PRIME VIDEO': 'Prime Video',
  PRIME: 'Prime Video',
  NETFLIX: 'Netflix',
  'YOUTUBE': 'YouTube',
};

const countries = (mappings as any).countries as Record<string, any>;

export function parseCountry(raw: string | null | undefined): CountryCode {
  const code = `${raw ?? ''}`.trim().toUpperCase();
  return (COUNTRY_CODES as readonly string[]).includes(code) ? (code as CountryCode) : DEFAULT_COUNTRY;
}

export function countryOptions(): CountryOption[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countries[code]?.name ?? code, flag: FLAGS[code] }));
}

/** Canonical US channel key for an ESPN broadcast name; the name itself when unknown. */
export function normalizeUsNetwork(espnName: string | null | undefined): string {
  const raw = `${espnName ?? ''}`.trim();
  if (!raw) return '';
  const alias = US_NETWORK_ALIASES[raw.toUpperCase()];
  if (alias) return alias;
  const known = Object.keys(countries.US?.channels ?? {}).find((k) => k.toUpperCase() === raw.toUpperCase());
  return known ?? raw;
}

function channelInfo(country: CountryCode, key: string): ChannelInfo | null {
  const entry = countries[country]?.channels?.[key];
  if (!entry) return null;
  const info: ChannelInfo = { name: entry.name ?? key, logo: entry.logo ? `${LOGO_BASE}${entry.logo}` : null };
  if (entry.note) info.note = entry.note;
  if (entry.subscription) info.subscription = entry.subscription;
  return info;
}

/**
 * The channel a game is on in `country`, given its US network from ESPN.
 * Outside the US the mapping wins; a network the mapping does not name falls
 * back to the country's default carrier (DAZN, Kayo) — except a global
 * streamer, which is the same service everywhere and keeps its own mark.
 * Returns null when there is no network at all (ESPN has not published it).
 */
export function resolveChannel(usNetwork: string | null | undefined, country: CountryCode): ChannelInfo | null {
  const key = normalizeUsNetwork(usNetwork);
  if (!key) return null;
  if (country === 'US') return channelInfo('US', key) ?? { name: key, logo: null };

  const mapping = countries[country]?.mapping ?? {};
  const mapped: string | undefined = mapping[key];
  if (mapped) return channelInfo(country, mapped) ?? { name: mapped, logo: null };
  // Unknown to the mapping: a global streamer keeps its US mark; a TV network goes to the default carrier.
  const us = channelInfo('US', key);
  if (us && (key === 'Netflix' || key === 'Prime Video' || key === 'YouTube')) return us;
  const fallback = mapping.default;
  return fallback ? channelInfo(country, fallback) ?? { name: fallback, logo: null } : us ?? { name: key, logo: null };
}

/** Where Sunday Ticket lives in this country — the mark in the window header. */
export function sundayTicketProvider(country: CountryCode): SundayTicketProvider | null {
  const p = countries[country]?.sundayTicket;
  if (!p) return null;
  return {
    name: p.name,
    logo: p.logo ? `${LOGO_BASE}${p.logo}` : null,
    logoDark: p.logoDark ? `${LOGO_BASE}${p.logoDark}` : null,
    note: p.note ?? '',
  };
}

/** The two clocks this country's owners read kickoffs in; ET/PT when the mapping names none. */
export function countryTimeZones(country: CountryCode): KickoffZone[] {
  const zones = countries[country]?.timeZones;
  if (Array.isArray(zones) && zones.length > 0) return zones.map((z: any) => ({ zone: z.zone, label: z.label ?? 'auto', ...(z.locale ? { locale: z.locale } : {}) }));
  return countries.US?.timeZones ?? [{ zone: 'America/New_York', label: 'ET' }, { zone: 'America/Los_Angeles', label: 'PT' }];
}

export const REDZONE_LOGO = `${LOGO_BASE}nfl-red-zone.png`;
