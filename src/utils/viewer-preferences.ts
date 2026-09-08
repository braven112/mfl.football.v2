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
  // One country, one clock — but `auto` rather than a fixed 'GMT', because
  // Britain spends the whole NFL season on BST and only flips back at the end
  // of October. A fixed label would lie for two months of every year.
  GB: [
    { id: 'LON', zone: 'Europe/London', label: 'auto', locale: 'en-GB', short: 'London', name: 'United Kingdom (London)' },
  ],
  // Mexico dropped daylight saving in 2022 EXCEPT along the US border, so
  // Tijuana still flips with California and the rest do not. City labels, not
  // CT/MT/PT: Mexico City is UTC-6 year-round while US Central is -5 half the
  // year, and printing them under the same two letters would be a lie the
  // board tells twice a Sunday.
  MX: [
    { id: 'CUN', zone: 'America/Cancun', label: 'Cancún', name: 'Southeast (Cancún)' },
    { id: 'CDMX', zone: 'America/Mexico_City', label: 'CDMX', name: 'Central (Mexico City, Guadalajara)' },
    { id: 'CHI', zone: 'America/Chihuahua', label: 'Chihuahua', name: 'Pacific (Chihuahua, Mazatlán)' },
    { id: 'TIJ', zone: 'America/Tijuana', label: 'Tijuana', name: 'Northwest (Tijuana)' },
  ],
};

/**
 * A league's official clock: the zone it keeps its own time in (lineup locks,
 * auction windows, the 8:45 rollover), printed beside whatever clock a viewer
 * has chosen for themselves.
 *
 * `equivalents` are zones that ARE this clock — the same wall clock all year,
 * DST flips included. An IDENTITY list, never computed from a current offset.
 */
export interface LeagueClock extends ZoneOption {
  equivalents?: readonly string[];
}

/**
 * THE FALLBACK CLOCK, for a caller that cannot name its league. Pacific,
 * which is what every league in the registry is set to.
 *
 * It is NOT the setting. The setting is `officialClock` in
 * `src/config/leagues-data.mjs`, read with `leagueClock(slug)` — and this
 * module deliberately does not import the registry to get it, because
 * `viewer-preferences.ts` is in Storybook's rendering graph and pulling the
 * registry in would wake every Sunday Ticket snapshot on any registry edit
 * (docs/claude/rules/viewer-preferences.md). So the clock travels IN, as a
 * value: every function below takes one, and this constant is only what they
 * fall back to. Anything holding a league slug must pass that league's clock
 * rather than letting the fallback answer for it.
 *
 * The clock is appended automatically rather than chosen: a viewer picks the
 * ONE clock they live in and gets this one beside it — dropped when they
 * already live on it, because "1:00 PM PT · 1:00 PM PT" helps nobody.
 */
export const LEAGUE_CLOCK: LeagueClock = {
  id: 'PT',
  zone: 'America/Los_Angeles',
  label: 'PT',
  name: "The league's clock (Pacific)",
  equivalents: ['America/Vancouver', 'America/Tijuana'],
};

/**
 * The clock a country starts on — the one a viewer who never opens the picker
 * reads Sunday Ticket in.
 *
 * The US opens on PACIFIC, deliberately and against the pre-preferences board:
 * it printed ET · PT, and most owners in both leagues are on the west coast,
 * so leading with Eastern put the wrong clock first for the majority. Because
 * PT is also every league's official clock, `kickoffZonesFor` drops the
 * duplicate and the board shows PT alone for them. Changing this is changing
 * every such viewer's board — the reason it is a single named constant.
 *
 * CANADA stays on Eastern: the argument above is about where THIS league's
 * owners live, and it does not transfer to a country whose own default nobody
 * has re-examined. `tests/viewer-preferences.test.ts` pins CA against
 * `countryTimeZones` and pins the US departure explicitly.
 */
export const DEFAULT_ZONE_IDS: Record<CountryCode, string> = {
  US: 'PT',
  CA: 'ET',
  AU: 'SYD',
  GB: 'LON',
  MX: 'CDMX',
};

/** The country's options, or the default country's for anything unrecognized. */
export function zoneOptionsFor(country: CountryCode): readonly ZoneOption[] {
  return ZONE_OPTIONS[country] ?? ZONE_OPTIONS[DEFAULT_COUNTRY];
}

/**
 * The cookie pair a choice is stored in. Declared HERE, in the pure module,
 * because both halves need the same two strings: the route glue writes them
 * (`viewer-preferences-page.ts`) and a client island reads them back
 * (`clockZonesFromCookie`). Two spellings of a cookie name is a bug that only
 * shows up as "my preference did not stick".
 */
export const COUNTRY_COOKIE = 'pref_country';
export const ZONE_COOKIE = 'pref_zone';

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
export function chosenZone(prefs: ViewerPreferences, league: LeagueClock = LEAGUE_CLOCK): ZoneOption {
  const options = zoneOptionsFor(prefs.country);
  return (
    options.find((z) => z.id === prefs.zoneId) ??
    options.find((z) => z.id === DEFAULT_ZONE_IDS[prefs.country]) ??
    league
  );
}

/**
 * True when a viewer's own clock already IS the league's, so it must not
 * repeat. Matches the clock's zone or any of its declared equivalents.
 */
export function isLeagueClock(
  opt: Pick<ZoneOption, 'zone'>,
  league: LeagueClock = LEAGUE_CLOCK,
): boolean {
  return opt.zone === league.zone || !!league.equivalents?.includes(opt.zone);
}

const toKickoffZone = ({ zone, label, locale }: ZoneOption): KickoffZone =>
  locale ? { zone, label, locale } : { zone, label };

/**
 * The zones `formatKickoffZones` prints: the viewer's own clock, then the
 * LEAGUE's PT beside it — dropped when the viewer already lives on Pacific,
 * because "1:00 PM PT · 1:00 PM PT" is noise. Never returns an empty list, so
 * a bad stored id can't yield a clockless board.
 */
export function kickoffZonesFor(
  prefs: ViewerPreferences,
  league: LeagueClock = LEAGUE_CLOCK,
): KickoffZone[] {
  const own = chosenZone(prefs, league);
  return isLeagueClock(own, league)
    ? [toKickoffZone(own)]
    : [toKickoffZone(own), toKickoffZone(league)];
}

/**
 * A viewer's clocks PLUS whether they actually picked them.
 *
 * The distinction is load-bearing, and it survives the two floors having
 * converged. Sunday Ticket prints the COUNTRY's default clock; every other
 * surface — a waiver deadline, a draft start, a poll close — prints the
 * LEAGUE's official one alone. Both now resolve to PT for a US viewer who has
 * chosen nothing, so the two paths currently agree by coincidence, not by
 * design: a country default is about where the viewer is, a league clock about
 * where the league keeps its time, and either can move without the other.
 * Collapsing them because today's answers match is how the Eastern default
 * would come back for every owner the next time a country is re-examined.
 *
 * So `explicit` records where the answer came from. It is TRUE only for an
 * answer the owner is responsible for:
 *   - a cookie on this device (written ONLY by an explicit choice), or
 *   - their account mirror (written ONLY by an explicit choice), or
 *   - a SEEDED default, which is a fact we were told about that owner.
 * It is FALSE for the bare catalog default, which is a guess.
 */
export interface ViewerClock {
  prefs: ViewerPreferences;
  explicit: boolean;
  /**
   * The OFFICIAL clock of the league whose page is rendering — the registry's
   * `officialClock`, attached by `readViewerClock` from the slug its caller
   * passed. It rides along here rather than being threaded through every
   * formatter because `eventZonesFor` is the single choke point every league
   * moment goes through (`formatForViewer`, `viewerClockZone`,
   * `waiver-window`), so one field spares all of them a signature.
   *
   * Absent means "no league was named", and the fallback answers. That is
   * correct for a device-only read, and a bug anywhere a slug was available.
   */
  leagueClock?: LeagueClock;
}

/** Nobody has chosen: the league's own clock, which is what these surfaces printed before preferences existed. */
export const DEFAULT_VIEWER_CLOCK: ViewerClock = {
  prefs: DEFAULT_VIEWER_PREFERENCES,
  explicit: false,
};

/**
 * The zones a LEAGUE EVENT prints in — a draft start, a waiver window, a poll
 * deadline. The league's PT is the floor here, not a passenger: these events
 * happen on the league's clock, and a viewer's own is added only once they
 * have actually named one.
 *
 * Contrast `kickoffZonesFor`, which Sunday Ticket uses: an NFL kickoff is not
 * the league's event, and that board's floor is the COUNTRY's default pair.
 */
export function eventZonesFor(clock: ViewerClock): KickoffZone[] {
  const league = clock.leagueClock ?? LEAGUE_CLOCK;
  return clock.explicit ? kickoffZonesFor(clock.prefs, league) : [toKickoffZone(league)];
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

  // ---------------------------------------------------------------------
  // AFL owners confirmed on US Pacific by the commissioner, Sep 2026.
  //
  // Seeding an owner onto the clock the site ALREADY defaults to looks
  // redundant and is not: a seed is an ANSWER, and the absence of one is a
  // question. The drawer nudges anyone it has no answer for to go and set a
  // clock, so without these, seven owners who are exactly where the site
  // assumes would be pulsed at forever about a preference they would only be
  // re-typing. Nothing else about their site changes — US/PT resolves to the
  // same PT-alone board the bare default gives them.
  // ---------------------------------------------------------------------
  /** Drunk Indians. */
  'afl-fantasy:0002': { country: 'US', zoneId: 'PT' },
  /** Da Dangsters (Monty Fresh). */
  'afl-fantasy:0006': { country: 'US', zoneId: 'PT' },
  /** Harambe. */
  'afl-fantasy:0008': { country: 'US', zoneId: 'PT' },
  /** Midwestside. */
  'afl-fantasy:0011': { country: 'US', zoneId: 'PT' },
  /** Suh girls. */
  'afl-fantasy:0012': { country: 'US', zoneId: 'PT' },
  /** Bruin Pegs Me. */
  'afl-fantasy:0014': { country: 'US', zoneId: 'PT' },
  /** Chatmaster. */
  'afl-fantasy:0021': { country: 'US', zoneId: 'PT' },
  // Two of them play BOTH leagues, and the key is <slug>:<franchiseId>, so
  // each side needs its own entry — the same person is a different key here.
  // Confirmed by the commissioner, not inferred from the matching team name:
  // a shared name across leagues is not evidence of a shared owner, and this
  // map is only ever written from someone saying so.
  /** Da Dangsters (Monty Fresh) — same owner as afl-fantasy:0006. */
  'theleague:0002': { country: 'US', zoneId: 'PT' },
  /** Midwestside — same owner as afl-fantasy:0011. */
  'theleague:0011': { country: 'US', zoneId: 'PT' },

  // US CENTRAL, both leagues. Unlike the PT entries above these change what
  // the owner SEES — every league moment prints "… CT · PT" for them instead
  // of PT alone — which is the point: they were reading Pacific and doing the
  // two-hour conversion in their head.
  /** Computer Jocks. */
  'theleague:0010': { country: 'US', zoneId: 'CT' },
  'afl-fantasy:0005': { country: 'US', zoneId: 'CT' },
  /** Vitside / Vitside Mafia. */
  'theleague:0012': { country: 'US', zoneId: 'CT' },
  'afl-fantasy:0009': { country: 'US', zoneId: 'CT' },
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
export function zoneSummary(prefs: ViewerPreferences, league: LeagueClock = LEAGUE_CLOCK): string {
  const own = chosenZone(prefs, league);
  return isLeagueClock(own, league)
    ? zoneShortName(own)
    : `${zoneShortName(own)} · ${zoneShortName(league)}`;
}

export { COUNTRY_CODES };

/**
 * The offset `zone` is running at a given instant, in milliseconds. Derived by
 * formatting the instant IN the zone and reading the wall clock back, which is
 * the only way to get it right across a DST boundary — a fixed offset per zone
 * is wrong for half the year.
 */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour` comes back as 24 at midnight under hour12:false in some ICU builds.
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return wall - instant;
}

/**
 * A representative kickoff for the preview on the preferences page: the coming
 * Sunday at 1:00 PM ET, the window every NFL Sunday starts with. Returned as
 * an epoch in seconds — the unit `formatKickoffZones` takes.
 *
 * Solved rather than offset-shifted: the ET offset on the SUNDAY is what
 * matters, not today's. In a DST-transition week those differ by an hour, and
 * an offset borrowed from `now` printed the preview as "12:00 PM ET" under a
 * caption that says 1:00 PM. Two passes, because the first guess can land on
 * the wrong side of the transition; 1pm is never the ambiguous hour itself.
 */
export function nextSundayKickoffEpoch(now: Date = new Date()): number {
  const ET = 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow = Math.max(0, DAYS.indexOf(part('weekday')));
  const daysAhead = dow === 0 ? 0 : 7 - dow;

  // The Sunday's 1pm ET wall clock, read as if it were UTC.
  const wall = Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')) + daysAhead, 13, 0, 0);
  let instant = wall - zoneOffsetMs(wall, ET);
  instant = wall - zoneOffsetMs(instant, ET);
  return Math.floor(instant / 1000);
}
