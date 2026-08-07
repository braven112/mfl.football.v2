#!/usr/bin/env node
/**
 * Show top remaining rookies based on RSP and ADP, excluding a list of
 * already-picked names provided via stdin or arguments.
 *
 * Usage:
 *   node scripts/scouting/top-remaining.mjs --picked "Antonio Williams,Carnell Tate,..."
 *   echo "Antonio Williams,Carnell Tate" | node scripts/scouting/top-remaining.mjs
 *   node scripts/scouting/top-remaining.mjs            # nothing picked yet
 */
import fs from 'node:fs';
import { loadRookieDraftInputs } from './lib/load-inputs.mjs';

let pickedRaw = '';
const argIdx = process.argv.indexOf('--picked');
if (argIdx >= 0) pickedRaw = process.argv[argIdx + 1] ?? '';
else if (!process.stdin.isTTY) pickedRaw = fs.readFileSync(0, 'utf8');

const pickedNames = new Set(
  pickedRaw
    .split(/[,\n]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

const inputs = loadRookieDraftInputs(2026);

function norm(s) { return (s || '').trim().toLowerCase(); }

// Rank players by each board, excluding picked names
const rspSorted = [...inputs.rspBoard]
  .sort((a, b) => (b.preDraftScore || 0) - (a.preDraftScore || 0))
  .filter(p => !pickedNames.has(norm(p.name)))
  .slice(0, 25);

const adpSorted = [...inputs.rookieAdp]
  .sort((a, b) => a.rank - b.rank)
  .filter(p => !pickedNames.has(norm(p.name)))
  .slice(0, 25);

const consensusSorted = [...inputs.consensusBoard]
  .sort((a, b) => a.rank - b.rank)
  .filter(p => !pickedNames.has(norm(p.name)))
  .slice(0, 25);

console.log(`\n═══ TOP REMAINING — ${pickedNames.size} picked, excluded ═══\n`);

console.log(`▶ CONSENSUS (post-NFL-draft, tiered):`);
for (const p of consensusSorted.slice(0, 15)) {
  console.log(`  ${String(p.rank).padStart(2)}. ${p.name.padEnd(25)} ${p.position}${p.positionRank} (${p.nflTeam || 'FA'})  ${p.tier}`);
}

console.log(`\n▶ RSP TOP 15 (Waldman DoT score):`);
for (const p of rspSorted.slice(0, 15)) {
  console.log(`  ${String(rspSorted.indexOf(p) + 1).padStart(2)}. ${p.name.padEnd(25)} ${p.position} (${p.school || '?'})  DoT ${p.preDraftScore?.toFixed?.(1) ?? '?'} · ${p.preDraftGrade}`);
}

console.log(`\n▶ MFL DYNASTY ADP TOP 15 (rookies only):`);
for (const p of adpSorted.slice(0, 15)) {
  console.log(`  ${String(p.rank).padStart(2)}. ${p.name.padEnd(25)} ${p.position}  ADP ${p.averagePick?.toFixed(2) ?? '?'}`);
}

// Cross-board "best available" — players in top 15 on at least 2 boards
console.log(`\n▶ CROSS-BOARD CONSENSUS (top 15 on ≥2 boards — strongest remaining):`);
const top15Consensus = new Set(consensusSorted.slice(0, 15).map(p => norm(p.name)));
const top15Rsp = new Set(rspSorted.slice(0, 15).map(p => norm(p.name)));
const top15Adp = new Set(adpSorted.slice(0, 15).map(p => norm(p.name)));

const allNames = new Set([...top15Consensus, ...top15Rsp, ...top15Adp]);
const crossBoard = [];
for (const name of allNames) {
  const count = [top15Consensus, top15Rsp, top15Adp].filter(s => s.has(name)).length;
  if (count < 2) continue;
  const c = consensusSorted.find(p => norm(p.name) === name);
  const r = rspSorted.find(p => norm(p.name) === name);
  const a = adpSorted.find(p => norm(p.name) === name);
  const proper = c?.name || r?.name || a?.name;
  crossBoard.push({
    name: proper,
    position: c?.position || r?.position || a?.position,
    consensusRank: c?.rank,
    rspIdx: r ? rspSorted.indexOf(r) + 1 : null,
    adpRank: a?.rank,
    boardCount: count,
  });
}
crossBoard.sort((a, b) => {
  if (a.boardCount !== b.boardCount) return b.boardCount - a.boardCount;
  const aSum = (a.consensusRank ?? 99) + (a.rspIdx ?? 99) + (a.adpRank ?? 99);
  const bSum = (b.consensusRank ?? 99) + (b.rspIdx ?? 99) + (b.adpRank ?? 99);
  return aSum - bSum;
});
for (const p of crossBoard.slice(0, 12)) {
  const tags = [];
  if (p.consensusRank) tags.push(`C:${p.consensusRank}`);
  if (p.rspIdx) tags.push(`R:${p.rspIdx}`);
  if (p.adpRank) tags.push(`A:${p.adpRank}`);
  console.log(`  ${p.name.padEnd(25)} ${p.position.padEnd(3)}  ${tags.join(' / ').padEnd(20)}  [${p.boardCount}/3 boards]`);
}
console.log('');
