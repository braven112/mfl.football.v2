/**
 * Viewer preferences — the country whose channels you see, and the clocks
 * kickoffs are printed in.
 *
 * PURE and dependency-light on purpose (the catalog + `broadcast-channels`,
 * nothing else): the Sunday Ticket board components import from here, and
 * Chromatic's dependency guard treats everything a story can reach as a
 * rendering file. The Redis half lives in `viewer-preferences-store.ts` and
 * the route glue in `viewer-preferences-page.ts`, so a change there does not
 * wake every board snapshot.
 *
 * This started as the Sunday Ticket board's `?country=` chip row, where the
 * clocks were DERIVED from the country (US → ET + PT, always). It is a
 * preference now: the country still picks which zone list you choose from,
 * but WHICH of that country's clocks you read is yours — a Chicago owner
 * gets CT, a Perth owner gets AWST first. Sunday Ticket is the first reader;
 * anything else that prints a kickoff can take the same two values.
 *
 * Storage is a cookie (renders instantly, works signed out) mirrored to
 * Redis for a signed-in owner so the choice follows them to another device.
 * The cookie wins on the device it was set — see `viewer-preferences-page.ts`.
 */

import {
  COUNTRY_CODES,
  DEFAULT_COUNTRY,
  countryTimeZones,
  parseCountry,
  type CountryCode,
  type KickoffZone,
} from './broadcast-channels';

export { DEFAULT_COUNTRY, parseCountry, type CountryCode };

/** One clock a viewer can choose, within a country. */
export interface ZoneOption {
  /** Stable id stored in the cookie / Redis. Unique within its country. */
  id: string;
  /** IANA zone. */
  zone: string;
  /** Fixed label (the site's ET / PT convention) or 'auto' for Intl's short name (AEST / AEDT). */
  label: string;
  /** Locale for the auto label; en-AU spells the Australian zones, en-US would say GMT+10. */
  locale?: string;
  /** What the picker calls it — "Central (Chicago, Dallas)". */
  name: string;
  /**
   * The chip-sized name. Defaults to `label`, which is right for a fixed one;
   * an `auto` zone needs a city here because its real label (AEST vs AEDT) is
   * only knowable once you have a date to format.
   */
  short?: string;
}

/**
 * The clocks on offer per country, EAST TO WEST, which is also the order they
 * print in ("1:00 PM ET · 10:00 AM PT"). Fixed labels for North America
 * because that is the site's convention everywhere else; `auto` in Australia
 * so the summer DST flip (AEST → AEDT) shows rather than lying for four
 * months.
 */
export const ZONE_OPTIONS: Record<CountryCode, readonly ZoneOption[]> = {
  US: [
    { id: 'ET', zone: 'America/New_York', label: 'ET', name: 'Eastern (New York, Atlanta)' },
    { id: 'CT', zone: 'America/Chicago', label: 'CT', name: 'Central (Chicago, Dallas)' },
    { id: 'MT', zone: 'America/Denver', label: 'MT', name: 'Mountain (Denver, Salt Lake City)' },
    { id: 'AZ', zone: 'America/Phoenix', label: 'MST', name: 'Arizona (no daylight saving)' },
    { id: 'PT', zone: 'America/Los_Angeles', label: 'PT', name: 'Pacific (Los Angeles, Seattle)' },
    { id: 'AKT', zone: 'America/Anchorage', label: 'AKT', name: 'Alaska (Anchorage)' },
    { id: 'HT', zone: 'Pacific/Honolulu', label: 'HT', name: 'Hawaii (Honolulu)' },
  ],
  CA: [
    { id: 'NT', zone: 'America/St_Johns', label: 'NT', name: "Newfoundland (St. John's)" },
    { id: 'AT', zone: 'America/Halifax', label: 'AT', name: 'Atlantic (Halifax)' },
    { id: 'ET', zone: 'America/Toronto', label: 'ET', name: 'Eastern (Toronto, Montreal)' },
    { id: 'CT', zone: 'America/Winnipeg', label: 'CT', name: 'Central (Winnipeg)' },
    { id: 'MT', zone: 'America/Edmonton', label: 'MT', name: 'Mountain (Calgary, Edmonton)' },
    { id: 'PT', zone: 'America/Vancouver', label: 'PT', name: 'Pacific (Vancouver)' },
  ],
  AU: [
    { id: 'SYD', zone: 'Australia/Sydney', label: 'auto', locale: 'en-AU', short: 'Sydney', name: 'Eastern (Sydney, Melbourne)' },
    { id: 'BNE', zone: 'Australia/Brisbane', label: 'auto', locale: 'en-AU', short: 'Brisbane', name: 'Queensland (Brisbane)' },
    { id: 'ADL', zone: 'Australia/Adelaide', label: 'auto', locale: 'en-AU', short: 'Adelaide', name: 'Central (Adelaide)' },
    { id: 'PER', zone: 'Australia/Perth', label: 'auto', locale: 'en-AU', short: 'Perth', name: 'Western (Perth)' },
  ],
};

/**
 * The pair a country starts with — byte-for-byte the clocks the board showed
 * before anyone could choose, so an owner who never opens the preferences
 * page sees exactly what they saw yesterday.
 * `tests/viewer-preferences.test.ts` pins each against `countryTimeZones`.
 */
export const DEFAULT_ZONE_IDS: Record<CountryCode, readonly string[]> = {
  US: ['ET', 'PT'],
  CA: ['ET', 'PT'],
  AU: ['SYD', 'PER'],
};

/** How many clocks a viewer may print at once. Two fits the box; three wraps it. */
export const MAX_ZONES = 2;

/** The country's options, or the default country's for anything unrecognized. */
export function zoneOptionsFor(country: CountryCode): readonly ZoneOption[] {
  return ZONE_OPTIONS[country] ?? ZONE_OPTIONS[DEFAULT_COUNTRY];
}

/** What a viewer has chosen: whose channels, and which clocks. */
export interface ViewerPreferences {
  country: CountryCode;
  /** 1..MAX_ZONES ids, valid for `country`, in catalog order. */
  zoneIds: string[];
}

export const DEFAULT_VIEWER_PREFERENCES: ViewerPreferences = {
  country: DEFAULT_COUNTRY,
  zoneIds: [...DEFAULT_ZONE_IDS[DEFAULT_COUNTRY]],
};

/**
 * Parse a stored/submitted zone list against a COUNTRY. Ids the country does
 * not have are dropped, which is the whole reason this takes the country:
 * switching from the US to Australia leaves `ET,PT` behind, and falling back
 * to that country's default pair is the only sane reading — an empty list
 * would print no clock at all. Order follows the catalog, never the input, so
 * the two clocks never swap places between visits.
 */
export function parseZoneSelection(
  raw: string | readonly string[] | null | undefined,
  country: CountryCode,
): string[] {
  const parts = Array.isArray(raw) ? raw : `${raw ?? ''}`.split(',');
  const wanted = new Set(parts.map((p) => `${p}`.trim().toUpperCase()).filter(Boolean));
  const picked = zoneOptionsFor(country)
    .filter((z) => wanted.has(z.id))
    .map((z) => z.id)
    .slice(0, MAX_ZONES);
  return picked.length > 0 ? picked : [...DEFAULT_ZONE_IDS[country]];
}

/** Country + zones from any pair of raw values (cookie, URL param, Redis). */
export function parseViewerPreferences(
  rawCountry: string | null | undefined,
  rawZones: string | readonly string[] | null | undefined,
): ViewerPreferences {
  const country = parseCountry(rawCountry);
  return { country, zoneIds: parseZoneSelection(rawZones, country) };
}

/** True when these are the untouched defaults — used to keep cookies/URLs clean. */
export function isDefaultViewerPreferences(prefs: ViewerPreferences): boolean {
  const defaults = DEFAULT_ZONE_IDS[prefs.country];
  return (
    prefs.country === DEFAULT_COUNTRY &&
    prefs.zoneIds.length === defaults.length &&
    prefs.zoneIds.every((id, i) => id === defaults[i])
  );
}

/**
 * The zones `formatKickoffZones` prints, for these preferences. Falls back to
 * the mapping file's pair (`countryTimeZones`) if a catalog entry ever goes
 * missing, so a bad id can never yield a clockless board.
 */
export function kickoffZonesFor(prefs: ViewerPreferences): KickoffZone[] {
  const options = zoneOptionsFor(prefs.country);
  const zones = prefs.zoneIds
    .map((id) => options.find((z) => z.id === id))
    .filter((z): z is ZoneOption => !!z)
    .map(({ zone, label, locale }) => (locale ? { zone, label, locale } : { zone, label }));
  return zones.length > 0 ? zones : countryTimeZones(prefs.country);
}

/** The chip-sized name for one option — "ET", "Sydney". */
export function zoneShortName(opt: ZoneOption): string {
  return opt.short ?? opt.label;
}

/** "ET · PT" / "Sydney · Perth" — the one-line summary the board and picker show. */
export function zoneSummary(prefs: ViewerPreferences): string {
  const options = zoneOptionsFor(prefs.country);
  return prefs.zoneIds
    .map((id) => {
      const opt = options.find((z) => z.id === id);
      return opt ? zoneShortName(opt) : id;
    })
    .join(' · ');
}

export { COUNTRY_CODES };

/**
 * A representative kickoff for the preview on the preferences page: the
 * coming Sunday at 1:00 PM ET, the window every NFL Sunday starts with.
 * Built from ET parts rather than a UTC offset so it stays 1pm through the
 * November DST flip, and returned as an epoch in seconds — the unit
 * `formatKickoffZones` takes.
 */
export function nextSundayKickoffEpoch(now: Date = new Date()): number {
  // ET's offset on the day in question; `now`'s is close enough for a sample
  // and the ± hour never moves a 1pm kickoff across a day boundary at home.
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false,
  }).formatToParts(now);
  const part = (type: string) => etParts.find((p) => p.type === type)?.value ?? '0';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow = Math.max(0, DAYS.indexOf(part('weekday')));
  // The ET wall clock, expressed as a UTC instant, tells us the zone's offset.
  const etWall = Date.UTC(
    Number(part('year')), Number(part('month')) - 1, Number(part('day')),
    Number(part('hour')) % 24, Number(part('minute')), Number(part('second')),
  );
  const offsetMs = etWall - Math.floor(now.getTime() / 1000) * 1000;
  const daysAhead = dow === 0 ? 0 : 7 - dow;
  const sundayNoonEt = Date.UTC(
    Number(part('year')), Number(part('month')) - 1, Number(part('day')) + daysAhead, 13, 0, 0,
  );
  return Math.floor((sundayNoonEt - offsetMs) / 1000);
}
