/**
 * Viewer preferences — country + clocks.
 *
 * Each of these is a rule from `docs/claude/rules/` or a bug the feature was
 * built to avoid, not a restatement of the implementation:
 *
 * - The defaults must equal what the Sunday Ticket board printed BEFORE
 *   preferences existed, or every owner who never opens the picker silently
 *   gets a different board.
 * - Zone ids are parsed AGAINST a country, so switching country cannot leave
 *   a clock from the old one behind (or, worse, leave the board with none).
 * - The preferences page renders every country's clocks and hides all but one
 *   with a CSS `:has()` rule per country — a country added to the registry
 *   without its rule would render an unswitchable picker.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COUNTRY_CODES,
  DEFAULT_VIEWER_PREFERENCES,
  DEFAULT_ZONE_IDS,
  MAX_ZONES,
  ZONE_OPTIONS,
  isDefaultViewerPreferences,
  kickoffZonesFor,
  nextSundayKickoffEpoch,
  parseViewerPreferences,
  parseZoneSelection,
  zoneOptionsFor,
  zoneSummary,
} from '../src/utils/viewer-preferences';
import { countryTimeZones } from '../src/utils/broadcast-channels';
import {
  COUNTRY_COOKIE,
  LEGACY_COUNTRY_COOKIE,
  ZONES_COOKIE,
  hasPreferenceParams,
  preferencesFromCookies,
  preferencesFromParams,
} from '../src/utils/viewer-preferences-page';

const REPO = resolve(__dirname, '..');

describe('the catalog covers every country, with no duplicate ids', () => {
  for (const code of COUNTRY_CODES) {
    it(`${code} has options and unique ids`, () => {
      const options = ZONE_OPTIONS[code];
      expect(options.length).toBeGreaterThan(0);
      expect(new Set(options.map((z) => z.id)).size).toBe(options.length);
      for (const z of options) {
        expect(z.zone, `${code}/${z.id} needs an IANA zone`).toMatch(/^[A-Za-z_]+\/[A-Za-z_+-]+$/);
        // `auto` labels need a locale or Intl says "GMT+10" instead of AEST.
        if (z.label === 'auto') expect(z.locale, `${code}/${z.id}`).toBeTruthy();
      }
    });
  }
});

describe('defaults match the board before preferences existed', () => {
  for (const code of COUNTRY_CODES) {
    it(`${code} defaults to the mapping file's pair`, () => {
      const before = countryTimeZones(code);
      const now = kickoffZonesFor({ country: code, zoneIds: [...DEFAULT_ZONE_IDS[code]] });
      expect(now.map((z) => z.zone)).toEqual(before.map((z) => z.zone));
      expect(now.map((z) => z.label)).toEqual(before.map((z) => z.label));
    });

    it(`${code}'s default ids all exist in its catalog`, () => {
      const ids = zoneOptionsFor(code).map((z) => z.id);
      for (const id of DEFAULT_ZONE_IDS[code]) expect(ids).toContain(id);
      expect(DEFAULT_ZONE_IDS[code].length).toBeLessThanOrEqual(MAX_ZONES);
    });
  }

  it('the untouched preference is US / ET · PT', () => {
    expect(DEFAULT_VIEWER_PREFERENCES).toEqual({ country: 'US', zoneIds: ['ET', 'PT'] });
    expect(isDefaultViewerPreferences(DEFAULT_VIEWER_PREFERENCES)).toBe(true);
    expect(isDefaultViewerPreferences({ country: 'AU', zoneIds: ['SYD', 'PER'] })).toBe(false);
  });
});

describe('parseZoneSelection — always yields a usable clock', () => {
  it('keeps the ids a country has, in catalog order', () => {
    expect(parseZoneSelection('PT,ET', 'US')).toEqual(['ET', 'PT']);
    expect(parseZoneSelection(['ct'], 'US')).toEqual(['CT']);
  });

  it('drops ids the country does not have and re-defaults when none survive', () => {
    // The exact case a country switch produces: the US ticks are still in the
    // form when Australia is chosen.
    expect(parseZoneSelection('ET,PT', 'AU')).toEqual([...DEFAULT_ZONE_IDS.AU]);
    expect(parseZoneSelection('ET,PT,SYD', 'AU')).toEqual(['SYD']);
  });

  it('never returns more than MAX_ZONES, and never zero', () => {
    expect(parseZoneSelection('ET,CT,MT,PT', 'US')).toHaveLength(MAX_ZONES);
    for (const raw of ['', null, undefined, '   ', 'nonsense', [] as string[]]) {
      expect(parseZoneSelection(raw, 'US').length).toBeGreaterThan(0);
    }
  });
});

describe('parseViewerPreferences — a garbage store can never blank the board', () => {
  it('falls back to the default country', () => {
    expect(parseViewerPreferences('ZZ', 'ET')).toEqual({ country: 'US', zoneIds: ['ET'] });
  });

  it('reads a country case-insensitively, as the old cookie stored it', () => {
    expect(parseViewerPreferences('ca', 'PT').country).toBe('CA');
  });

  it('always resolves to at least one printable zone', () => {
    const zones = kickoffZonesFor(parseViewerPreferences(null, null));
    expect(zones.length).toBeGreaterThan(0);
    expect(zones[0].zone).toBeTruthy();
  });
});

describe('cookies — the new pair, with the old country cookie still honored', () => {
  const jar = (values: Record<string, string>) => ({
    get: (name: string) => (name in values ? { value: values[name] } : undefined),
  });

  it('reads the new cookies', () => {
    expect(preferencesFromCookies(jar({ [COUNTRY_COOKIE]: 'AU', [ZONES_COOKIE]: 'PER' })))
      .toEqual({ country: 'AU', zoneIds: ['PER'] });
  });

  it("keeps an owner's pre-preferences country from the Sunday Ticket cookie", () => {
    expect(preferencesFromCookies(jar({ [LEGACY_COUNTRY_COOKIE]: 'CA' })))
      .toEqual({ country: 'CA', zoneIds: [...DEFAULT_ZONE_IDS.CA] });
  });

  it('prefers the new cookie over the legacy one', () => {
    expect(preferencesFromCookies(jar({ [COUNTRY_COOKIE]: 'AU', [LEGACY_COUNTRY_COOKIE]: 'CA' }))?.country).toBe('AU');
  });

  it('returns null when the device has said nothing', () => {
    expect(preferencesFromCookies(jar({}))).toBeNull();
  });
});

describe('URL params — the board chips and the picker form', () => {
  const url = (qs: string) => new URL(`https://x.test/theleague/preferences${qs}`);
  const current = { country: 'US' as const, zoneIds: ['CT', 'PT'] };

  it('only counts as a choice when a param is actually present', () => {
    expect(hasPreferenceParams(url('?week=3'))).toBe(false);
    expect(hasPreferenceParams(url('?country=CA'))).toBe(true);
    expect(hasPreferenceParams(url('?zones=ET'))).toBe(true);
  });

  it('keeps the stored clocks when only the country changed and they still fit', () => {
    // CA has CT and PT too, so a US → CA switch keeps the owner's own clocks.
    expect(preferencesFromParams(url('?country=CA'), current)).toEqual({ country: 'CA', zoneIds: ['CT', 'PT'] });
  });

  it("re-defaults the clocks when the new country doesn't have them", () => {
    expect(preferencesFromParams(url('?country=AU'), current)).toEqual({ country: 'AU', zoneIds: [...DEFAULT_ZONE_IDS.AU] });
  });

  it('takes repeated checkbox values, which is how the picker submits', () => {
    expect(preferencesFromParams(url('?country=US&zones=ET&zones=PT'), current).zoneIds).toEqual(['ET', 'PT']);
  });

  it('ignores ticks left behind in a hidden country group', () => {
    // The picker renders every country's clocks; the unselected ones stay in
    // the form. Filtering by country is what keeps that honest without JS.
    expect(preferencesFromParams(url('?country=AU&zones=ET&zones=PT&zones=SYD&zones=PER'), current))
      .toEqual({ country: 'AU', zoneIds: ['SYD', 'PER'] });
  });
});

describe('zoneSummary — the label on the board and the picker', () => {
  it('uses the fixed label where there is one', () => {
    expect(zoneSummary({ country: 'US', zoneIds: ['ET', 'PT'] })).toBe('ET · PT');
  });

  it('uses a city where the real label is only knowable at format time', () => {
    // AEST vs AEDT depends on the date, so a static summary must not claim one.
    expect(zoneSummary({ country: 'AU', zoneIds: ['SYD', 'PER'] })).toBe('Sydney · Perth');
  });
});

describe('nextSundayKickoffEpoch — the picker preview', () => {
  const et = (epoch: number) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })
      .format(new Date(epoch * 1000));

  it('is always Sunday 1:00 PM ET, on either side of the DST flip', () => {
    expect(et(nextSundayKickoffEpoch(new Date('2026-09-09T02:00:00Z')))).toBe('Sun 1:00 PM');
    expect(et(nextSundayKickoffEpoch(new Date('2026-12-16T05:00:00Z')))).toBe('Sun 1:00 PM');
    // Sunday itself resolves to today, not next week.
    expect(et(nextSundayKickoffEpoch(new Date('2026-09-06T18:00:00Z')))).toBe('Sun 1:00 PM');
  });
});

describe('the picker can switch to every country it offers', () => {
  const page = readFileSync(resolve(REPO, 'src/components/shared/preferences/PreferencesPage.astro'), 'utf8');

  it('has a :has() reveal rule per country', () => {
    for (const code of COUNTRY_CODES) {
      expect(
        page.includes(`#pf-country-${code}:checked) .pf-zones[data-country='${code}']`),
        `PreferencesPage.astro is missing the CSS rule that reveals ${code}'s clocks. ` +
          `Every country in COUNTRY_CODES needs one, or its clocks can never be shown.`,
      ).toBe(true);
    }
  });

  it('hides the groups only where :has() is supported', () => {
    // Without the @supports guard, a browser with no :has() hides EVERY group
    // and the clocks become unpickable.
    const hideAt = page.indexOf('.pf-zones { display: none; }');
    const supportsAt = page.indexOf('@supports selector(:has(*))');
    expect(supportsAt).toBeGreaterThan(-1);
    expect(hideAt).toBeGreaterThan(supportsAt);
  });
});
