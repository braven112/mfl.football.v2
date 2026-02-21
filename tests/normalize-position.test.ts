/**
 * Unit Tests for Position Normalization Utility
 * Tests position mapping, case insensitivity, whitespace handling, and edge cases
 */

import { describe, it, expect } from 'vitest';
import { normalizePosition } from '../src/utils/normalize-position';

describe('normalizePosition - Standard Positions', () => {
  it('should preserve standard QB position', () => {
    expect(normalizePosition('QB')).toBe('QB');
  });

  it('should preserve standard RB position', () => {
    expect(normalizePosition('RB')).toBe('RB');
  });

  it('should preserve standard WR position', () => {
    expect(normalizePosition('WR')).toBe('WR');
  });

  it('should preserve standard TE position', () => {
    expect(normalizePosition('TE')).toBe('TE');
  });

  it('should preserve standard PK position', () => {
    expect(normalizePosition('PK')).toBe('PK');
  });

  it('should preserve standard DEF position', () => {
    expect(normalizePosition('DEF')).toBe('DEF');
  });
});

describe('normalizePosition - Kicker Mappings', () => {
  it('should map K to PK', () => {
    expect(normalizePosition('K')).toBe('PK');
  });

  it('should preserve PK (already normalized)', () => {
    expect(normalizePosition('PK')).toBe('PK');
  });

  it('should map KICKER to PK', () => {
    expect(normalizePosition('KICKER')).toBe('PK');
  });
});

describe('normalizePosition - Defense/DST Mappings', () => {
  it('should map DST to DEF', () => {
    expect(normalizePosition('DST')).toBe('DEF');
  });

  it('should map D/ST to DEF', () => {
    expect(normalizePosition('D/ST')).toBe('DEF');
  });

  it('should preserve DEF (already normalized)', () => {
    expect(normalizePosition('DEF')).toBe('DEF');
  });

  it('should map DEFENSE to DEF', () => {
    expect(normalizePosition('DEFENSE')).toBe('DEF');
  });
});

describe('normalizePosition - Running Back Mappings', () => {
  it('should preserve RB', () => {
    expect(normalizePosition('RB')).toBe('RB');
  });

  it('should map HB to RB', () => {
    expect(normalizePosition('HB')).toBe('RB');
  });

  it('should map RUNNING BACK to RB', () => {
    expect(normalizePosition('RUNNING BACK')).toBe('RB');
  });

  it('should map RUNNINGBACK (no space) to RB', () => {
    expect(normalizePosition('RUNNINGBACK')).toBe('RB');
  });
});

describe('normalizePosition - Wide Receiver Mappings', () => {
  it('should preserve WR', () => {
    expect(normalizePosition('WR')).toBe('WR');
  });

  it('should map WIDE RECEIVER to WR', () => {
    expect(normalizePosition('WIDE RECEIVER')).toBe('WR');
  });

  it('should map WIDERECEIVER (no space) to WR', () => {
    expect(normalizePosition('WIDERECEIVER')).toBe('WR');
  });

  it('should map RECEIVER to WR', () => {
    expect(normalizePosition('RECEIVER')).toBe('WR');
  });
});

describe('normalizePosition - Tight End Mappings', () => {
  it('should preserve TE', () => {
    expect(normalizePosition('TE')).toBe('TE');
  });

  it('should map TIGHT END to TE', () => {
    expect(normalizePosition('TIGHT END')).toBe('TE');
  });

  it('should map TIGHTEND (no space) to TE', () => {
    expect(normalizePosition('TIGHTEND')).toBe('TE');
  });
});

describe('normalizePosition - Quarterback Mappings', () => {
  it('should preserve QB', () => {
    expect(normalizePosition('QB')).toBe('QB');
  });

  it('should map QUARTERBACK to QB', () => {
    expect(normalizePosition('QUARTERBACK')).toBe('QB');
  });
});

describe('normalizePosition - Case Insensitivity', () => {
  it('should handle lowercase positions', () => {
    expect(normalizePosition('qb')).toBe('QB');
    expect(normalizePosition('rb')).toBe('RB');
    expect(normalizePosition('wr')).toBe('WR');
    expect(normalizePosition('te')).toBe('TE');
  });

  it('should handle mixed case positions', () => {
    expect(normalizePosition('Qb')).toBe('QB');
    expect(normalizePosition('RB')).toBe('RB');
    expect(normalizePosition('Wr')).toBe('WR');
    expect(normalizePosition('Te')).toBe('TE');
  });

  it('should handle lowercase verbose names', () => {
    expect(normalizePosition('quarterback')).toBe('QB');
    expect(normalizePosition('running back')).toBe('RB');
    expect(normalizePosition('wide receiver')).toBe('WR');
    expect(normalizePosition('tight end')).toBe('TE');
    expect(normalizePosition('kicker')).toBe('PK');
    expect(normalizePosition('defense')).toBe('DEF');
  });

  it('should handle mixed case verbose names', () => {
    expect(normalizePosition('Quarterback')).toBe('QB');
    expect(normalizePosition('Running Back')).toBe('RB');
    expect(normalizePosition('Wide Receiver')).toBe('WR');
    expect(normalizePosition('Tight End')).toBe('TE');
  });
});

describe('normalizePosition - DLF Trailing Digits', () => {
  it('should strip trailing digit from QB position (QB1)', () => {
    expect(normalizePosition('QB1')).toBe('QB');
  });

  it('should strip trailing digit from RB position (RB2)', () => {
    expect(normalizePosition('RB2')).toBe('RB');
  });

  it('should strip trailing digit from WR position (WR1)', () => {
    expect(normalizePosition('WR1')).toBe('WR');
  });

  it('should strip trailing digit from TE position (TE1)', () => {
    expect(normalizePosition('TE1')).toBe('TE');
  });

  it('should strip trailing digit from mapped positions', () => {
    expect(normalizePosition('K1')).toBe('PK');
    expect(normalizePosition('DST1')).toBe('DEF');
    expect(normalizePosition('HB2')).toBe('RB');
  });

  it('should handle multiple trailing digits (strip all)', () => {
    expect(normalizePosition('QB12')).toBe('QB');
    expect(normalizePosition('WR99')).toBe('WR');
  });

  it('should handle lowercase with trailing digits', () => {
    expect(normalizePosition('qb1')).toBe('QB');
    expect(normalizePosition('wr2')).toBe('WR');
  });

  it('should handle verbose names with trailing digits', () => {
    expect(normalizePosition('QUARTERBACK1')).toBe('QB');
    expect(normalizePosition('RUNNING BACK2')).toBe('RB');
    expect(normalizePosition('KICKER1')).toBe('PK');
  });
});

describe('normalizePosition - Whitespace Handling', () => {
  it('should trim leading whitespace', () => {
    expect(normalizePosition(' QB')).toBe('QB');
    expect(normalizePosition('  WR')).toBe('WR');
    expect(normalizePosition('\tTE')).toBe('TE');
  });

  it('should trim trailing whitespace', () => {
    expect(normalizePosition('QB ')).toBe('QB');
    expect(normalizePosition('WR  ')).toBe('WR');
    expect(normalizePosition('TE\t')).toBe('TE');
  });

  it('should trim both leading and trailing whitespace', () => {
    expect(normalizePosition(' QB ')).toBe('QB');
    expect(normalizePosition('  WR  ')).toBe('WR');
    expect(normalizePosition('\tTE\t')).toBe('TE');
  });

  it('should trim whitespace from verbose names', () => {
    expect(normalizePosition(' RUNNING BACK ')).toBe('RB');
    expect(normalizePosition('  WIDE RECEIVER  ')).toBe('WR');
    expect(normalizePosition(' TIGHT END ')).toBe('TE');
  });

  it('should trim whitespace with trailing digits', () => {
    expect(normalizePosition(' QB1 ')).toBe('QB');
    expect(normalizePosition('  WR2  ')).toBe('WR');
  });

  it('should handle only whitespace input', () => {
    expect(normalizePosition('   ')).toBe('');
    expect(normalizePosition('\t')).toBe('');
  });
});

describe('normalizePosition - Edge Cases', () => {
  it('should handle empty string', () => {
    expect(normalizePosition('')).toBe('');
  });

  it('should handle null (coerces to empty string)', () => {
    expect(normalizePosition(null as any)).toBe('');
  });

  it('should handle undefined (coerces to empty string)', () => {
    expect(normalizePosition(undefined as any)).toBe('');
  });

  it('should preserve unknown positions as-is', () => {
    expect(normalizePosition('LB')).toBe('LB');
    expect(normalizePosition('DE')).toBe('DE');
    expect(normalizePosition('S')).toBe('S');
    expect(normalizePosition('UNKNOWN')).toBe('UNKNOWN');
  });

  it('should preserve unknown position case', () => {
    expect(normalizePosition('lb')).toBe('LB');
    expect(normalizePosition('De')).toBe('DE');
  });

  it('should strip trailing digits from unknown positions', () => {
    expect(normalizePosition('LB1')).toBe('LB');
    expect(normalizePosition('DE2')).toBe('DE');
    expect(normalizePosition('S3')).toBe('S');
  });

  it('should handle positions with internal spaces', () => {
    expect(normalizePosition('RUNNING BACK')).toBe('RB');
    expect(normalizePosition('WIDE RECEIVER')).toBe('WR');
    expect(normalizePosition('TIGHT END')).toBe('TE');
  });

  it('should handle positions with special characters (normalize)', () => {
    expect(normalizePosition('D/ST')).toBe('DEF');
    expect(normalizePosition('d/st')).toBe('DEF');
  });
});

describe('normalizePosition - Complex Combinations', () => {
  it('should handle whitespace + lowercase + trailing digit', () => {
    expect(normalizePosition(' qb1 ')).toBe('QB');
    expect(normalizePosition('  wr2  ')).toBe('WR');
  });

  it('should handle whitespace + verbose name + trailing digit', () => {
    expect(normalizePosition(' RUNNING BACK1 ')).toBe('RB');
    expect(normalizePosition('  WIDE RECEIVER2  ')).toBe('WR');
  });

  it('should handle all normalizations together', () => {
    expect(normalizePosition('  quarterback1  ')).toBe('QB');
    expect(normalizePosition(' RUNNING BACK2 ')).toBe('RB');
    expect(normalizePosition('  wide receiver3  ')).toBe('WR');
    expect(normalizePosition(' TIGHT END1 ')).toBe('TE');
    expect(normalizePosition('  kicker2  ')).toBe('PK');
    expect(normalizePosition(' DEFENSE1 ')).toBe('DEF');
  });
});

describe('normalizePosition - Real-World Scenarios', () => {
  it('should normalize DLF-style positions with leading/trailing spaces', () => {
    // Common from fantasy data sources
    expect(normalizePosition(' QB1 ')).toBe('QB');
    expect(normalizePosition('WR1')).toBe('WR');
    expect(normalizePosition('RB2')).toBe('RB');
    expect(normalizePosition('TE')).toBe('TE');
  });

  it('should normalize MFL-style positions', () => {
    // MFL uses standard abbreviations
    expect(normalizePosition('K')).toBe('PK');
    expect(normalizePosition('DST')).toBe('DEF');
  });

  it('should normalize ESPN-style positions', () => {
    // ESPN uses verbose names
    expect(normalizePosition('Quarterback')).toBe('QB');
    expect(normalizePosition('Running Back')).toBe('RB');
    expect(normalizePosition('Wide Receiver')).toBe('WR');
    expect(normalizePosition('Tight End')).toBe('TE');
    expect(normalizePosition('Kicker')).toBe('PK');
  });

  it('should normalize inconsistent user input', () => {
    expect(normalizePosition('  Qb  ')).toBe('QB');
    expect(normalizePosition('running back')).toBe('RB');
    expect(normalizePosition('WIDE RECEIVER1')).toBe('WR');
  });
});
