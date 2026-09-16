/**
 * src/utils/cdm-ui.ts — the Contract Declaration Modal's presentation
 * primitives, extracted from rosters.astro in Phase 6.1 of
 * docs/plans/rosters-page-split.md. They had no unit coverage at all while
 * they lived inside a 12k-line page's closure; that is most of why the
 * extraction is worth doing.
 *
 * Scope note: only the PURE functions are tested here. This suite runs on
 * `environment: 'node'` with no DOM library installed, and the two DOM
 * builders (`createActionOption`, `createYearButton`) already have strictly
 * better coverage than jsdom would give them — `scripts/cdm-parity-check.mjs`
 * fingerprints what they render in a real browser across all 25 eligible
 * players and every flow, and fails on any diff. Adding a DOM dependency to
 * re-test that in a fake DOM would buy nothing.
 */
import { describe, it, expect } from 'vitest';
import { formatDraftLine, cdmAge } from '../src/utils/cdm-ui';

describe('formatDraftLine', () => {
  it('zero-pads the pick so a single digit cannot read as a round', () => {
    expect(formatDraftLine(2023, 2, 7, 'KC')).toBe('2023 Round 2, Pick 07');
  });

  it("treats both of MFL's undrafted spellings as undrafted", () => {
    // MFL reports an undrafted player as FA or UFA rather than as a missing
    // draft year, so a year-only check reads them as 2023 first-rounders.
    expect(formatDraftLine(2023, 1, 1, 'FA')).toBe('Undrafted');
    expect(formatDraftLine(2023, 1, 1, 'UFA')).toBe('Undrafted');
    expect(formatDraftLine(2023, 1, 1, 'ufa')).toBe('Undrafted');
    expect(formatDraftLine(null, 1, 1, 'KC')).toBe('Undrafted');
  });

  it('falls back to year+pick with no round, and to ?? for an unparseable pick', () => {
    expect(formatDraftLine(2021, null, 33, 'BUF')).toBe('2021 Pick 33');
    expect(formatDraftLine(2021, 2, 'n/a', 'BUF')).toBe('2021 Round 2, Pick ??');
    expect(formatDraftLine(2021, 2, null, 'BUF')).toBe('2021 Round 2, Pick ??');
  });
});

describe('cdmAge', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  it('counts a birthday that has already passed this year', () => {
    expect(cdmAge(unix('1997-01-07T00:00:00Z'), now)).toBe(29);
  });

  it('has not counted a birthday still to come', () => {
    expect(cdmAge(unix('1997-12-30T00:00:00Z'), now)).toBe(28);
  });

  it('returns null rather than "NaN yrs" for an unparseable birthdate', () => {
    // The age pill hides on null. Without this guard the canonical
    // calculateAge returns NaN and the band renders it.
    expect(cdmAge('not-a-date', now)).toBeNull();
    expect(cdmAge(null, now)).toBeNull();
    expect(cdmAge(undefined, now)).toBeNull();
    expect(cdmAge(0, now)).toBeNull();
  });

  it('returns null rather than a negative age for a future birthdate', () => {
    expect(cdmAge(unix('2030-01-01T00:00:00Z'), now)).toBeNull();
  });
});
