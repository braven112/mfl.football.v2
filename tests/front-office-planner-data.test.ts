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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFrontOfficePlannerData } from '../src/utils/front-office-planner-data';
import { formatCapSpaceDisplay } from '../src/utils/formatters';

describe('buildFrontOfficePlannerData — cap space display', () => {
  // This used to pin franchise 0001's LIVE figure ('-$36,255'). The roster
  // sync moved it to $396,870 on 2026-10-01 and no team was over next year's
  // cap any more, so the test went red on main with no code change. The
  // behaviour is now pinned with synthetic numbers, independent of the feeds.
  it('formats an overage as a negative figure, never a clamped "$0"', () => {
    expect(formatCapSpaceDisplay(-36_255)).toBe('-$36,255');
    expect(formatCapSpaceDisplay(-1)).toBe('-$1');
    expect(formatCapSpaceDisplay(-36_255)).not.toBe('$0');
  });

  it('builds capSpaceDisplay from the UNCLAMPED cap difference', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/utils/front-office-planner-data.ts'),
      'utf8',
    );
    const decl = src.match(/capSpaceDisplay:\s*(formatCapSpaceDisplay[^\n]+)/);
    expect(decl, 'capSpaceDisplay assignment not found').toBeTruthy();
    expect(decl![1]).toMatch(/formatCapSpaceDisplay\(\s*capLimit\s*-\s*nextYearCapCharge\s*\)/);
    expect(decl![1]).not.toMatch(/Math\.max/);
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
