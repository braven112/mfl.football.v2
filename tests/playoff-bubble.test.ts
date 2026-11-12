import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bubbleSeasons, bubbleFacts, currentOwners } from '../src/utils/league-history/playoff-bubble.mjs';

/**
 * The playoff-bubble storyline for Schefter's weekly preview (commissioner,
 * Nov 2026): a team that missed the playoffs by one spot, facing the team that
 * took it. A preview fact, never a scheduling rule.
 */
const team = (rk: number, r: string, d: string, h: string) => ({ n: h, rk, r, d, h, w: 0, l: 0 });
const ds = {
  seasons: [
    { y: 2026, done: 0, teams: { A: team(1, 'M', 'N', 'oA'), B: team(2, 'M', 'N', 'oB'), C: team(3, 'M', 'S', 'oC'), D: team(4, 'M', 'S', 'oD') } },
    { y: 2025, done: 1, teams: { B: team(1, 'C', 'N', 'oB'), A: team(2, 'M', 'N', 'oA'), C: team(3, 'P', 'S', 'oC'), D: team(4, 'M', 'S', 'oD') } },
    { y: 2024, done: 1, teams: { B: team(1, 'P', 'N', 'oB'), A: team(2, 'M', 'N', 'oA'), C: team(3, 'P', 'S', 'oC'), D: team(4, 'M', 'S', 'oD') } },
    // A's previous owner missed by a spot too — that is not the current owner's story.
    { y: 2023, done: 1, teams: { B: team(1, 'P', 'N', 'oB'), A: team(2, 'M', 'N', 'old'), C: team(3, 'P', 'S', 'oC'), D: team(4, 'M', 'S', 'oD') } },
  ],
};
const name = (id: string) => `Team ${id}`;

describe('playoff bubble', () => {
  it('seeds per conference and names last in / first out', () => {
    const seasons = bubbleSeasons(ds, { N: 'AL', S: 'NL' });
    const s2025 = seasons.filter((s: any) => s.year === 2025);
    expect(s2025).toEqual([
      expect.objectContaining({ scope: 'AL', lastIn: 'B', firstOut: 'A' }),
      expect.objectContaining({ scope: 'NL', lastIn: 'C', firstOut: 'D' }),
    ]);
    // The unfinished season is never read.
    expect(seasons.some((s: any) => s.year === 2026)).toBe(false);
  });

  it('calls out the team that took the spot, counting only the current owner', () => {
    const facts = bubbleFacts(bubbleSeasons(ds, { N: 'AL', S: 'NL' }), currentOwners(ds), 'A', 'B', name);
    expect(facts[0]).toBe(
      'Playoff bubble: Team A missed the playoffs by one spot in 2024 and 2025; Team B took that last spot every time.',
    );
    expect(facts[1]).toContain('first team out of the playoffs 2 times');
    expect(facts.join(' ')).not.toContain('2023');
  });

  it('says nothing for a pairing with no bubble story', () => {
    expect(bubbleFacts(bubbleSeasons(ds, { N: 'AL', S: 'NL' }), currentOwners(ds), 'B', 'C', name)).toEqual([]);
  });

  it('finds the AFL story the commissioner described, in the real data', () => {
    const real = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/afl-fantasy/derived/league-history.json'), 'utf8'));
    const conf = { North: 'AL', South: 'AL', East: 'NL', West: 'NL' };
    // Drunk Indians (0002) were first out of the AL in 2024 and 2025, and Avenging Amish (0007) took the spot both years.
    const facts = bubbleFacts(bubbleSeasons(real, conf), currentOwners(real), '0002', '0007', name);
    expect(facts[0]).toContain('in 2024 and 2025');
  });
});
