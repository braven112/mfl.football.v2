/**
 * Guard: the MFL Live board's three-rung identity ladder.
 *
 * The rung that matters most is the FIRST one, and it is the one an
 * optimization would break: a league we run always keeps its own crest, even
 * when its franchise name would match an NFL club. An owner's real identity
 * outranks a lookup, and "Cowboys" is a perfectly ordinary thing to call a
 * dynasty team.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveFranchiseIdentity,
  franchiseInitials,
  identityIconAlt,
} from '../src/utils/mfl-live-identity';
import { NFL_TEAM_COLORS } from '../src/utils/nfl-team-colors';
import { getLeagueBySlug } from '../src/config/leagues';

const theLeague = getLeagueBySlug('theleague')!;

describe('rung 1 — a league we run', () => {
  it('uses the franchise’s own crest, name and colours', () => {
    const id = resolveFranchiseIdentity({
      franchiseId: '0001',
      franchiseName: 'whatever MFL calls it',
      leagueSlug: theLeague.slug,
    });
    expect(id.rung).toBe('league');
    // The CONFIG's name wins over the name MFL handed us — same call
    // `buildBoardLeagues` already makes for the league itself.
    expect(id.name).toBe('Pacific Pigskins');
    expect(id.icon).toBe('/assets/theleague/icons/pigskins.png');
    expect(id.colors.colorPrimary).toBe('#bd1f2b');
    expect(id.nflCode).toBeNull();
  });

  it('carries the dark-mode brand colours through when the config declares them', () => {
    // The board resolves colours per THEME, so a franchise that hand-picked a
    // dark variant must not have it dropped on the way.
    const id = resolveFranchiseIdentity({
      franchiseId: '0001',
      franchiseName: 'Pacific Pigskins',
      leagueSlug: theLeague.slug,
    });
    expect(id.colors).toHaveProperty('colorPrimaryDark');
  });

  it('BEATS an NFL name match — the rule, not an ordering accident', () => {
    // A TheLeague franchise renamed "Cowboys" keeps its own mark. If this ever
    // flips, an owner's identity is being overwritten by a string lookup.
    const id = resolveFranchiseIdentity({
      franchiseId: '0001',
      franchiseName: 'Cowboys',
      leagueSlug: theLeague.slug,
    });
    expect(id.rung).toBe('league');
    expect(id.icon).toBe('/assets/theleague/icons/pigskins.png');
    expect(id.nflCode).toBeNull();
  });

  it('falls through when the league is ours but the franchise id is not', () => {
    const id = resolveFranchiseIdentity({
      franchiseId: '9999',
      franchiseName: 'Some Outside Team',
      leagueSlug: theLeague.slug,
    });
    expect(id.rung).toBe('text');
  });
});

describe('rung 2 — the name is an NFL club', () => {
  it('uses the club’s mark and brand colours', () => {
    const id = resolveFranchiseIdentity({ franchiseId: '0004', franchiseName: 'Cowboys' });
    expect(id.rung).toBe('nfl');
    expect(id.nflCode).toBe('DAL');
    expect(id.colors.colorPrimary).toBe(NFL_TEAM_COLORS.DAL.primary);
    expect(id.colors.colorSecondary).toBe(NFL_TEAM_COLORS.DAL.secondary);
  });

  it('keeps the OWNER’s name, not the club’s', () => {
    // They called it "Cowboys"; the board calls it "Cowboys". The club
    // supplies the mark, not the label.
    const id = resolveFranchiseIdentity({ franchiseId: '0004', franchiseName: 'Cowboys' });
    expect(id.name).toBe('Cowboys');
    expect(id.name).not.toBe('Dallas Cowboys');
  });

  it('points at the LOCAL svg, which is what the dark swap keys on', () => {
    // `nfl-logo-dark-css.ts` generates its html.dark swap for
    // `/assets/nfl-logos/{CODE}.svg` sources. An ESPN CDN url here would be a
    // cross-origin dependency AND would miss the dark cut entirely.
    const id = resolveFranchiseIdentity({ franchiseId: '0004', franchiseName: 'Pittsburgh Steelers' });
    expect(id.icon).toBe('/assets/nfl-logos/PIT.svg');
    expect(id.icon.startsWith('/')).toBe(true);
    expect(id.icon).not.toContain('espncdn');
  });

  it('resolves a relocated club to its current mark', () => {
    const id = resolveFranchiseIdentity({ franchiseId: '0004', franchiseName: 'Oakland Raiders' });
    expect(id.nflCode).toBe('LV');
    expect(id.icon).toBe('/assets/nfl-logos/LV.svg');
  });

  it('names the club in the alt text rather than shipping a bare code', () => {
    const id = resolveFranchiseIdentity({ franchiseId: '0004', franchiseName: 'Cowboys' });
    expect(identityIconAlt(id)).toBe('Dallas Cowboys logo');
  });
});

describe('rung 3 — text only', () => {
  it('gives initials, no icon, and no invented brand colour', () => {
    const id = resolveFranchiseIdentity({ franchiseId: '0007', franchiseName: 'Wagon Circlers' });
    expect(id.rung).toBe('text');
    expect(id.initials).toBe('WC');
    expect(id.icon).toBe('');
    expect(id.nflCode).toBeNull();
    // One neutral, and no per-name hue: a colour picked by hashing a string
    // looks like a brand and is not one.
    expect(id.colors.colorPrimary).toBeUndefined();
    expect(id.colors.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('two different names get the SAME neutral — nothing is derived from the name', () => {
    const a = resolveFranchiseIdentity({ franchiseId: '1', franchiseName: 'Wagon Circlers' });
    const b = resolveFranchiseIdentity({ franchiseId: '2', franchiseName: 'Backyard Brawlers' });
    expect(a.colors.color).toBe(b.colors.color);
  });

  it('never renders an empty label, even with no name at all', () => {
    const id = resolveFranchiseIdentity({ franchiseId: '0012', franchiseName: '' });
    expect(id.name).toBe('Franchise 0012');
    expect(id.initials).toBeTruthy();
    expect(identityIconAlt(id)).toBe('');
  });
});

describe('franchiseInitials', () => {
  it.each([
    ['Wagon Circlers', 'WC'],
    ['Cowboys', 'CO'],
    ['The Boondock Saints', 'BS'],
    ['  pacific   pigskins  ', 'PP'],
    ['Suh girls, one cup', 'SG'],
    ['49ers', '49'],
    ['', '?'],
    ['   ', '?'],
    ['The', 'TH'],
  ])('%s -> %s', (name, expected) => {
    expect(franchiseInitials(name)).toBe(expected);
  });

  it('is never longer than two characters', () => {
    for (const n of ['A Bruin Pegs Me', 'Dark Magicians of Chaos', 'x', 'Muck Juggling Micks']) {
      expect(franchiseInitials(n).length).toBeLessThanOrEqual(2);
    }
  });
});
