#!/usr/bin/env node
/**
 * Parse the consensus rookie rankings text dump into structured JSON.
 *
 * Input format (one player spans 2 lines):
 *   1\tJeremiyah Love ARI
 *   RB1\t20\tR\t-
 *
 * Tier headers are bare lines: "Tier 1", "Tier 2", ..., "Free Agents".
 *
 * Usage:
 *   node scripts/scouting/parse-consensus-rankings.mjs \
 *     data/fantasy-expert/sources/consensus/2026-post-draft.txt \
 *     data/fantasy-expert/sources/consensus/2026-post-draft.json
 */
import fs from 'node:fs';

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('Usage: parse-consensus-rankings.mjs <in.txt> <out.json>');
  process.exit(1);
}

const text = fs.readFileSync(inFile, 'utf8');
const lines = text.split('\n');

const tierLineRe = /^(Tier \d+|Free Agents)$/;
// First line of a player: "1\tJeremiyah Love ARI" — rank \t name + team-code (last whitespace-separated token)
// "Trebor Peña JAX" → name "Trebor Peña", team "JAX"
const rankNameRe = /^(\d+)\s+(.+)$/;
// Second line: "RB1\t20\tR\t-" — pos+rank, age, exp, bye
const posLineRe = /^([A-Z]+)(\d+)(?:\s+(.+?))?$/;

const players = [];
let currentTier = null;
let pending = null; // accumulates rank+name from line 1 until line 2 fills in pos info

for (let raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith('Rank\t') || line === 'Rank Player Pos Age Exp Bye') continue;

  const tierMatch = tierLineRe.exec(line);
  if (tierMatch) {
    currentTier = tierMatch[1];
    continue;
  }

  if (!pending) {
    const m = rankNameRe.exec(line);
    if (m) {
      // Split name/team — trailing token is team (uppercase letters/digits, 2-4 chars typically; allow LV1, LAR1 quirks)
      const tokens = m[2].trim().split(/\s+/);
      const teamTok = tokens[tokens.length - 1];
      const isTeamCode = /^[A-Z]{2,4}\d?$/.test(teamTok);
      const nflTeam = isTeamCode ? teamTok : '';
      const name = isTeamCode ? tokens.slice(0, -1).join(' ') : tokens.join(' ');
      pending = {
        rank: parseInt(m[1], 10),
        name,
        nflTeam,
        tier: currentTier,
      };
    }
    continue;
  }

  // Second line for the pending player — pos rank + age + exp + bye, tab-delimited
  const fields = line.split(/\s+/);
  const posTok = fields[0]; // e.g. "RB1", "WR23"
  const posMatch = /^([A-Z]+)(\d+)$/.exec(posTok);
  if (!posMatch) {
    console.warn(`Skipping unparseable pos line: ${line}`);
    pending = null;
    continue;
  }
  const position = posMatch[1] === 'PK' ? 'K' : posMatch[1];
  const positionRank = parseInt(posMatch[2], 10);
  const age = fields[1] && fields[1] !== '-' ? parseInt(fields[1], 10) : null;
  const exp = fields[2] || '';

  players.push({
    rank: pending.rank,
    name: pending.name,
    nflTeam: pending.nflTeam,
    position,
    positionRank,
    tier: pending.tier,
    age: Number.isFinite(age) ? age : null,
    rookie: exp === 'R',
  });
  pending = null;
}

// Group by position for quick lookup
const byPosition = {};
for (const p of players) {
  (byPosition[p.position] ??= []).push(p);
}

const out = {
  source: 'consensus',
  version: '2026-post-draft',
  description: 'Consensus rookie rankings — post-NFL-draft, tiered, with NFL team assignments',
  fetchedAt: new Date().toISOString(),
  totalPlayers: players.length,
  tiers: [...new Set(players.map(p => p.tier).filter(Boolean))],
  players,
  byPosition,
};

fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`Parsed ${players.length} players into ${outFile}`);
console.log(`Tiers: ${out.tiers.join(', ')}`);
console.log(`Position counts: ${Object.entries(byPosition).map(([p, l]) => `${p}:${l.length}`).join(', ')}`);
