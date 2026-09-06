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
 * THE LEAGUE'S CLOCK. Pacific — the clock the league keeps its own time in
 * (lineup locks, auction windows, the 8:45 PT rollover), so it is the shared
 * reference every kickoff is printed against no matter where the viewer is.
 *
 * It is appended automatically rather than chosen: a viewer picks the ONE
 * clock they live in and gets this one beside it. The exception is a viewer
 * who already lives on Pacific — printing "1:00 PM PT · 1:00 PM PT" helps
 * nobody, so `kickoffZonesFor` drops it for them.
 */
export const LEAGUE_CLOCK: ZoneOption = {
  id: 'PT',
  zone: 'America/Los_Angeles',
  label: 'PT',
  name: "The league's clock (Pacific)",
};

/**
 * Zones that ARE the league clock, so appending it would print the same time
 * twice. Canada's Pacific and Baja keep the same wall clock as Los Angeles
 * year-round, DST flips included — this is an identity list, not a snapshot
 * of today's offsets.
 */
const LEAGUE_CLOCK_EQUIVALENTS = new Set([
  LEAGUE_CLOCK.zone,
  'America/Vancouver',
  'America/Tijuana',
]);

/**
 * The clock a country starts on. Chosen so the board an owner who never opens
 * the picker sees is the one it showed before preferences existed: the US and
 * Canada open on Eastern, which with the league clock beside it is the
 * ET · PT the board has always printed.
 * `tests/viewer-preferences.test.ts` pins each against `countryTimeZones`.
 */
export const DEFAULT_ZONE_IDS: Record<CountryCode, string> = {
  US: 'ET',
  CA: 'ET',
  AU: 'SYD',
};

/** The country's options, or the default country's for anything unrecognized. */
export function zoneOptionsFor(country: CountryCode): readonly ZoneOption[] {
  return ZONE_OPTIONS[country] ?? ZONE_OPTIONS[DEFAULT_COUNTRY];
}

/** What a viewer has chosen: whose channels, and the one clock they live in. */
export interface ViewerPreferences {
  country: CountryCode;
  /** One id from `country`'s catalog. The league's PT is added at render time. */
  zoneId: string;
}

export const DEFAULT_VIEWER_PREFERENCES: ViewerPreferences = {
  country: DEFAULT_COUNTRY,
  zoneId: DEFAULT_ZONE_IDS[DEFAULT_COUNTRY],
};

/**
 * Parse a stored/submitted zone against a COUNTRY. An id the country does not
 * have is dropped, which is the whole reason this takes the country:
 * switching from the US to Australia leaves `ET` behind, and falling back to
 * that country's own default is the only sane reading — nothing would print
 * no clock at all. Accepts a list (the picker submits one value, but a stored
 * value from an earlier shape may carry two) and takes the first id that
 * fits, in catalog order, so the answer never depends on input order.
 */
export function parseZoneSelection(
  raw: string | readonly string[] | null | undefined,
  country: CountryCode,
): string {
  const parts = Array.isArray(raw) ? raw : `${raw ?? ''}`.split(',');
  const wanted = new Set(parts.map((p) => `${p}`.trim().toUpperCase()).filter(Boolean));
  const picked = zoneOptionsFor(country).find((z) => wanted.has(z.id));
  return picked ? picked.id : DEFAULT_ZONE_IDS[country];
}

/** Country + clock from any pair of raw values (cookie, URL param, Redis). */
export function parseViewerPreferences(
  rawCountry: string | null | undefined,
  rawZone: string | readonly string[] | null | undefined,
): ViewerPreferences {
  const country = parseCountry(rawCountry);
  return { country, zoneId: parseZoneSelection(rawZone, country) };
}

/** True when these are the untouched defaults — used to keep cookies/URLs clean. */
export function isDefaultViewerPreferences(prefs: ViewerPreferences): boolean {
  return prefs.country === DEFAULT_COUNTRY && prefs.zoneId === DEFAULT_ZONE_IDS[DEFAULT_COUNTRY];
}

/** The chosen option, or the country's default when the id no longer exists. */
export function chosenZone(prefs: ViewerPreferences): ZoneOption {
  const options = zoneOptionsFor(prefs.country);
  return (
    options.find((z) => z.id === prefs.zoneId) ??
    options.find((z) => z.id === DEFAULT_ZONE_IDS[prefs.country]) ??
    LEAGUE_CLOCK
  );
}

/** True when a viewer's own clock already IS the league's, so PT must not repeat. */
export function isLeagueClock(opt: Pick<ZoneOption, 'zone'>): boolean {
  return LEAGUE_CLOCK_EQUIVALENTS.has(opt.zone);
}

const toKickoffZone = ({ zone, label, locale }: ZoneOption): KickoffZone =>
  locale ? { zone, label, locale } : { zone, label };

/**
 * The zones `formatKickoffZones` prints: the viewer's own clock, then the
 * LEAGUE's PT beside it — dropped when the viewer already lives on Pacific,
 * because "1:00 PM PT · 1:00 PM PT" is noise. Never returns an empty list, so
 * a bad stored id can't yield a clockless board.
 */
export function kickoffZonesFor(prefs: ViewerPreferences): KickoffZone[] {
  const own = chosenZone(prefs);
  return isLeagueClock(own) ? [toKickoffZone(own)] : [toKickoffZone(own), toKickoffZone(LEAGUE_CLOCK)];
}

/**
 * SEEDED DEFAULTS — the owners we already know don't live on the league's
 * clock, so their first visit is right without them having to set anything.
 *
 * Keyed `<registry slug>:<franchiseId>` because both leagues have a franchise
 * 0001. This is a FALLBACK, not a write: it is consulted only when the device
 * has no cookie and the owner has stored nothing, and it is never persisted —
 * so a correction here reaches the owner, and the moment they choose for
 * themselves their choice outranks it forever.
 *
 * Adding one: the honest source is the owner telling you, or the franchise
 * saying so itself (Maverick's own loader quips run on Sydney time). Do not
 * infer a zone from a team name.
 */
export const SEEDED_PREFERENCES: Record<string, ViewerPreferences> = {
  // Wascawy Wabbits — Canada, and already on the league's own clock, so the
  // board prints PT alone for them.
  'theleague:0009': { country: 'CA', zoneId: 'PT' },
  // Running down the Dream — Canada, Eastern.
  'theleague:0016': { country: 'CA', zoneId: 'ET' },
  // Maverick — Australia, Sydney ("Operating on Sydney time again…").
  'theleague:0003': { country: 'AU', zoneId: 'SYD' },
};

/** The seeded preference for an owner, or null. Both arguments are required — a bare franchise id is ambiguous across leagues. */
export function seededPreferencesFor(leagueSlug: string | null | undefined, franchiseId: string | null | undefined): ViewerPreferences | null {
  if (!leagueSlug || !franchiseId) return null;
  const seed = SEEDED_PREFERENCES[`${leagueSlug}:${franchiseId}`];
  // Re-parsed so a typo'd seed degrades to that country's default rather than
  // rendering a zone the catalog does not have.
  return seed ? parseViewerPreferences(seed.country, seed.zoneId) : null;
}

/** The chip-sized name for one option — "ET", "Sydney". */
export function zoneShortName(opt: ZoneOption): string {
  return opt.short ?? opt.label;
}

/** "ET · PT" / "Sydney · PT" / "PT" — the one-line summary the board and picker show. */
export function zoneSummary(prefs: ViewerPreferences): string {
  const own = chosenZone(prefs);
  return isLeagueClock(own)
    ? zoneShortName(own)
    : `${zoneShortName(own)} · ${zoneShortName(LEAGUE_CLOCK)}`;
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
