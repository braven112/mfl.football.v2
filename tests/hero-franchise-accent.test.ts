/**
 * Franchise-accent guard.
 *
 * When a composite hero is tinted by the FANTASY franchise rather than the
 * cast player's NFL team, exactly one question decides the color: which
 * franchise? In the AFL that question has no single answer —
 * `duplicatePlayers: true` means the same NFL player is routinely rostered in
 * BOTH conferences, so `getOwnersByPlayer` returns a LIST. Picking `owners[0]`
 * paints whichever conference the rosters feed happened to serialize first,
 * which is a stranger's colors on your own homepage.
 *
 * The rule: scope to the viewer's conference, and if that still leaves
 * anything but exactly one franchise, fall back to the NFL team color — the
 * behavior every composite had before the accent existed. These tests pin each
 * escape hatch, because every one of them is a case where guessing looks fine
 * in dev (one league year, one roster feed) and is wrong in production.
 */
import { describe, it, expect } from 'vitest';
import { resolveHeroFranchiseAccent, MIN_GLOW_CONTRAST } from '../src/utils/hero-franchise-accent';
import { getLeagueTeamBrands } from '../src/utils/league-team-brands';
import { contrastRatio } from '../src/utils/team-color-contrast';
import aflConfig from '../data/afl-fantasy/afl.config.json';

const NFL = '#fb4f14';

/** Real AFL franchise ids, one per conference, read from the config. */
const teams = (aflConfig as any).teams as Array<{ franchiseId: string; conference: string; colorPrimary?: string }>;
const AL = teams.find((t) => t.conference === '00' && t.colorPrimary)!;
const NL = teams.find((t) => t.conference === '01' && t.colorPrimary)!;

const conferenceOf = (id: string) =>
  (teams.find((t) => t.franchiseId === id)?.conference as '00' | '01') ?? null;

const resolve = (owners: string[], viewer: '00' | '01' | null) =>
  resolveHeroFranchiseAccent({
    playerId: 'p1',
    ownersByPlayer: new Map([['p1', owners]]),
    viewerConferenceId: viewer,
    conferenceOf,
    league: 'afl-fantasy',
    fallback: NFL,
  });

describe('hero franchise accent', () => {
  it('uses the viewer-conference owner when exactly one claims the player', () => {
    const a = resolve([AL.franchiseId], '00');
    expect(a.franchiseId).toBe(AL.franchiseId);
    expect(a.color).not.toBe(NFL);
  });

  it('picks the viewer\'s side when BOTH conferences roster the same player', () => {
    // The AFL's defining case: 60 of the AL's 84 keepers are kept in the NL too.
    const asAl = resolve([AL.franchiseId, NL.franchiseId], '00');
    const asNl = resolve([AL.franchiseId, NL.franchiseId], '01');
    expect(asAl.franchiseId).toBe(AL.franchiseId);
    expect(asNl.franchiseId).toBe(NL.franchiseId);
    expect(asAl.color).not.toBe(asNl.color);
  });

  it('never crosses conferences — an NL-only owner is not an AL viewer\'s story', () => {
    expect(resolve([NL.franchiseId], '00').franchiseId).toBeNull();
    expect(resolve([NL.franchiseId], '00').color).toBe(NFL);
  });

  it('falls back for a guest, who has no conference to scope by', () => {
    expect(resolve([AL.franchiseId], null).franchiseId).toBeNull();
    expect(resolve([AL.franchiseId], null).color).toBe(NFL);
  });

  it('falls back for a free agent nobody rosters', () => {
    expect(resolve([], '00').color).toBe(NFL);
    expect(
      resolveHeroFranchiseAccent({
        playerId: 'unknown', ownersByPlayer: new Map(), viewerConferenceId: '00',
        conferenceOf, league: 'afl-fantasy', fallback: NFL,
      }).color,
    ).toBe(NFL);
  });

  it('falls back rather than guessing when one conference somehow lists two owners', () => {
    const twoAl = teams.filter((t) => t.conference === '00' && t.colorPrimary).slice(0, 2);
    expect(twoAl).toHaveLength(2);
    expect(resolve(twoAl.map((t) => t.franchiseId), '00').franchiseId).toBeNull();
  });

  it('is total — a missing player id or owner map never throws', () => {
    for (const bad of [undefined, null] as const) {
      expect(
        resolveHeroFranchiseAccent({
          playerId: bad ?? undefined, ownersByPlayer: bad, viewerConferenceId: '00',
          conferenceOf, league: 'afl-fantasy', fallback: NFL,
        }).color,
      ).toBe(NFL);
    }
  });

  it('floors a near-white franchise color so the glow still reads as a tint', () => {
    // One AFL franchise ships #e9e9e9. Unfloored it renders an invisible smear
    // in light mode and a white haze under the caption in dark.
    const pale = teams.filter((t) => t.colorPrimary && contrastRatio(t.colorPrimary, '#ffffff') < MIN_GLOW_CONTRAST);
    expect(pale.length, 'fixture assumes at least one pale franchise').toBeGreaterThan(0);
    for (const t of pale) {
      const out = resolve([t.franchiseId], conferenceOf(t.franchiseId)!);
      expect(out.franchiseId).toBe(t.franchiseId);
      expect(contrastRatio(out.color, '#ffffff')).toBeGreaterThanOrEqual(MIN_GLOW_CONTRAST - 0.01);
    }
  });

  it('leaves an ordinary brand color untouched', () => {
    const brands = getLeagueTeamBrands('afl-fantasy');
    const strong = teams.find(
      (t) => t.colorPrimary && contrastRatio(t.colorPrimary, '#ffffff') >= MIN_GLOW_CONTRAST,
    )!;
    const out = resolve([strong.franchiseId], conferenceOf(strong.franchiseId)!);
    expect(out.color.toLowerCase()).toBe(brands[strong.franchiseId].colorPrimary.toLowerCase());
  });
});
