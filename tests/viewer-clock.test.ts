/**
 * The viewer's clock on LEAGUE surfaces — the draft hub, waiver windows, the
 * owners-poll deadline, the mock-draft lobby.
 *
 * Sunday Ticket already had `kickoffZonesFor`; these are the second reader,
 * and each of the rules below is the reason a second one was needed rather
 * than reusing the first:
 *
 * - The FLOOR is different. Sunday Ticket has always printed the country's
 *   default pair (ET · PT in the US), which is why DEFAULT_VIEWER_PREFERENCES
 *   is US/ET. These surfaces have always printed the league's PT alone.
 *   Handing them the same default would add an Eastern clock to every waiver
 *   deadline in the league on the strength of a fallback nobody chose — so
 *   `eventZonesFor` starts from PT and adds the viewer's clock only once they
 *   have actually named one.
 * - The ANCHOR is different. `formatKickoffZones` anchors the weekday on
 *   EASTERN because a game's identity is its Eastern kickoff. A league event
 *   has no Eastern identity, so the anchor is the viewer's own clock — which
 *   is the only way a Sydney owner sees that Wednesday's 8pm PT deadline is
 *   their Thursday.
 * - The COOKIE NAMES have one spelling. A client island reads them back and
 *   the route writes them; two spellings is a bug that surfaces only as "my
 *   preference did not stick".
 */
import { describe, it, expect } from 'vitest';
import {
  COUNTRY_COOKIE,
  DEFAULT_VIEWER_CLOCK,
  LEAGUE_CLOCK,
  ZONE_COOKIE,
  eventZonesFor,
  kickoffZonesFor,
  parseViewerPreferences,
  type ViewerClock,
} from '../src/utils/viewer-preferences';
import {
  clockZonesFromCookie,
  formatForViewer,
  formatMomentOrDevice,
  formatMomentZones,
  resolveZoneLabel,
  viewerClockZone,
} from '../src/utils/viewer-clock';
import { describeWaiverWindow, resolveWaiverWindow, type MflCalendarEvent } from '../src/utils/waiver-window';

/** A viewer who has actually chosen. */
const chose = (country: string, zoneId: string): ViewerClock => ({
  prefs: parseViewerPreferences(country, zoneId),
  explicit: true,
});

// Wednesday 8:00 PM PDT — the shape of a waiver deadline, and late enough in
// the day that the far-east zones land on the NEXT day.
const WED_8PM_PT = new Date('2026-09-17T03:00:00Z');

describe('the floor: nothing changes until the viewer chooses', () => {
  it('prints the league clock alone for a viewer who has chosen nothing', () => {
    expect(eventZonesFor(DEFAULT_VIEWER_CLOCK)).toEqual([{ zone: LEAGUE_CLOCK.zone, label: 'PT' }]);
    expect(formatForViewer(WED_8PM_PT, DEFAULT_VIEWER_CLOCK, { weekday: true })).toBe('Wed 8:00 PM PT');
  });

  it('does NOT inherit Sunday Ticket\'s ET floor, even though the stored default is US/ET', () => {
    // The two readers disagree ON PURPOSE. Sunday Ticket's default pair keeps
    // that board byte-identical to its pre-preferences self; PT alone keeps
    // these surfaces identical to THEIRS. One default cannot do both.
    expect(kickoffZonesFor(DEFAULT_VIEWER_CLOCK.prefs).map((z) => z.label)).toEqual(['ET', 'PT']);
    expect(eventZonesFor(DEFAULT_VIEWER_CLOCK).map((z) => z.label)).toEqual(['PT']);
  });

  it('adds the chosen clock in front of the league\'s once they have picked', () => {
    expect(formatForViewer(WED_8PM_PT, chose('US', 'ET'), { weekday: true })).toBe('Wed 11:00 PM ET · 8:00 PM PT');
  });

  it('never prints the league clock twice to someone already on it', () => {
    expect(formatForViewer(WED_8PM_PT, chose('US', 'PT'), { weekday: true })).toBe('Wed 8:00 PM PT');
    // Vancouver keeps Los Angeles' wall clock year-round — an identity, not
    // today's offset.
    expect(formatForViewer(WED_8PM_PT, chose('CA', 'PT'), { weekday: true })).toBe('Wed 8:00 PM PT');
  });
});

describe('the anchor: the viewer\'s day leads, and a disagreeing day is shown', () => {
  it('shows BOTH weekdays when the league clock is on the previous day', () => {
    // The whole point: 8pm Wednesday in Pacific is Thursday lunchtime in
    // Sydney, and a line reading "1:00 PM AEST · 8:00 PM PT" would look like a
    // seven-hour gap on one day.
    expect(formatForViewer(WED_8PM_PT, chose('AU', 'SYD'), { weekday: true }))
      .toBe('Thu 1:00 PM AEST · Wed 8:00 PM PT');
    expect(formatForViewer(WED_8PM_PT, chose('GB', 'LON'), { weekday: true }))
      .toBe('Thu 4:00 AM BST · Wed 8:00 PM PT');
  });

  it('leaves the trailing clock bare when both land on the same day', () => {
    const line = formatForViewer(WED_8PM_PT, chose('US', 'CT'), { weekday: true });
    expect(line).toBe('Wed 10:00 PM CT · 8:00 PM PT');
    expect(line.match(/Wed/g)).toHaveLength(1);
  });

  it('anchors on the VIEWER, not on Eastern the way the kickoff renderer does', () => {
    // A Perth viewer is a day ahead of BOTH Pacific and Eastern here. If this
    // anchored on ET the way formatKickoffZones does, the viewer's own clock
    // would be the one flagged as "different" rather than the reference.
    const [lead, trailing] = formatMomentZones(WED_8PM_PT, eventZonesFor(chose('AU', 'PER')));
    expect(lead.dayDiffers).toBe(false);
    expect(trailing.dayDiffers).toBe(true);
  });
});

describe('zone labels are resolved at the instant, never stored', () => {
  it('spells an auto zone with its own locale, and follows the DST flip', () => {
    const sydney = { zone: 'Australia/Sydney', label: 'auto', locale: 'en-AU' };
    // Southern-hemisphere summer time starts in October — mid-season for the
    // NFL, so a fixed label would be wrong for the back half of every year.
    expect(resolveZoneLabel(sydney, new Date('2026-09-17T03:00:00Z'))).toBe('AEST');
    expect(resolveZoneLabel(sydney, new Date('2026-11-17T03:00:00Z'))).toBe('AEDT');
  });

  it('leaves a fixed label alone', () => {
    expect(resolveZoneLabel({ zone: 'America/New_York', label: 'ET' }, WED_8PM_PT)).toBe('ET');
  });
});

describe('the client-side reader — cookie is the explicit signal', () => {
  it('returns null when the device carries no choice, so the caller keeps the device clock', () => {
    expect(clockZonesFromCookie('')).toBeNull();
    expect(clockZonesFromCookie('theme=dark; other=1')).toBeNull();
  });

  it('reads a choice back exactly as the route wrote it', () => {
    const zones = clockZonesFromCookie(`${COUNTRY_COOKIE}=AU; ${ZONE_COOKIE}=PER`);
    expect(zones?.map((z) => z.zone)).toEqual(['Australia/Perth', LEAGUE_CLOCK.zone]);
  });

  it('honours the presence of ONE cookie — a half-written pair still means "chosen"', () => {
    expect(clockZonesFromCookie(`${COUNTRY_COOKIE}=GB`)).not.toBeNull();
    expect(clockZonesFromCookie(`${ZONE_COOKIE}=CT`)).not.toBeNull();
  });

  it('cannot be poisoned into rendering a clockless surface', () => {
    const zones = clockZonesFromCookie(`${COUNTRY_COOKIE}=ZZ; ${ZONE_COOKIE}=NOPE`);
    expect(zones?.length).toBeGreaterThan(0);
  });

  it('survives a malformed percent-escape in an UNRELATED cookie', () => {
    // This runs inside a React effect and a footnote renderer. Decoding every
    // cookie in the jar let one bad value anywhere on the origin throw URIError
    // and blank a deadline; only our two are read now, and even those decode
    // defensively. (Copilot, PR #989.)
    expect(() => clockZonesFromCookie('analytics=%zz; other=100%')).not.toThrow();
    expect(clockZonesFromCookie('analytics=%zz; other=100%')).toBeNull();
    expect(() => clockZonesFromCookie(`analytics=%zz; ${COUNTRY_COOKIE}=AU; ${ZONE_COOKIE}=SYD`)).not.toThrow();
    expect(
      clockZonesFromCookie(`analytics=%zz; ${COUNTRY_COOKIE}=AU; ${ZONE_COOKIE}=SYD`)?.map((z) => z.zone),
    ).toEqual(['Australia/Sydney', LEAGUE_CLOCK.zone]);
  });

  it('does not throw when OUR OWN cookie is the malformed one', () => {
    expect(() => clockZonesFromCookie(`${COUNTRY_COOKIE}=%zz; ${ZONE_COOKIE}=%zz`)).not.toThrow();
    expect(clockZonesFromCookie(`${COUNTRY_COOKIE}=%zz`)?.length).toBeGreaterThan(0);
  });

  it('falls back to the device when there is no choice, and to the preference when there is', () => {
    const chosen = clockZonesFromCookie(`${COUNTRY_COOKIE}=AU; ${ZONE_COOKIE}=SYD`);
    expect(formatMomentOrDevice(WED_8PM_PT, chosen, { weekday: true }))
      .toBe('Thu 1:00 PM AEST · Wed 8:00 PM PT');
    // The suite pins the process to Pacific (tests/global-setup-timezone.ts),
    // so the DEVICE path here renders Pacific — the point is that it does not
    // go through the preference at all.
    expect(formatMomentOrDevice(WED_8PM_PT, null, { weekday: true })).toMatch(/Wednesday/);
  });
});

describe('viewerClockZone — the one case that cannot import the formatter', () => {
  it('hands an inline `define:vars` script a zone id and a label, viewer-only', () => {
    // No league clock beside it: this exists for compact surfaces (the
    // mock-draft lobby card) where two clocks do not fit.
    expect(viewerClockZone(chose('AU', 'SYD'), WED_8PM_PT)).toEqual({
      zone: 'Australia/Sydney',
      label: 'AEST',
    });
    expect(viewerClockZone(DEFAULT_VIEWER_CLOCK, WED_8PM_PT)).toEqual({
      zone: LEAGUE_CLOCK.zone,
      label: 'PT',
    });
  });
});

describe('the waiver window, which is what all of this was for', () => {
  const events: MflCalendarEvent[] = [
    { type: 'WAIVER_LOCK', start_time: String(Math.floor(new Date('2026-09-13T17:00:00Z').getTime() / 1000)) },
    { type: 'WAIVER_BBID', start_time: String(Math.floor(new Date('2026-09-17T03:00:00Z').getTime() / 1000)) },
  ];
  const open = resolveWaiverWindow(events, new Date('2026-09-15T12:00:00Z'));

  it('is unchanged for an owner who has never opened the picker', () => {
    expect(describeWaiverWindow(open)).toBe('Waivers open · claims process Wed 8:00 PM PT');
  });

  it('tells a Sydney owner which of THEIR days their claims process on', () => {
    expect(describeWaiverWindow(open, chose('AU', 'SYD')))
      .toBe('Waivers open · claims process Thu 1:00 PM AEST · Wed 8:00 PM PT');
  });
});
