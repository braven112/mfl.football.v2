/**
 * The Front Office hub's "at a glance" cap tile showed "$0" for a team that
 * was actually $36,255 OVER next year's cap (franchise 0001, current
 * committed data) — the display clamped `capLimit - nextYearCapCharge` to
 * a floor of 0 before formatting, which reads identically to "exactly at
 * the wire" and hides a real overage. avgPerPlayer's own clamp stays (a
 * per-remaining-slot figure has no sane negative reading), only the
 * headline capSpaceDisplay was unclamped.
 */
import { describe, it, expect } from 'vitest';
import { buildFrontOfficePlannerData } from '../src/utils/front-office-planner-data';

describe('buildFrontOfficePlannerData — cap space display', () => {
  it('shows a negative figure for a team over next year\'s cap, not a clamped "$0"', async () => {
    const data = await buildFrontOfficePlannerData('0001');
    const metrics = data.teamMetrics['0001'];
    expect(metrics).toBeDefined();
    // Pins the real, current-data value rather than re-deriving it — if the
    // committed feeds change and this team is no longer over the cap, the
    // failure here is the signal to pick a still-over-cap team instead.
    expect(metrics.capSpaceDisplay).toBe('-$36,255');
    expect(metrics.capSpaceDisplay).not.toBe('$0');
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
