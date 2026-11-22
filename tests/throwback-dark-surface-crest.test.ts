/**
 * Throwback Week must reach the PAINTED surfaces too.
 *
 * The standings board's division-leader row (and every other dark-in-both-
 * themes surface) draws `resolveDarkSurfaceCrest`, which prefers a team's
 * `groupMeDark` / `iconDark` / `groupMe` cut over `icon`. Those cuts belong to
 * TODAY's crest, so when `applyThrowbackOverrides` swapped only `icon`, every
 * leader row kept its current logo while the rest of the table threw back
 * (Nov 2026, both AFL division leaders). Guard: after the swap, a team wearing
 * era art draws that era art on a dark surface, in both leagues.
 */
import { describe, it, expect } from 'vitest';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import theleagueConfig from '../src/data/theleague.config.json';
import { applyThrowbackOverrides, type ConfigTeam } from '../src/utils/live-scoring-data';
import { resolveDarkSurfaceCrest } from '../src/utils/dark-surface-crest';
import { preferredIconSrc } from '../src/utils/team-icon-dark-css';
import type { ThrowbackScope } from '../src/utils/throwback-scope';

const leagues: Array<[ThrowbackScope, ConfigTeam[]]> = [
  ['theleague', theleagueConfig.teams as unknown as ConfigTeam[]],
  ['afl', aflConfig.teams as unknown as ConfigTeam[]],
];

describe.each(leagues)('%s: throwback era art on dark surfaces', (scope, teams) => {
  const thrown = applyThrowbackOverrides(teams, true, {}, scope);
  const swapped = thrown.filter((t, i) => t.icon && t.icon !== teams[i].icon);

  it('has teams wearing era art (the check below is not vacuous)', () => {
    expect(swapped.length).toBeGreaterThan(0);
  });

  it('every era-art team draws its era icon on a dark surface, never today’s cut', () => {
    const wrong = swapped
      .map((t) => ({ id: t.franchiseId, want: preferredIconSrc(t.icon!), got: resolveDarkSurfaceCrest(t, scope).src }))
      .filter((r) => r.got !== r.want);
    expect(wrong).toEqual([]);
  });
});
