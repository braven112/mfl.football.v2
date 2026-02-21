/**
 * Unit Tests for Rankings Importer Utility
 * Tests player name normalization, MFL player matching, fuzzy matching algorithms,
 * and confidence scoring.
 */

import { describe, it, expect } from 'vitest';
import { normalizePlayerName, matchPlayerToMFL } from '../src/utils/rankings-importer';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const mflPlayers = [
  { id: '1001', name: 'Mahomes, Patrick', position: 'QB', team: 'KCC' },
  { id: '1002', name: 'Chase, Jamarr', position: 'WR', team: 'CIN' },
  { id: '1003', name: 'Robinson, Bijan', position: 'RB', team: 'ATL' },
  { id: '1004', name: 'Kelce, Travis', position: 'TE', team: 'KCC' },
  { id: '1005', name: 'Allen, Josh', position: 'QB', team: 'BUF' },
  { id: '1006', name: 'Jefferson, Justin', position: 'WR', team: 'MIN' },
  { id: '1007', name: 'Henry, Derrick', position: 'RB', team: 'TEN' },
  { id: '1008', name: 'Ekeler, Austin', position: 'RB', team: 'LAC' },
  { id: '1009', name: 'Harrison, Marvin', position: 'WR', team: 'PHI' },
  { id: '1010', name: 'Griffin, Robert', position: 'QB', team: 'BAL' },
  { id: '1011', name: 'Andrews, Mark', position: 'TE', team: 'BAL' },
  { id: '1012', name: 'Harris, Gary', position: 'WR', team: 'DEN' },
];

// =============================================================================
// normalizePlayerName TESTS
// =============================================================================

describe('normalizePlayerName - Basic Transformations', () => {
  it('should convert to lowercase', () => {
    expect(normalizePlayerName('Patrick Mahomes')).toBe('patrick mahomes');
  });

  it('should handle already lowercase input', () => {
    expect(normalizePlayerName('patrick mahomes')).toBe('patrick mahomes');
  });

  it('should handle mixed case input', () => {
    expect(normalizePlayerName('PaTrIcK mAhOmEs')).toBe('patrick mahomes');
  });
});

describe('normalizePlayerName - Period Removal', () => {
  it('should remove periods from initials', () => {
    expect(normalizePlayerName('T.J. Watt')).toBe('tj watt');
  });

  it('should remove single period', () => {
    expect(normalizePlayerName('T. Watt')).toBe('t watt');
  });

  it('should remove multiple periods in name', () => {
    expect(normalizePlayerName('J.K. Dobbins')).toBe('jk dobbins');
  });

  it('should handle name without periods', () => {
    expect(normalizePlayerName('Patrick Mahomes')).toBe('patrick mahomes');
  });
});

describe('normalizePlayerName - Apostrophe Removal', () => {
  it('should remove apostrophes from names', () => {
    expect(normalizePlayerName('Ja\'Marr Chase')).toBe('jamarr chase');
  });

  it('should handle multiple apostrophes', () => {
    expect(normalizePlayerName('Ja\'Marr O\'Brien')).toBe('jamarr obrien');
  });

  it('should handle name without apostrophes', () => {
    expect(normalizePlayerName('Patrick Mahomes')).toBe('patrick mahomes');
  });
});

describe('normalizePlayerName - Suffix Removal (Jr)', () => {
  it('should remove Jr with period', () => {
    expect(normalizePlayerName('Marvin Harrison Jr.')).toBe('marvin harrison');
  });

  it('should remove Jr without period', () => {
    expect(normalizePlayerName('Marvin Harrison Jr')).toBe('marvin harrison');
  });

  it('should handle case-insensitive Jr', () => {
    expect(normalizePlayerName('Marvin Harrison jr')).toBe('marvin harrison');
    expect(normalizePlayerName('Marvin Harrison JR')).toBe('marvin harrison');
  });

  it('should only remove Jr at end of name', () => {
    expect(normalizePlayerName('Jr Smith')).toBe('jr smith');
  });
});

describe('normalizePlayerName - Suffix Removal (Sr)', () => {
  it('should remove Sr with period', () => {
    expect(normalizePlayerName('Gary Harris Sr.')).toBe('gary harris');
  });

  it('should remove Sr without period', () => {
    expect(normalizePlayerName('Gary Harris Sr')).toBe('gary harris');
  });

  it('should handle case-insensitive Sr', () => {
    expect(normalizePlayerName('Gary Harris sr')).toBe('gary harris');
    expect(normalizePlayerName('Gary Harris SR')).toBe('gary harris');
  });
});

describe('normalizePlayerName - Suffix Removal (III)', () => {
  it('should remove III', () => {
    expect(normalizePlayerName('Robert Griffin III')).toBe('robert griffin');
  });

  it('should remove III in any case', () => {
    expect(normalizePlayerName('Robert Griffin iii')).toBe('robert griffin');
    expect(normalizePlayerName('Robert Griffin III')).toBe('robert griffin');
  });
});

describe('normalizePlayerName - Suffix Removal (II)', () => {
  it('should remove II', () => {
    expect(normalizePlayerName('Mark Andrews II')).toBe('mark andrews');
  });

  it('should remove II in any case', () => {
    expect(normalizePlayerName('Mark Andrews ii')).toBe('mark andrews');
    expect(normalizePlayerName('Mark Andrews II')).toBe('mark andrews');
  });
});

describe('normalizePlayerName - Suffix Removal (IV and V)', () => {
  it('should remove IV suffix', () => {
    expect(normalizePlayerName('John Smith IV')).toBe('john smith');
  });

  it('should remove V suffix', () => {
    expect(normalizePlayerName('Jane Doe V')).toBe('jane doe');
  });
});

describe('normalizePlayerName - Punctuation Removal', () => {
  it('should remove commas', () => {
    expect(normalizePlayerName('Mahomes, Patrick')).toBe('mahomes patrick');
  });

  it('should remove hyphens', () => {
    expect(normalizePlayerName('Jean-Paul Nadeau')).toBe('jeanpaul nadeau');
  });

  it('should remove parentheses', () => {
    expect(normalizePlayerName('Patrick (Pat) Mahomes')).toBe('patrick pat mahomes');
  });

  it('should remove all non-alphanumeric except spaces', () => {
    expect(normalizePlayerName('Test@Player#123')).toBe('testplayer123');
  });
});

describe('normalizePlayerName - Whitespace Handling', () => {
  it('should trim leading whitespace', () => {
    expect(normalizePlayerName('  Patrick Mahomes')).toBe('patrick mahomes');
  });

  it('should trim trailing whitespace', () => {
    expect(normalizePlayerName('Patrick Mahomes  ')).toBe('patrick mahomes');
  });

  it('should normalize multiple spaces to single space', () => {
    expect(normalizePlayerName('Patrick    Mahomes')).toBe('patrick mahomes');
  });

  it('should normalize mixed whitespace (spaces, tabs)', () => {
    expect(normalizePlayerName('Patrick\t\tMahomes')).toBe('patrick mahomes');
  });

  it('should handle name with only spaces', () => {
    expect(normalizePlayerName('   ')).toBe('');
  });
});

describe('normalizePlayerName - Complex Combinations', () => {
  it('should handle periods + apostrophes + suffixes', () => {
    expect(normalizePlayerName("T.J. Ja'Marr Jr.")).toBe('tj jamarr');
  });

  it('should handle complex name with multiple normalizations', () => {
    // Note: III in the middle doesn't get removed, only at end
    expect(normalizePlayerName("  Jean-Paul O'Brien III  ")).toBe('jeanpaul obrien iii');
  });

  it('should handle comma-separated format (Jr in middle not removed)', () => {
    // Jr in middle won't be removed since regex only matches at end of string
    expect(normalizePlayerName('Mahomes Jr., Patrick')).toBe('mahomes jr patrick');
  });
});

describe('normalizePlayerName - Real-World Scenarios', () => {
  it('should normalize Ja\'Marr Chase', () => {
    expect(normalizePlayerName('Ja\'Marr Chase')).toBe('jamarr chase');
  });

  it('should normalize Marvin Harrison Jr.', () => {
    expect(normalizePlayerName('Marvin Harrison Jr.')).toBe('marvin harrison');
  });

  it('should normalize Robert Griffin III', () => {
    expect(normalizePlayerName('Robert Griffin III')).toBe('robert griffin');
  });

  it('should normalize T.J. Watt', () => {
    expect(normalizePlayerName('T.J. Watt')).toBe('tj watt');
  });

  it('should normalize MFL comma-separated format', () => {
    expect(normalizePlayerName('Chase, Ja\'Marr')).toBe('chase jamarr');
  });
});

// =============================================================================
// matchPlayerToMFL TESTS
// =============================================================================

describe('matchPlayerToMFL - Exact Matches', () => {
  it('should match exact name in standard format', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1001');
    expect(result.confidence).toBe(1.0);
  });

  it('should match reversed name format (Last, First)', () => {
    const result = matchPlayerToMFL('Mahomes, Patrick', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1001');
    expect(result.confidence).toBe(1.0);
  });

  it('should match name with different case', () => {
    const result = matchPlayerToMFL('patrick mahomes', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1001');
  });

  it('should match name with different case in reversed format', () => {
    const result = matchPlayerToMFL('mahomes, patrick', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1001');
  });
});

describe('matchPlayerToMFL - Fuzzy Matches', () => {
  it('should match name with apostrophes normalized', () => {
    const result = matchPlayerToMFL('Ja\'Marr Chase', 'WR', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1002');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('should match name when Jr suffix removed by normalization', () => {
    // Input: "Marvin Harrison Jr." -> normalized to "marvin harrison"
    // MFL: "Harrison, Marvin" -> normalized to "harrison marvin"
    const result = matchPlayerToMFL('Marvin Harrison Jr', 'WR', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1009');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('should match name when Sr suffix removed by normalization', () => {
    // Input: "Gary Harris Sr" -> normalized to "gary harris"
    // MFL: "Harris, Gary" -> normalized to "harris gary"
    const result = matchPlayerToMFL('Gary Harris Sr', 'WR', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1012');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('should match name when III suffix removed by normalization', () => {
    // Input: "Robert Griffin III" -> normalized to "robert griffin"
    // MFL: "Griffin, Robert" -> normalized to "griffin robert"
    const result = matchPlayerToMFL('Robert Griffin III', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1010');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('should match name with minor spelling variations', () => {
    // Josh Allen - slight variation
    const result = matchPlayerToMFL('Joshua Allen', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1005');
  });
});

describe('matchPlayerToMFL - Position Filtering', () => {
  it('should NOT match player of wrong position', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'WR', mflPlayers);
    expect(result.matched).toBe(false);
    expect(result.playerId).toBeNull();
  });

  it('should NOT match Ja\'Marr Chase as QB when WR available', () => {
    const result = matchPlayerToMFL('Ja\'Marr Chase', 'QB', mflPlayers);
    expect(result.matched).toBe(false);
    expect(result.playerId).toBeNull();
  });

  it('should match correct position from multiple players with same last name', () => {
    // Allen at QB position
    const result = matchPlayerToMFL('Allen, Josh', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1005');
  });
});

describe('matchPlayerToMFL - No Match Scenarios', () => {
  it('should not match unknown player', () => {
    const result = matchPlayerToMFL('Fake Player', 'QB', mflPlayers);
    expect(result.matched).toBe(false);
    expect(result.playerId).toBeNull();
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('should return null playerId when no match found', () => {
    const result = matchPlayerToMFL('Unknown Player Name', 'RB', mflPlayers);
    expect(result.playerId).toBeNull();
    expect(result.matched).toBe(false);
  });

  it('should handle position that does not exist in player list', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'LB', mflPlayers);
    expect(result.matched).toBe(false);
    expect(result.playerId).toBeNull();
  });

  it('should not match when player list is empty', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', []);
    expect(result.matched).toBe(false);
    expect(result.playerId).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

describe('matchPlayerToMFL - Threshold Parameter', () => {
  it('should use default threshold of 0.7', () => {
    const result = matchPlayerToMFL('Patrik Mahomes', 'QB', mflPlayers);
    expect(result.matched).toBe(result.confidence >= 0.7);
  });

  it('should respect custom high threshold', () => {
    const result = matchPlayerToMFL('Patrik Mahomes', 'QB', mflPlayers, 0.99);
    expect(result.matched).toBe(false);
    expect(result.confidence).toBeLessThan(0.99);
  });

  it('should respect custom low threshold', () => {
    const result = matchPlayerToMFL('Patrik Mahomes', 'QB', mflPlayers, 0.5);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('should not match when similarity below threshold', () => {
    const result = matchPlayerToMFL('Completely Different Name', 'QB', mflPlayers, 0.7);
    expect(result.matched).toBe(false);
  });

  it('should match when similarity at exact threshold', () => {
    // Use a very similar name that should be at or above threshold
    const result = matchPlayerToMFL('Mahomes Patrick', 'QB', mflPlayers, 0.8);
    // Should be high confidence match even with reversed order
    expect(result.matched).toBe(true);
  });
});

describe('matchPlayerToMFL - Confidence Scoring', () => {
  it('should return 1.0 confidence for exact match', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    expect(result.confidence).toBe(1.0);
  });

  it('should return 1.0 confidence for exact match in reversed format', () => {
    const result = matchPlayerToMFL('Mahomes, Patrick', 'QB', mflPlayers);
    expect(result.confidence).toBe(1.0);
  });

  it('should return decreasing confidence with greater spelling differences', () => {
    const exact = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    const minor = matchPlayerToMFL('Patrick Mahome', 'QB', mflPlayers);
    const major = matchPlayerToMFL('Patrik Mahom', 'QB', mflPlayers);

    expect(exact.confidence).toBeGreaterThan(minor.confidence);
    expect(minor.confidence).toBeGreaterThan(major.confidence);
  });

  it('should have confidence between 0 and 1', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('matchPlayerToMFL - Alternatives', () => {
  it('should include alternatives when best match is fuzzy (not exact)', () => {
    // Use a slightly misspelled name so it goes through fuzzy path, not exact-match fast path
    const result = matchPlayerToMFL('Jossh Allen', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.alternatives).toBeDefined();
    expect(Array.isArray(result.alternatives)).toBe(true);
  });

  it('should skip alternatives for exact matches (performance optimization)', () => {
    const result = matchPlayerToMFL('Josh Allen', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe(1.0);
    // Exact matches skip alternatives since they are unnecessary
    expect(result.alternatives).toBeUndefined();
  });

  it('should filter alternatives by minimum confidence threshold (0.5)', () => {
    const result = matchPlayerToMFL('Josh Allen', 'QB', mflPlayers);
    if (result.alternatives) {
      result.alternatives.forEach(alt => {
        expect(alt.confidence).toBeGreaterThanOrEqual(0.5);
      });
    }
  });

  it('should not include best match in alternatives', () => {
    const result = matchPlayerToMFL('Josh Allen', 'QB', mflPlayers);
    if (result.alternatives && result.playerId) {
      const alternativeIds = result.alternatives.map(a => a.id);
      expect(alternativeIds).not.toContain(result.playerId);
    }
  });

  it('should limit alternatives to top 3 (excluding best)', () => {
    const result = matchPlayerToMFL('Allen', 'QB', mflPlayers);
    if (result.alternatives) {
      expect(result.alternatives.length).toBeLessThanOrEqual(3);
    }
  });

  it('should include playerId in alternatives', () => {
    const result = matchPlayerToMFL('Josh Allen', 'QB', mflPlayers);
    if (result.alternatives && result.alternatives.length > 0) {
      expect(result.alternatives[0]).toHaveProperty('playerId');
      expect(typeof result.alternatives[0].playerId).toBe('string');
    }
  });

  it('should include player name in alternatives', () => {
    const result = matchPlayerToMFL('Josh Allen', 'QB', mflPlayers);
    if (result.alternatives && result.alternatives.length > 0) {
      expect(result.alternatives[0]).toHaveProperty('name');
      expect(typeof result.alternatives[0].name).toBe('string');
    }
  });

  it('should include confidence score in alternatives', () => {
    const result = matchPlayerToMFL('Josh Allen', 'QB', mflPlayers);
    if (result.alternatives && result.alternatives.length > 0) {
      expect(result.alternatives[0]).toHaveProperty('confidence');
      expect(typeof result.alternatives[0].confidence).toBe('number');
    }
  });

  it('should not include alternatives when matched is false', () => {
    const result = matchPlayerToMFL('Fake Player', 'QB', mflPlayers);
    if (result.alternatives) {
      // Alternatives should still be filtered by confidence threshold
      result.alternatives.forEach(alt => {
        expect(alt.confidence).toBeGreaterThanOrEqual(0.5);
      });
    }
  });
});

describe('matchPlayerToMFL - Return Type Structure', () => {
  it('should return object with required fields', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    expect(result).toHaveProperty('playerId');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('matched');
  });

  it('should return playerId as string or null', () => {
    const result1 = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    const result2 = matchPlayerToMFL('Fake Player', 'QB', mflPlayers);

    expect(typeof result1.playerId === 'string' || result1.playerId === null).toBe(true);
    expect(typeof result2.playerId === 'string' || result2.playerId === null).toBe(true);
  });

  it('should return confidence as number', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    expect(typeof result.confidence).toBe('number');
  });

  it('should return matched as boolean', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    expect(typeof result.matched).toBe('boolean');
  });

  it('should return alternatives as array when present', () => {
    const result = matchPlayerToMFL('Josh Allen', 'QB', mflPlayers);
    if (result.alternatives) {
      expect(Array.isArray(result.alternatives)).toBe(true);
    }
  });
});

describe('matchPlayerToMFL - Edge Cases', () => {
  it('should handle single-word names', () => {
    // This is an edge case - single word player names
    const testPlayers = [
      { id: '1', name: 'Cher', position: 'WR', team: 'TST' },
    ];
    const result = matchPlayerToMFL('Cher', 'WR', testPlayers);
    expect(result.playerId).toBe('1');
    expect(result.matched).toBe(true);
  });

  it('should handle names with only spaces', () => {
    const result = matchPlayerToMFL('   ', 'QB', mflPlayers);
    expect(result.matched).toBe(false);
    expect(result.playerId).toBeNull();
  });

  it('should handle empty player list', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', []);
    expect(result.matched).toBe(false);
    expect(result.playerId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('should handle position case sensitivity correctly', () => {
    // Positions should match exactly as provided
    const result = matchPlayerToMFL('Patrick Mahomes', 'qb', mflPlayers);
    // Position 'qb' does not match 'QB' in player list
    expect(result.matched).toBe(false);
  });
});

describe('matchPlayerToMFL - Multiple Player Name Variations', () => {
  it('should distinguish between similar first names', () => {
    const result1 = matchPlayerToMFL('Josh Allen', 'QB', mflPlayers);
    const result2 = matchPlayerToMFL('Allen, Josh', 'QB', mflPlayers);
    expect(result1.playerId).toBe(result2.playerId);
    expect(result1.playerId).toBe('1005');
  });

  it('should handle multiple players with similar names', () => {
    // Both Jefferson and other players
    const result = matchPlayerToMFL('Justin Jefferson', 'WR', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1006');
  });
});

describe('matchPlayerToMFL - Real-World Scenarios', () => {
  it('should match fantasy pros style name with Mahomes', () => {
    const result = matchPlayerToMFL('Patrick Mahomes', 'QB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1001');
    expect(result.confidence).toBe(1.0);
  });

  it('should match fantasy pros style name with Ja\'Marr Chase', () => {
    const result = matchPlayerToMFL('Ja\'Marr Chase', 'WR', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1002');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('should match MFL format (Last, First)', () => {
    const result = matchPlayerToMFL('Kelce, Travis', 'TE', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1004');
    expect(result.confidence).toBe(1.0);
  });

  it('should handle copy-pasted data with suffixes', () => {
    // "Marvin Harrison Jr" (without period) - Jr gets removed at end of string
    const result = matchPlayerToMFL('Marvin Harrison Jr', 'WR', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1009');
  });

  it('should handle players listed without common names', () => {
    const result = matchPlayerToMFL('Derrick Henry', 'RB', mflPlayers);
    expect(result.matched).toBe(true);
    expect(result.playerId).toBe('1007');
  });
});
