/**
 * A league moment, printed in the clocks the VIEWER chose.
 *
 * `/preferences` lets a viewer name the one clock they live in; the league's
 * PT rides along beside it. Sunday Ticket was the first reader — this is the
 * same rendering for everything else the site dates: a draft start, a waiver
 * window, a poll deadline, a "last updated" stamp.
 *
 * WHY THIS IS NOT `formatKickoffZones`. Two differences, both semantic.
 *
 * The ANCHOR. That one is the NFL's renderer and anchors its day on EASTERN,
 * because a game's identity is its Eastern kickoff — "the Sunday 1pm window"
 * is 1pm ET whoever is watching. A league event has no Eastern identity; it
 * happens on the LEAGUE's clock, so the anchor here is the FIRST zone, which
 * is the viewer's own. That is what turns a Thursday 7pm PT draft into
 * "Fri 12:00 PM AEDT · Thu 7:00 PM PT" for a Sydney owner: their day leads,
 * and PT carries the weekday only because it disagrees.
 *
 * The FLOOR. Sunday Ticket has always printed the country's default pair, so
 * `kickoffZonesFor` starts from it. These surfaces have always printed the
 * league's PT alone, so `eventZonesFor` starts from THAT and adds the viewer's
 * clock only once they have actually named one. Same preference, two honest
 * defaults — see `ViewerClock`.
 *
 * PURE, and imports only `viewer-preferences` — same reason that file is
 * dependency-light. Route-only rules do not apply: nothing here reads a
 * cookie or writes one. The clock comes from the route (`readViewerClock`)
 * and arrives as a prop.
 */

import { resolveZoneLabel, type ZoneLabelSpec } from './zone-label';
import {
  COUNTRY_COOKIE,
  DEFAULT_VIEWER_CLOCK,
  ZONE_COOKIE,
  eventZonesFor,
  parseViewerPreferences,
  type ViewerClock,
} from './viewer-preferences';

export { DEFAULT_VIEWER_CLOCK };

/**
 * The zone spec both renderers take. Aliased from the leaf module so a caller
 * needs one import, not two.
 */
export type ClockZoneSpec = ZoneLabelSpec;
export { resolveZoneLabel };

export interface ClockFormatOptions {
  /** Print the short weekday ("Thu") on the leading zone. */
  weekday?: boolean;
  /** Print the short date ("Sep 7") on the leading zone. */
  date?: boolean;
  /** Print the time. Off for a date-only moment (a release date with no hour). */
  time?: boolean;
}

export interface MomentInZone {
  /** "PT", "AEDT", "Sydney" — what this clock is called at this instant. */
  label: string;
  /** "7:00 PM", or '' when `time` is off. */
  time: string;
  /** Short weekday IN this zone. */
  day: string;
  /** "Sep 7" in this zone. */
  date: string;
  /**
   * True when this zone's calendar day differs from the LEADING zone's — the
   * viewer's own. That is the only reason a trailing clock repeats a weekday:
   * a Thursday 7pm PT draft is already Friday in Sydney, and a line that said
   * "12:00 PM AEDT · 7:00 PM PT" would read as a seven-hour gap on one day.
   */
  dayDiffers: boolean;
}

const partsIn = (spec: ClockZoneSpec, at: Date, withTime: boolean) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: spec.zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric' as const, minute: '2-digit' as const } : {}),
  }).formatToParts(at);

/**
 * One moment rendered in each of a viewer's clocks, leading zone first.
 *
 * Times are always `en-US` (uppercase AM/PM, the site's style everywhere);
 * only an `auto` zone's LABEL takes its own locale — see `resolveZoneLabel`.
 */
export function formatMomentZones(
  at: Date,
  zones: readonly ClockZoneSpec[],
  opts: ClockFormatOptions = {},
): MomentInZone[] {
  const withTime = opts.time !== false;
  let leadDay: string | null = null;
  return zones.map((spec) => {
    const parts = partsIn(spec, at, withTime);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const day = part('weekday');
    if (leadDay === null) leadDay = day;
    // Assembled from parts, never joined from a formatted string: ICU 72+ puts
    // a NARROW no-break space (U+202F) before the day period, which survives
    // into the DOM and breaks a naive equality test on the output.
    const time = withTime ? `${part('hour')}:${part('minute')} ${part('dayPeriod')}`.trim() : '';
    return {
      label: resolveZoneLabel(spec, at),
      time,
      day,
      date: `${part('month')} ${part('day')}`,
      dayDiffers: day !== leadDay,
    };
  });
}

/**
 * The one-line form: "Thu 7:00 PM PT" on the league's own clock,
 * "Fri 12:00 PM AEDT · Thu 7:00 PM PT" from Sydney.
 *
 * The leading zone carries whatever context was asked for (weekday, date);
 * the trailing ones carry a weekday ONLY when they land on a different day,
 * because otherwise it is the same word twice on one line.
 */
export function formatMomentLine(
  at: Date,
  zones: readonly ClockZoneSpec[],
  opts: ClockFormatOptions = {},
): string {
  const rendered = formatMomentZones(at, zones, opts);
  return rendered
    .map((z, i) => {
      const lead = i === 0;
      const bits: string[] = [];
      if (lead ? opts.weekday : z.dayDiffers) bits.push(z.day);
      if (lead && opts.date) bits.push(z.date);
      if (z.time) bits.push(z.time);
      bits.push(z.label);
      return bits.join(' ');
    })
    .join(' · ');
}

/**
 * The same line, straight from a viewer's clock — what a page actually calls.
 *
 * `eventZonesFor` decides the zones: the league's PT alone until the viewer
 * has actually chosen, then their own clock in front of it (and PT dropped for
 * a viewer already living on Pacific). That floor is the whole reason this
 * takes a `ViewerClock` rather than bare preferences — the US/ET fallback is a
 * guess, and a guess must not put an Eastern clock on every waiver deadline in
 * the league.
 */
export function formatForViewer(
  at: Date,
  clock: ViewerClock = DEFAULT_VIEWER_CLOCK,
  opts: ClockFormatOptions = {},
): string {
  return formatMomentLine(at, eventZonesFor(clock), opts);
}

/**
 * A DATE with no time of day — a release date, an issue date — in the
 * viewer's own clock alone.
 *
 * The league's PT is deliberately NOT appended here: two clocks exist to
 * disambiguate an HOUR, and appending a second copy of the same calendar day
 * says nothing. The viewer's zone still decides WHICH day, which is the whole
 * point for a moment near midnight.
 */
export function formatDateForViewer(
  at: Date,
  clock: ViewerClock = DEFAULT_VIEWER_CLOCK,
  opts: { weekday?: boolean } = {},
): string {
  const [own] = eventZonesFor(clock);
  const [rendered] = formatMomentZones(at, [own], { time: false });
  return opts.weekday === false ? rendered.date : `${rendered.day} ${rendered.date}`;
}

// ── The device fallback ──────────────────────────────────────────────────
//
// Some surfaces printed the DEVICE's own clock before preferences existed —
// the owners-poll deadline, the mock-draft lobby — because a deadline you are
// about to act on is most useful in the clock on the wall in front of you.
// That is a different floor from `eventZonesFor`'s PT, and the rule is the
// same in both cases: adopting the preference must not change what a viewer
// who has chosen nothing already sees. So these return `null` for "carry on
// using the device", and a real zone list only once the viewer has chosen.

/**
 * The viewer's chosen clocks as THIS DEVICE knows them, or null when they
 * have not chosen here.
 *
 * For client islands, which cannot reach the Redis mirror. The cookies are
 * written ONLY by an explicit choice, so their presence IS the `explicit`
 * signal — a viewer who has chosen on another device and not this one falls
 * back to the device clock, which is what they saw before either way.
 *
 * Reads the cookie ON EVERY CALL, never at module load: under the ClientRouter
 * one module instance survives a navigation, so a captured value would outlive
 * the page that read it (and, across a league boundary, the league too).
 */
export function clockZonesFromCookie(cookieString: string): ClockZoneSpec[] | null {
  const jar = new Map<string, string>();
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    jar.set(part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim()));
  }
  const country = jar.get(COUNTRY_COOKIE);
  const zone = jar.get(ZONE_COOKIE);
  if (!country && !zone) return null;
  return eventZonesFor({ prefs: parseViewerPreferences(country, zone), explicit: true });
}

/**
 * A moment in the viewer's chosen clocks, or in the device's own when they
 * have not chosen. `zones` is whatever `clockZonesFromCookie` returned.
 */
export function formatMomentOrDevice(
  at: Date,
  zones: readonly ClockZoneSpec[] | null,
  opts: ClockFormatOptions & { deviceFormat?: Intl.DateTimeFormatOptions } = {},
): string {
  if (zones && zones.length > 0) return formatMomentLine(at, zones, opts);
  // `undefined` locale AND no timeZone: the device decides both, which is what
  // these surfaces did before a preference existed.
  return at.toLocaleString(undefined, opts.deviceFormat ?? {
    ...(opts.weekday ? { weekday: 'long' as const } : {}),
    ...(opts.date ? { month: 'short' as const, day: 'numeric' as const } : {}),
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * The viewer's OWN zone as an inline script can use it: an IANA id plus the
 * label to print after the time.
 *
 * For the one case that cannot import this module — an Astro `<script>` with
 * `define:vars` is inline by definition — so the route resolves the zone and
 * hands down two strings. The label is resolved at `at` because an `auto`
 * zone's name depends on the date (AEST vs AEDT).
 *
 * Returns the viewer's clock only, not the league's PT beside it: this exists
 * for compact surfaces (a lobby card) where two clocks do not fit.
 */
export function viewerClockZone(clock: ViewerClock, at: Date = new Date()): { zone: string; label: string } {
  const [own] = eventZonesFor(clock);
  return { zone: own.zone, label: resolveZoneLabel(own, at) };
}
