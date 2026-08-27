/**
 * Import-smoke for the My Draft List UI.
 *
 * The board's React island has no other test coverage, so a syntax error or a
 * bad import path in it would otherwise reach the build. Importing the modules
 * is the assertion.
 */
import { describe, it, expect } from 'vitest';

describe('My Draft List UI modules', () => {
  it('DraftListSync loads', async () => {
    const mod = await import('../src/components/theleague/custom-rankings/DraftListSync');
    expect(typeof mod.default).toBe('function');
  });

  it('the board island loads', async () => {
    const mod = await import('../src/components/theleague/custom-rankings/CustomRankingsPage');
    expect(typeof mod.default).toBe('function');
  });
});
