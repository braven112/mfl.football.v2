/**
 * Viewer preferences — country + clocks.
 *
 * Each of these is a rule from `docs/claude/rules/` or a bug the feature was
 * built to avoid, not a restatement of the implementation:
 *
 * - The defaults must equal what the Sunday Ticket board printed BEFORE
 *   preferences existed, or every owner who never opens the picker silently
 *   gets a different board.
 * - The league's PT is appended, never chosen — and never printed twice to
 *   someone who already lives on it.
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
  LEAGUE_CLOCK,
  SEEDED_PREFERENCES,
  ZONE_OPTIONS,
  isDefaultViewerPreferences,
  isLeagueClock,
  kickoffZonesFor,
  nextSundayKickoffEpoch,
  parseViewerPreferences,
  parseZoneSelection,
  seededPreferencesFor,
  zoneOptionsFor,
  zoneSummary,
} from '../src/utils/viewer-preferences';
import { countryTimeZones } from '../src/utils/broadcast-channels';
import {
  COUNTRY_COOKIE,
  LEGACY_COUNTRY_COOKIE,
  ZONE_COOKIE,
  hasPreferenceParams,
  preferencesFromCookies,
  preferencesFromParams,
  zoneParamFor,
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

describe('the league clock rides along, and is never chosen', () => {
  it("appends the league's PT to the viewer's own clock", () => {
    const zones = kickoffZonesFor({ country: 'US', zoneId: 'CT' });
    expect(zones.map((z) => z.label)).toEqual(['CT', 'PT']);
    expect(zones[1].zone).toBe(LEAGUE_CLOCK.zone);
  });

  it('leaves it off for someone already on Pacific — no "1:00 PM PT · 1:00 PM PT"', () => {
    expect(kickoffZonesFor({ country: 'US', zoneId: 'PT' })).toHaveLength(1);
    // Canada's Pacific is the same wall clock as Los Angeles, DST included.
    expect(kickoffZonesFor({ country: 'CA', zoneId: 'PT' })).toHaveLength(1);
  });

  it('still rides along abroad, where the league clock is the shared reference', () => {
    const zones = kickoffZonesFor({ country: 'AU', zoneId: 'PER' });
    expect(zones).toHaveLength(2);
    expect(zones[1].label).toBe('PT');
  });

  it('recognizes every zone that IS the league clock', () => {
    expect(isLeagueClock({ zone: 'America/Los_Angeles' })).toBe(true);
    expect(isLeagueClock({ zone: 'America/Vancouver' })).toBe(true);
    expect(isLeagueClock({ zone: 'America/Denver' })).toBe(false);
  });
});

describe('defaults match the board before preferences existed', () => {
  for (const code of COUNTRY_CODES) {
    it(`${code}'s default id exists in its catalog`, () => {
      expect(zoneOptionsFor(code).map((z) => z.id)).toContain(DEFAULT_ZONE_IDS[code]);
    });
  }

  for (const code of ['US', 'CA'] as const) {
    it(`${code} still opens on the mapping file's own pair`, () => {
      // North America opened on ET · PT before preferences existed, and the
      // default clock + the league clock must still print exactly that.
      const before = countryTimeZones(code);
      const now = kickoffZonesFor({ country: code, zoneId: DEFAULT_ZONE_IDS[code] });
      expect(now.map((z) => z.label)).toEqual(before.map((z) => z.label));
    });
  }

  it('the untouched preference is US / ET, printed as ET · PT', () => {
    expect(DEFAULT_VIEWER_PREFERENCES).toEqual({ country: 'US', zoneId: 'ET' });
    expect(isDefaultViewerPreferences(DEFAULT_VIEWER_PREFERENCES)).toBe(true);
    expect(isDefaultViewerPreferences({ country: 'AU', zoneId: 'SYD' })).toBe(false);
    expect(zoneSummary(DEFAULT_VIEWER_PREFERENCES)).toBe('ET · PT');
  });
});

describe('seeded per-owner defaults', () => {
  it('every seed names a real country and a zone that country has', () => {
    for (const [key, seed] of Object.entries(SEEDED_PREFERENCES)) {
      const [slug, franchiseId] = key.split(':');
      expect(slug, `seed key "${key}" needs <slug>:<franchiseId>`).toBeTruthy();
      expect(franchiseId, `seed key "${key}" needs <slug>:<franchiseId>`).toMatch(/^\d{4}$/);
      expect(zoneOptionsFor(seed.country).map((z) => z.id), `seed ${key}`).toContain(seed.zoneId);
    }
  });

  it('seeds the three owners we know are off the league clock', () => {
    expect(seededPreferencesFor('theleague', '0009')).toEqual({ country: 'CA', zoneId: 'PT' });
    expect(seededPreferencesFor('theleague', '0016')).toEqual({ country: 'CA', zoneId: 'ET' });
    expect(seededPreferencesFor('theleague', '0003')).toEqual({ country: 'AU', zoneId: 'SYD' });
  });

  it('the Wabbits, already on Pacific, get one clock and Canadian channels', () => {
    const seed = seededPreferencesFor('theleague', '0009')!;
    expect(kickoffZonesFor(seed)).toHaveLength(1);
    expect(zoneSummary(seed)).toBe('PT');
  });

  it('needs BOTH a league and a franchise — a bare id is ambiguous across leagues', () => {
    expect(seededPreferencesFor(null, '0009')).toBeNull();
    expect(seededPreferencesFor('theleague', null)).toBeNull();
    // The AFL's 0009 is a different team entirely.
    expect(seededPreferencesFor('afl-fantasy', '0009')).toBeNull();
  });
});

describe('parseZoneSelection — always yields exactly one usable clock', () => {
  it('takes the id a country has, whatever order it arrives in', () => {
    expect(parseZoneSelection('PT', 'US')).toBe('PT');
    expect(parseZoneSelection(['ct'], 'US')).toBe('CT');
    // Catalog order decides, never input order, so a stored two-id value from
    // an earlier shape resolves the same way every time.
    expect(parseZoneSelection('PT,ET', 'US')).toBe('ET');
  });

  it('drops an id the country does not have and re-defaults', () => {
    // The exact case a country switch produces: the US pick is still in the
    // form when Australia is chosen.
    expect(parseZoneSelection('ET', 'AU')).toBe(DEFAULT_ZONE_IDS.AU);
    expect(parseZoneSelection('ET,SYD', 'AU')).toBe('SYD');
  });

  it('never returns an empty clock', () => {
    for (const raw of ['', null, undefined, '   ', 'nonsense', [] as string[]]) {
      expect(parseZoneSelection(raw, 'US')).toBeTruthy();
    }
  });
});

describe('parseViewerPreferences — a garbage store can never blank the board', () => {
  it('falls back to the default country', () => {
    expect(parseViewerPreferences('ZZ', 'ET')).toEqual({ country: 'US', zoneId: 'ET' });
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
    expect(preferencesFromCookies(jar({ [COUNTRY_COOKIE]: 'AU', [ZONE_COOKIE]: 'PER' })))
      .toEqual({ country: 'AU', zoneId: 'PER' });
  });

  it("keeps an owner's pre-preferences country from the Sunday Ticket cookie", () => {
    expect(preferencesFromCookies(jar({ [LEGACY_COUNTRY_COOKIE]: 'CA' })))
      .toEqual({ country: 'CA', zoneId: DEFAULT_ZONE_IDS.CA });
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
  const current = { country: 'US' as const, zoneId: 'CT' };

  it('only counts as a choice when a param is actually present', () => {
    expect(hasPreferenceParams(url('?week=3'))).toBe(false);
    expect(hasPreferenceParams(url('?country=CA'))).toBe(true);
    expect(hasPreferenceParams(url('?zone=ET'))).toBe(true);
    expect(hasPreferenceParams(url(`?${zoneParamFor('US')}=ET`))).toBe(true);
  });

  it('keeps the stored clock when only the country changed and it still fits', () => {
    // CA has CT too, so a US → CA switch keeps the owner's own clock.
    expect(preferencesFromParams(url('?country=CA'), current)).toEqual({ country: 'CA', zoneId: 'CT' });
  });

  it("re-defaults the clock when the new country doesn't have it", () => {
    expect(preferencesFromParams(url('?country=AU'), current)).toEqual({ country: 'AU', zoneId: DEFAULT_ZONE_IDS.AU });
  });

  it('reads the chosen country\'s radio group, which is how the picker submits', () => {
    // The picker gives every country's radios their own name and submits all
    // three; only the chosen country's group counts. Without that, the two
    // groups the viewer cannot see would decide their clock.
    const submitted = `?country=AU&${zoneParamFor('US')}=CT&${zoneParamFor('CA')}=ET&${zoneParamFor('AU')}=PER`;
    expect(preferencesFromParams(url(submitted), current)).toEqual({ country: 'AU', zoneId: 'PER' });
  });

  it('accepts a bare ?zone= for a plain link', () => {
    expect(preferencesFromParams(url('?country=US&zone=MT'), current)).toEqual({ country: 'US', zoneId: 'MT' });
  });
});

describe('zoneSummary — the label on the board and the picker', () => {
  it('names the viewer\'s clock and the league\'s', () => {
    expect(zoneSummary({ country: 'US', zoneId: 'CT' })).toBe('CT · PT');
  });

  it('uses a city where the real label is only knowable at format time', () => {
    // AEST vs AEDT depends on the date, so a static summary must not claim one.
    expect(zoneSummary({ country: 'AU', zoneId: 'SYD' })).toBe('Sydney · PT');
  });

  it('says PT once for someone already on it', () => {
    expect(zoneSummary({ country: 'US', zoneId: 'PT' })).toBe('PT');
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
