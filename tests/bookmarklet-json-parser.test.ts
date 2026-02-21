/**
 * Unit Tests for Bookmarklet JSON Parser
 * Tests parsing, validation, and normalization of bookmarklet output JSON
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseBookmarkletJson } from '../src/utils/bookmarklet-json-parser';
import type { BookmarkletOutput, BookmarkletPlayer } from '../src/types/rankings-import';

describe('parseBookmarkletJson', () => {
  // ============================================================================
  // SUCCESS CASES
  // ============================================================================

  describe('success cases', () => {
    it('should parse valid JSON with all fields (fantasypros dynasty)', () => {
      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { rank: 1, name: 'Patrick Mahomes', pos: 'QB', team: 'KC', tier: 1 },
          { rank: 2, name: 'Travis Kelce', pos: 'TE', team: 'KC', tier: 1 },
        ],
        metadata: { pageUrl: 'https://www.fantasypros.com/rankings/', totalPages: 5, currentPage: 1 },
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.source).toBe('fantasypros');
      expect(result.data?.type).toBe('dynasty');
      expect(result.data?.exportedAt).toBe('2024-01-15T10:30:00Z');
      expect(result.data?.players).toHaveLength(2);
      expect(result.data?.metadata).toEqual({
        pageUrl: 'https://www.fantasypros.com/rankings/',
        totalPages: 5,
        currentPage: 1,
      });
    });

    it('should parse valid JSON with different source/type combinations', () => {
      const combos: Array<[string, string]> = [
        ['cbs', 'redraft'],
        ['sleeper', 'adp'],
        ['keeptradecut', 'overall'],
        ['dlf', 'dynasty'],
        ['yahoo', 'redraft'],
        ['footballguys', 'overall'],
      ];

      combos.forEach(([source, type]) => {
        const input = JSON.stringify({
          source,
          type,
          exportedAt: '2024-01-15T10:30:00Z',
          players: [{ name: 'Player Name', pos: 'QB' }],
        });

        const result = parseBookmarkletJson(input);

        expect(result.success).toBe(true);
        expect(result.data?.source).toBe(source);
        expect(result.data?.type).toBe(type);
      });
    });

    it('should auto-assign rank from array index when rank not present', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Player One', pos: 'QB' },
          { name: 'Player Two', pos: 'RB' },
          { name: 'Player Three', pos: 'WR' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].rank).toBe(1);
      expect(result.data?.players[1].rank).toBe(2);
      expect(result.data?.players[2].rank).toBe(3);
    });

    it('should handle bare array shorthand (custom source, overall type)', () => {
      const input = JSON.stringify([
        { name: 'Mahomes', pos: 'QB' },
        { name: 'Henry', pos: 'RB' },
        { name: 'Hill', pos: 'WR' },
      ]);

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.source).toBe('custom');
      expect(result.data?.type).toBe('overall');
      expect(result.data?.players).toHaveLength(3);
      // Should have generated exportedAt
      expect(result.data?.exportedAt).toBeDefined();
    });

    it('should normalize K position to PK', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Justin Tucker', pos: 'K', team: 'bal' }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].pos).toBe('PK');
    });

    it('should normalize DST position to DEF', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Kansas City', pos: 'DST', team: 'KC' }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].pos).toBe('DEF');
    });

    it('should normalize WR1 position to WR (DLF-style)', () => {
      const input = JSON.stringify({
        source: 'dlf',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Justin Jefferson', pos: 'WR1' },
          { name: 'DeAndre Washington', pos: 'RB2' },
          { name: 'Jalen Hurts', pos: 'QB1' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].pos).toBe('WR');
      expect(result.data?.players[1].pos).toBe('RB');
      expect(result.data?.players[2].pos).toBe('QB');
    });

    it('should accept playerName as name field alias', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ playerName: 'Josh Allen', pos: 'QB' }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].name).toBe('Josh Allen');
    });

    it('should accept player as name field alias', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ player: 'Lamar Jackson', pos: 'QB' }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].name).toBe('Lamar Jackson');
    });

    it('should normalize team to uppercase', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Patrick Mahomes', pos: 'QB', team: 'kc' },
          { name: 'Travis Kelce', pos: 'TE', team: 'KC' },
          { name: 'Tyreek Hill', pos: 'WR', team: 'mia' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].team).toBe('KC');
      expect(result.data?.players[1].team).toBe('KC');
      expect(result.data?.players[2].team).toBe('MIA');
    });

    it('should preserve metadata when present', () => {
      const metadata = {
        pageUrl: 'https://example.com/rankings',
        totalPages: 10,
        currentPage: 2,
      };

      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Player', pos: 'QB' }],
        metadata,
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.metadata).toEqual(metadata);
    });

    it('should preserve tier numbers', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Mahomes', pos: 'QB', tier: 1 },
          { name: 'Josh Allen', pos: 'QB', tier: 1 },
          { name: 'Lamar Jackson', pos: 'QB', tier: 2 },
          { name: 'Jalen Hurts', pos: 'QB' }, // no tier
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].tier).toBe(1);
      expect(result.data?.players[1].tier).toBe(1);
      expect(result.data?.players[2].tier).toBe(2);
      expect(result.data?.players[3].tier).toBeUndefined();
    });

    it('should trim whitespace from player names and teams', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: '  Patrick Mahomes  ', pos: 'QB', team: '  KC  ' },
          { name: 'Travis Kelce', pos: 'TE', team: ' KC' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].name).toBe('Patrick Mahomes');
      expect(result.data?.players[0].team).toBe('KC');
      expect(result.data?.players[1].team).toBe('KC');
    });

    it('should generate exportedAt timestamp when not provided', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        players: [{ name: 'Player', pos: 'QB' }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.exportedAt).toBeDefined();
      // Should be a valid ISO 8601 timestamp
      expect(() => new Date(result.data?.exportedAt!)).not.toThrow();
    });
  });

  // ============================================================================
  // ERROR CASES
  // ============================================================================

  describe('error cases', () => {
    it('should reject empty string', () => {
      const result = parseBookmarkletJson('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No data to import/);
      expect(result.data).toBeUndefined();
    });

    it('should reject whitespace-only string', () => {
      const result = parseBookmarkletJson('   \n\t  ');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No data to import/);
      expect(result.data).toBeUndefined();
    });

    it('should reject invalid JSON', () => {
      const result = parseBookmarkletJson('{this is not valid json}');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid JSON/);
      expect(result.data).toBeUndefined();
    });

    it('should reject non-object/non-array JSON types', () => {
      const inputs = [
        JSON.stringify('just a string'),
        JSON.stringify(123),
        JSON.stringify(true),
        JSON.stringify(null),
      ];

      inputs.forEach((input) => {
        const result = parseBookmarkletJson(input);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Expected a JSON object/);
        expect(result.data).toBeUndefined();
      });
    });

    it('should reject object with empty players array', () => {
      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No players found/);
      expect(result.data).toBeUndefined();
    });

    it('should reject object with no players key', () => {
      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No players found/);
      expect(result.data).toBeUndefined();
    });

    it('should reject object with non-array players', () => {
      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: { someKey: 'not an array' },
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No players found/);
      expect(result.data).toBeUndefined();
    });

    it('should reject when all players filtered out due to missing name', () => {
      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { pos: 'QB' },
          { pos: 'RB' },
          { pos: 'WR' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Could not parse any player entries/);
      expect(result.data).toBeUndefined();
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should fallback unknown source to custom', () => {
      const input = JSON.stringify({
        source: 'unknownbookmarklet',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Player', pos: 'QB' }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.source).toBe('custom');
    });

    it('should fallback unknown type to overall', () => {
      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'unknowntype',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Player', pos: 'QB' }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('overall');
    });

    it('should fallback both unknown source and type', () => {
      const input = JSON.stringify({
        source: 'unknownsource',
        type: 'unknowntype',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Player', pos: 'QB' }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.source).toBe('custom');
      expect(result.data?.type).toBe('overall');
    });

    it('should filter out players with missing name', () => {
      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'dynasty',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Valid Player', pos: 'QB' },
          { pos: 'RB' }, // no name - should be filtered
          { name: '', pos: 'WR' }, // empty name - should be filtered
          { name: 'Another Valid', pos: 'TE' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players).toHaveLength(2);
      expect(result.data?.players[0].name).toBe('Valid Player');
      expect(result.data?.players[1].name).toBe('Another Valid');
    });

    it('should filter out players with falsy values', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Valid', pos: 'QB' },
          null,
          undefined,
          { name: 'Another Valid', pos: 'RB' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players).toHaveLength(2);
      expect(result.data?.players[0].name).toBe('Valid');
      expect(result.data?.players[1].name).toBe('Another Valid');
    });

    it('should handle position normalized to empty string', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Player with no pos', pos: '' },
          { name: 'Player with invalid pos', pos: 'INVALID' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      // Both should be parsed, with empty/invalid pos preserved as-is
      expect(result.data?.players[0].pos).toBe('');
      expect(result.data?.players[1].pos).toBe('INVALID');
    });

    it('should trim leading/trailing whitespace from input', () => {
      const input = `

        ${JSON.stringify({
          source: 'custom',
          type: 'overall',
          exportedAt: '2024-01-15T10:30:00Z',
          players: [{ name: 'Player', pos: 'QB' }],
        })}

      `;

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players).toHaveLength(1);
    });

    it('should accept rank 0 explicitly set', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { rank: 0, name: 'Player', pos: 'QB' },
          { name: 'Another', pos: 'RB' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].rank).toBe(0);
      expect(result.data?.players[1].rank).toBe(2);
    });

    it('should accept tier 0 (falsy but valid)', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Player', pos: 'QB', tier: 0 }],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].tier).toBe(0);
    });

    it('should handle mixed name field aliases', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Using name field', pos: 'QB' },
          { playerName: 'Using playerName field', pos: 'RB' },
          { player: 'Using player field', pos: 'WR' },
          { name: 'name', playerName: 'playerName', player: 'player', pos: 'TE' }, // name takes precedence
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].name).toBe('Using name field');
      expect(result.data?.players[1].name).toBe('Using playerName field');
      expect(result.data?.players[2].name).toBe('Using player field');
      expect(result.data?.players[3].name).toBe('name'); // name is first in the check
    });

    it('should handle empty metadata object', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Player', pos: 'QB' }],
        metadata: {},
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.metadata).toEqual({});
    });

    it('should handle metadata with partial fields', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [{ name: 'Player', pos: 'QB' }],
        metadata: { totalPages: 5 },
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.metadata).toEqual({ totalPages: 5 });
    });

    it('should handle case-insensitive position normalization', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'Player1', pos: 'qb' },
          { name: 'Player2', pos: 'Qb' },
          { name: 'Player3', pos: 'QB' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players[0].pos).toBe('QB');
      expect(result.data?.players[1].pos).toBe('QB');
      expect(result.data?.players[2].pos).toBe('QB');
    });

    it('should preserve player order after filtering', () => {
      const input = JSON.stringify({
        source: 'custom',
        type: 'overall',
        exportedAt: '2024-01-15T10:30:00Z',
        players: [
          { name: 'First', pos: 'QB' },
          { pos: 'RB' }, // filtered out
          { name: 'Second', pos: 'WR' },
          { name: 'Third', pos: 'TE' },
        ],
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.players.map((p) => p.name)).toEqual(['First', 'Second', 'Third']);
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('integration tests', () => {
    it('should handle a complete real-world-like payload', () => {
      const input = JSON.stringify({
        source: 'fantasypros',
        type: 'dynasty',
        exportedAt: '2024-01-15T14:23:45.123Z',
        players: [
          {
            rank: 1,
            name: 'Patrick Mahomes',
            pos: 'QB',
            team: 'KC',
            tier: 1,
          },
          {
            rank: 2,
            name: 'Josh Allen',
            pos: 'QB',
            team: 'BUF',
            tier: 1,
          },
          {
            rank: 3,
            name: 'Justin Jefferson',
            pos: 'WR1', // DLF-style
            team: 'min',
            tier: 1,
          },
          {
            rank: 4,
            name: 'Travis Kelce',
            pos: 'TE',
            team: 'KC',
            tier: 2,
          },
          {
            rank: 5,
            playerName: 'Derrick Henry', // alias
            pos: 'RB',
            team: 'tenn',
          },
        ],
        metadata: {
          pageUrl: 'https://www.fantasypros.com/nfl/rankings/dynasty-qb.php',
          totalPages: 1,
          currentPage: 1,
        },
      });

      const result = parseBookmarkletJson(input);

      expect(result.success).toBe(true);
      expect(result.data?.source).toBe('fantasypros');
      expect(result.data?.type).toBe('dynasty');
      expect(result.data?.exportedAt).toBe('2024-01-15T14:23:45.123Z');
      expect(result.data?.players).toHaveLength(5);

      // Verify first player
      expect(result.data?.players[0]).toEqual({
        rank: 1,
        name: 'Patrick Mahomes',
        pos: 'QB',
        team: 'KC',
        tier: 1,
      });

      // Verify position normalization
      expect(result.data?.players[2].pos).toBe('WR');

      // Verify team normalization
      expect(result.data?.players[2].team).toBe('MIN');

      // Verify alias handling
      expect(result.data?.players[4].name).toBe('Derrick Henry');

      // Verify metadata preserved
      expect(result.data?.metadata?.pageUrl).toBe('https://www.fantasypros.com/nfl/rankings/dynasty-qb.php');
    });

    it('should handle bare array with subsequent re-parsing', () => {
      const firstInput = JSON.stringify([
        { name: 'Player One', pos: 'QB' },
        { name: 'Player Two', pos: 'RB' },
      ]);

      const result1 = parseBookmarkletJson(firstInput);

      expect(result1.success).toBe(true);
      expect(result1.data?.source).toBe('custom');
      expect(result1.data?.type).toBe('overall');

      // Now stringify and re-parse (simulating copy/paste)
      const secondInput = JSON.stringify({
        source: result1.data?.source,
        type: result1.data?.type,
        exportedAt: result1.data?.exportedAt,
        players: result1.data?.players,
      });

      const result2 = parseBookmarkletJson(secondInput);

      expect(result2.success).toBe(true);
      expect(result2.data?.source).toBe('custom');
      expect(result2.data?.type).toBe('overall');
      expect(result2.data?.players).toHaveLength(2);
    });
  });
});
