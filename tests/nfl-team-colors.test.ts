import { describe, it, expect } from 'vitest';
import {
  NFL_TEAM_COLORS,
  NFL_COLORS_FALLBACK,
  getNflTeamColors,
  getNflTeamNickname,
  hexToRgba,
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
