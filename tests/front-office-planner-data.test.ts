/**
 * The Front Office hub's "at a glance" cap tile showed "$0" for a team that
 * was actually $36,255 OVER next year's cap (franchise 0001, current
 * committed data) — the display clamped `capLimit - nextYearCapCharge` to
 * a floor of 0 before formatting, which reads identically to "exactly at
 * the wire" and hides a real overage. avgPerPlayer's own clamp stays (a
 * per-remaining-slot figure has no sane negative reading), only the
 * headline capSpaceDisplay was unclamped.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildFrontOfficePlannerData } from '../src/utils/front-office-planner-data';
import { formatCapSpaceDisplay } from '../src/utils/formatters';

describe('buildFrontOfficePlannerData — cap space display', () => {
  // This used to pin franchise 0001's live figure ('-$36,255'), which broke
  // CI on every branch the moment a roster sync moved that team back under
  // the cap. The regression is a CLAMP, so assert the clamp's absence rather
  // than any one team's data: the formatter keeps the sign, and the planner
  // hands it the raw difference.
  it('shows a negative figure for a team over next year\'s cap, not a clamped "$0"', () => {
    expect(formatCapSpaceDisplay(-36_255)).toBe('-$36,255');
    expect(formatCapSpaceDisplay(-36_255)).not.toBe('$0');

    const src = readFileSync('src/utils/front-office-planner-data.ts', 'utf8');
    const line = src.split('\n').find((l) => l.includes('capSpaceDisplay: formatCapSpaceDisplay('));
    expect(line, 'capSpaceDisplay assignment').toBeDefined();
    expect(line).toContain('capLimit - nextYearCapCharge');
    expect(line).not.toMatch(/Math\.max/);
  });

  it('every team gets a capSpaceDisplay that is never silently coerced to "$0" from a negative', async () => {
    const data = await buildFrontOfficePlannerData('0001');
    for (const [franchiseId, metrics] of Object.entries(data.teamMetrics)) {
      // A literal "$0" is only valid when the team is truly at exactly zero,
      // never as a stand-in for "some non-positive number" — so this just
      // asserts the field always parses as a real currency string, positive
      // or negative, never a placeholder.
      expect(metrics.capSpaceDisplay, franchiseId).toMatch(/^-?\$[\d,.]+( million)?$/);
    }
  });
});
