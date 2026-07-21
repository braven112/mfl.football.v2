import { describe, it, expect } from 'vitest';
import {
  NFL_TEAM_COLORS,
  NFL_COLORS_FALLBACK,
  getNflTeamColors,
  getNflTeamNickname,
  hexToRgba,
  mixHex,
  desaturateHex,
  pickBrandAccent,
  getPlayerAvatarBackground,
  getPlayerAvatarRing,
  getPlayerAvatarRingDark,
} from '../src/utils/nfl-team-colors';
import { getAllNFLTeamCodes } from '../src/utils/nfl-logo';

const HEX = /^#[0-9a-f]{6}$/;

describe('NFL_TEAM_COLORS', () => {
  it('covers every ESPN team code exactly', () => {
    const codes = getAllNFLTeamCodes();
    for (const code of codes) {
      expect(NFL_TEAM_COLORS[code], `missing colors for ${code}`).toBeDefined();
    }
    expect(Object.keys(NFL_TEAM_COLORS)).toHaveLength(codes.length);
  });

  it('uses lowercase #rrggbb hex for every entry', () => {
    for (const [code, { primary, secondary }] of Object.entries(NFL_TEAM_COLORS)) {
      expect(primary, `${code} primary`).toMatch(HEX);
      expect(secondary, `${code} secondary`).toMatch(HEX);
    }
  });
});

describe('getNflTeamColors', () => {
  it('resolves MFL-format codes via normalization', () => {
    expect(getNflTeamColors('WAS')).toEqual(NFL_TEAM_COLORS.WSH);
    expect(getNflTeamColors('JAC')).toEqual(NFL_TEAM_COLORS.JAX);
    expect(getNflTeamColors('kcc')).toEqual(NFL_TEAM_COLORS.KC);
  });

  it('falls back for unknown and free-agent codes', () => {
    expect(getNflTeamColors('XXX')).toEqual(NFL_COLORS_FALLBACK);
    expect(getNflTeamColors('FA')).toEqual(NFL_COLORS_FALLBACK);
    expect(getNflTeamColors('')).toEqual(NFL_COLORS_FALLBACK);
  });
});

describe('getNflTeamNickname', () => {
  it('returns the nickname for known teams', () => {
    expect(getNflTeamNickname('CIN')).toBe('Bengals');
    expect(getNflTeamNickname('SF')).toBe('49ers');
    expect(getNflTeamNickname('WAS')).toBe('Commanders');
  });

  it('falls back to the normalized code for unknown teams', () => {
    expect(getNflTeamNickname('XXX')).toBe('XXX');
  });
});

describe('hexToRgba', () => {
  it('converts hex to rgba', () => {
    expect(hexToRgba('#fb4f14', 0.5)).toBe('rgba(251, 79, 20, 0.5)');
    expect(hexToRgba('101820', 1)).toBe('rgba(16, 24, 32, 1)');
  });

  it('falls back safely on invalid input', () => {
    expect(hexToRgba('#fff', 0.3)).toBe('rgba(22, 32, 44, 0.3)');
    expect(hexToRgba('not-a-color', 0.3)).toBe('rgba(22, 32, 44, 0.3)');
  });
});

describe('mixHex', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mixHex('#fb4f14', '#000000', 0)).toBe('#fb4f14');
    expect(mixHex('#fb4f14', '#000000', 1)).toBe('#000000');
  });

  it('mixes linearly per channel', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });

  it('falls back to the neutral dark for invalid input', () => {
    expect(mixHex('nope', '#000000', 0)).toBe('#16202c');
  });
});

describe('desaturateHex', () => {
  it('leaves the color unchanged at amount=0', () => {
    expect(desaturateHex('#fb4f14', 0)).toBe('#fb4f14');
  });

  it('collapses to the luminance gray at amount=1', () => {
    const fullGray = desaturateHex('#fb4f14', 1);
    const [, r, g, b] = /^#(..)(..)(..)$/.exec(fullGray)!;
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('keeps grays untouched at any amount', () => {
    expect(desaturateHex('#808080', 0.5)).toBe('#808080');
  });

  it('clamps out-of-range amounts', () => {
    expect(desaturateHex('#fb4f14', -1)).toBe('#fb4f14');
    expect(desaturateHex('#fb4f14', 2)).toBe(desaturateHex('#fb4f14', 1));
  });
});

describe('pickBrandAccent', () => {
  it('keeps a colorful primary', () => {
    // Pigskins: vibrant red primary, near-black secondary
    expect(pickBrandAccent('#bd1f2b', '#181818')).toBe('#bd1f2b');
  });

  it('keeps a usable dark-navy primary over a more chromatic secondary', () => {
    // Cowboy Up: navy primary (their identity) beats the flashier red secondary
    expect(pickBrandAccent('#153366', '#d32a3e')).toBe('#153366');
    // Music City: navy primary kept over red secondary
    expect(pickBrandAccent('#113469', '#c8102e')).toBe('#113469');
  });

  it('prefers a vibrant secondary over a near-black primary', () => {
    // Mavericks: black primary, gold secondary → gold wins
    expect(pickBrandAccent('#181818', '#b5884a')).toBe('#b5884a');
    // Ninjas: black primary, green secondary → green wins
    expect(pickBrandAccent('#181818', '#2f8b59')).toBe('#2f8b59');
  });

  it('keeps the primary when both colors are near-gray (black/white team)', () => {
    // Bring The Pain: black primary, near-white secondary → stay dark, don't invent color
    expect(pickBrandAccent('#181818', '#e9e9e9')).toBe('#181818');
  });

  it('darkens a too-bright hero so white text stays legible', () => {
    // Midwest: bright yellow primary → pulled down from luminance > 170
    const accent = pickBrandAccent('#ffcd00', '#181818');
    expect(accent).not.toBe('#ffcd00');
    expect(accent.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('falls back when no usable color is provided', () => {
    expect(pickBrandAccent(undefined, undefined)).toBe(NFL_COLORS_FALLBACK.primary);
    expect(pickBrandAccent(undefined, undefined, '#123456')).toBe('#123456');
    expect(pickBrandAccent('not-a-hex', undefined, '#123456')).toBe('#123456');
  });

  it('trims surrounding whitespace so the returned color is a clean hex', () => {
    expect(pickBrandAccent('  #bd1f2b  ')).toBe('#bd1f2b');
    expect(pickBrandAccent(' #181818 ', ' #2f8b59 ')).toBe('#2f8b59');
  });
});

/** Perceived luminance (0–255), same weights as the module's private helper. */
function lum(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return 0.299 * ((v >> 16) & 0xff) + 0.587 * ((v >> 8) & 0xff) + 0.114 * (v & 0xff);
}

describe('getPlayerAvatarBackground', () => {
  it('builds a head-spotlight radial anchored on the team primary when it is already readable', () => {
    const bg = getPlayerAvatarBackground('KC');
    expect(bg).toBe(
      `radial-gradient(circle at 50% 30%, ${mixHex('#e31837', '#ffffff', 0.35)} 0%, #e31837 58%, ${mixHex('#e31837', '#0b0e13', 0.45)} 100%)`,
    );
  });

  it('swaps near-black primaries to the lighter chromatic secondary', () => {
    // Titans navy behind a dark headshot was unreadable in dark mode — the
    // chip must anchor on their light blue instead. Same for Steelers gold,
    // Bears orange, Seahawks action green.
    expect(getPlayerAvatarBackground('TEN')).toContain(NFL_TEAM_COLORS.TEN.secondary);
    expect(getPlayerAvatarBackground('TEN')).not.toContain(NFL_TEAM_COLORS.TEN.primary);
    expect(getPlayerAvatarBackground('PIT')).toContain(NFL_TEAM_COLORS.PIT.secondary);
    expect(getPlayerAvatarBackground('CHI')).toContain(NFL_TEAM_COLORS.CHI.secondary);
    expect(getPlayerAvatarBackground('SEA')).toContain(NFL_TEAM_COLORS.SEA.secondary);
  });

  it('never swaps to a near-gray secondary — lightens the primary instead', () => {
    // Cowboys navy must not lose to their silver; Raiders black lightens to
    // its own silver-gray rather than adopting the low-chroma secondary.
    expect(getPlayerAvatarBackground('DAL')).not.toContain(NFL_TEAM_COLORS.DAL.secondary);
    expect(getPlayerAvatarBackground('LV')).not.toContain(NFL_TEAM_COLORS.LV.secondary);
  });

  it('keeps a dark-but-chromatic primary (lightened) instead of jumping to the secondary', () => {
    // Bills royal blue and Giants blue are identity colors that survive a
    // lightness lift — they must not swap to their red secondaries.
    expect(getPlayerAvatarBackground('BUF')).not.toContain(NFL_TEAM_COLORS.BUF.secondary);
    expect(getPlayerAvatarBackground('NYG')).not.toContain(NFL_TEAM_COLORS.NYG.secondary);
  });

  it('meets the dark-mode luminance floors for every team and the fallback', () => {
    // The guard this change exists for: no team's chip may ever again render
    // a near-black backdrop behind a dark headshot in dark mode. The center
    // stop sits behind the player's head and carries the strictest floor.
    for (const code of [...Object.keys(NFL_TEAM_COLORS), 'FA']) {
      const bg = getPlayerAvatarBackground(code);
      const stops = bg.match(/#[0-9a-f]{6}/g)!;
      expect(stops, `${code} gradient stops`).toHaveLength(3);
      const [headStop, anchorStop, edgeStop] = stops;
      expect(lum(headStop), `${code} head spotlight too dark (${headStop})`).toBeGreaterThanOrEqual(125);
      expect(lum(headStop), `${code} head spotlight not lighter than anchor`).toBeGreaterThan(lum(anchorStop));
      expect(lum(anchorStop), `${code} anchor stop too dark (${anchorStop})`).toBeGreaterThanOrEqual(60);
      expect(lum(edgeStop), `${code} edge stop too dark (${edgeStop})`).toBeGreaterThanOrEqual(35);
    }
  });

  it('normalizes MFL-format codes to the same team gradient as the ESPN code', () => {
    // MFL uses 'KCC' for Kansas City; it must normalize to the same gradient as
    // the ESPN 'KC' code (guards against a regression in normalizeTeamCode).
    expect(getPlayerAvatarBackground('KCC')).toBe(getPlayerAvatarBackground('KC'));
    expect(getPlayerAvatarBackground('KCC')).toContain('#e31837');
  });

  it('falls back to the league-neutral blue for free agents / unknown codes', () => {
    const fa = getPlayerAvatarBackground('FA');
    expect(fa).toBe(getPlayerAvatarBackground(''));
    expect(fa).toContain(NFL_COLORS_FALLBACK.primary);
  });

  it('always returns a valid CSS radial-gradient for every team and the fallback', () => {
    for (const code of [...Object.keys(NFL_TEAM_COLORS), 'FA']) {
      expect(getPlayerAvatarBackground(code)).toMatch(
        /^radial-gradient\(circle at 50% 30%, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 58%, #[0-9a-f]{6} 100%\)$/,
      );
    }
  });
});

describe('getPlayerAvatarRing / getPlayerAvatarRingDark', () => {
  it('rings echo the gradient anchor per theme: light darker, dark lighter', () => {
    // The rings must be mixes of the SAME anchor the gradient uses — the
    // light ring shifted toward ink (below the anchor's luminance), the dark
    // ring toward white (above it) — for every team and the fallback.
    for (const code of [...Object.keys(NFL_TEAM_COLORS), 'FA']) {
      const anchor = getPlayerAvatarBackground(code).match(/#[0-9a-f]{6}/g)![1];
      expect(getPlayerAvatarRing(code), `${code} light ring`).toMatch(HEX);
      expect(getPlayerAvatarRingDark(code), `${code} dark ring`).toMatch(HEX);
      expect(lum(getPlayerAvatarRing(code)), `${code} light ring not darker than anchor`).toBeLessThan(lum(anchor));
      expect(lum(getPlayerAvatarRingDark(code)), `${code} dark ring not lighter than anchor`).toBeGreaterThan(lum(anchor));
    }
  });

  it('derives secondary-swapped teams from the swapped anchor, not the raw primary', () => {
    // PIT's anchor is its GOLD secondary (near-black primary swapped out) —
    // the rings must be gold-tinted, not gray mixes of the black primary.
    const goldRing = getPlayerAvatarRing('PIT');
    const [, r, g, b] = /^#(..)(..)(..)$/.exec(goldRing)!.map((c) => parseInt(c, 16));
    expect(r, 'PIT light ring should be warm (r > b)').toBeGreaterThan(b);
    expect(g, 'PIT light ring should be warm (g > b)').toBeGreaterThan(b);
    expect(getPlayerAvatarRing('PIT')).not.toBe(getPlayerAvatarRing('LV'));
  });

  it('exact mix contract: 35% toward ink (light) / white (dark) from the anchor', () => {
    const anchor = getPlayerAvatarBackground('KC').match(/#[0-9a-f]{6}/g)![1];
    expect(getPlayerAvatarRing('KC')).toBe(mixHex(anchor, '#0b0e13', 0.35));
    expect(getPlayerAvatarRingDark('KC')).toBe(mixHex(anchor, '#ffffff', 0.35));
  });

  it('normalizes MFL codes and falls back for unknown codes like the background', () => {
    expect(getPlayerAvatarRing('KCC')).toBe(getPlayerAvatarRing('KC'));
    expect(getPlayerAvatarRingDark('WAS')).toBe(getPlayerAvatarRingDark('WSH'));
    expect(getPlayerAvatarRing('FA')).toBe(getPlayerAvatarRing(''));
  });
});
