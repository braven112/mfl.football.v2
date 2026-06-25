#!/usr/bin/env node
/**
 * Suggest rookie-draft trade options for a target franchise based on the
 * latest scouting report. Specifically optimizes for:
 *   1. Trade-up partners in R2 (move ahead of contested players)
 *   2. Trade-down partners in R1 (recoup capital from teams hungry for R1)
 *   3. Combined deals (R1 down → R2 up)
 *
 * Reads:
 *   - data/.../reports/<year>-rookie-draft/predictions.json (briefs + mock)
 *   - data/theleague/mfl-feeds/<year>/draftResults.json (pick ownership)
 *
 * Usage:
 *   node scripts/scouting/suggest-trades.mjs 2026 0001
 *   (year + franchiseId of the trade subject)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRookieDraftInputs } from './lib/load-inputs.mjs';

const year = parseInt(process.argv[2], 10);
const subjectId = process.argv[3];
if (!year || !subjectId) {
  console.error('Usage: node scripts/scouting/suggest-trades.mjs <year> <franchiseId>');
  process.exit(1);
}

// ── Load report + inputs ──────────────────────────────────────────────────
const reportPath = path.join('data', 'fantasy-expert', 'scouting-system', 'reports', `${year}-rookie-draft`, 'predictions.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const inputs = loadRookieDraftInputs(year);
const teamById = new Map(inputs.franchises.map(f => [f.franchiseId, f]));
const briefById = new Map(report.briefs.map(b => [b.franchiseId, b]));

const subject = teamById.get(subjectId);
const subjectBrief = briefById.get(subjectId);
if (!subject || !subjectBrief) {
  console.error(`Franchise ${subjectId} not found in report`);
  process.exit(1);
}

// ── Compute pick values inline (mirrors src/utils/draft-pick-value.ts curve) ─
// Salary table from ROOKIE_SALARIES_2026 — weighted skill avg for slot 1 in
// each round. We'll use a simpler proxy: surplus value scales with the
// production multiplier.
function productionMultiplier(overallPick) {
  if (overallPick <= 3) return 2.5;
  if (overallPick <= 6) return 2.3;
  if (overallPick <= 10) return 2.0;
  if (overallPick <= 14) return 1.8;
  if (overallPick <= 17) return 1.6;
  if (overallPick <= 22) return 1.4;
  if (overallPick <= 28) return 1.25;
  if (overallPick <= 35) return 1.15;
  return 1.0;
}

// Approximate baseline salary by round (from cap impact table)
const baselineSalary = { 1: 1_400_000, 2: 700_000, 3: 500_000 };

function pickValue(round, pickInRound) {
  const overall = (round - 1) * 16 + pickInRound;
  const salary = baselineSalary[round] ?? 425_000;
  const mult = productionMultiplier(overall);
  // Annual surplus, then over 3-year rookie deal
  const surplus = salary * (mult - 1);
  return Math.round(surplus * 3 / 100_000) * 100_000;
}

// ── Aggregate pick ownership ──────────────────────────────────────────────
const picksByFranchise = new Map();
for (const p of inputs.pickOwnership) {
  if (p.round > 3) continue;
  const arr = picksByFranchise.get(p.franchiseId) ?? [];
  arr.push(p);
  picksByFranchise.set(p.franchiseId, arr);
}

// Total pick capital per franchise
function totalCapital(franchiseId) {
  const picks = picksByFranchise.get(franchiseId) ?? [];
  return picks.reduce((sum, p) => sum + pickValue(p.round, p.pick), 0);
}

// ── Identify trade-up & trade-down partners ──────────────────────────────
const subjectPicks = picksByFranchise.get(subjectId) ?? [];

// Subject's targets — find what they actually want
const subjectR2Bell = subjectBrief.topTargets.find(t => t.preferredRound === 2);
const subjectTopR1 = subjectBrief.topTargets.filter(t => !t.preferredRound || t.preferredRound === 1);

// Find who took the R2 priority target in the mock (= the trade-up adversary)
let blockedBy = null;
let blockedAt = null;
if (subjectR2Bell) {
  const pickThatTookHim = report.mock.find(p => p.player.name === subjectR2Bell.name && p.franchiseId !== subjectId);
  if (pickThatTookHim) {
    blockedBy = pickThatTookHim.franchiseName;
    blockedAt = `${pickThatTookHim.round}.${String(pickThatTookHim.pickInRound).padStart(2, '0')}`;
  }
}

// ── Build trade-up scenarios ──────────────────────────────────────────────
console.log(`\n═══════════════════════════════════════════════════════════════════════`);
console.log(`  TRADE OPTIONS: ${subject.name} (${subject.abbrev})`);
console.log(`═══════════════════════════════════════════════════════════════════════\n`);

console.log(`Your picks: ${subjectPicks.map(p => `${p.round}.${String(p.pick).padStart(2, '0')}`).join(', ')}`);
console.log(`Your total R1-3 capital: $${(totalCapital(subjectId) / 1_000_000).toFixed(1)}M surplus\n`);

if (subjectR2Bell) {
  console.log(`R2 priority target: ${subjectR2Bell.name} (${subjectR2Bell.position}) — desire ${subjectR2Bell.desire}`);
  if (blockedBy) {
    console.log(`Mock shows: GOES at ${blockedAt} to ${blockedBy} — you'd need to move ahead of pick ${(parseInt(blockedAt.split('.')[0]) - 1) * 16 + parseInt(blockedAt.split('.')[1])}\n`);
  }
}

// ── TRADE UP candidates: teams with picks ahead of where subject's R2 target goes ──
console.log(`\n── TRADE-UP CANDIDATES (R2) ─────────────────────────────────────────\n`);

if (subjectR2Bell && blockedBy) {
  const targetCutoff = blockedAt; // Need to pick by THIS slot or earlier
  const cutoffRound = parseInt(targetCutoff.split('.')[0]);
  const cutoffPick = parseInt(targetCutoff.split('.')[1]);
  const cutoffOverall = (cutoffRound - 1) * 16 + cutoffPick;

  // Find all R2 picks before cutoff
  const trideUpTargets = inputs.pickOwnership.filter(p => {
    if (p.round !== 2) return false;
    if (p.franchiseId === subjectId) return false;
    if (p.franchiseId === Array.from(teamById.entries()).find(([, t]) => t.name === blockedBy)?.[0]) return false;
    const overall = 16 + p.pick;
    return overall < cutoffOverall;
  });

  for (const slot of trideUpTargets) {
    const owner = teamById.get(slot.franchiseId);
    const ownerBrief = briefById.get(slot.franchiseId);
    const ownerPicks = picksByFranchise.get(slot.franchiseId) ?? [];
    const wantsBellToo = ownerBrief?.topTargets.some(t => t.name === subjectR2Bell.name) ||
                        ownerBrief?.wildcard?.name === subjectR2Bell.name;

    // What did they pick at this slot in the mock?
    const mockPick = report.mock.find(m => m.round === slot.round && m.pickInRound === slot.pick);
    const subjectSlot = subjectPicks.find(p => p.round === 2);
    const subjectValue = subjectSlot ? pickValue(subjectSlot.round, subjectSlot.pick) : 0;
    const targetValue = pickValue(slot.round, slot.pick);
    const valueDelta = targetValue - subjectValue;

    console.log(`  ${owner.name} owns ${slot.round}.${String(slot.pick).padStart(2, '0')} (value $${(targetValue/1_000_000).toFixed(2)}M, delta +$${(valueDelta/1_000_000).toFixed(2)}M vs your 2.10)`);
    console.log(`    Total picks: ${ownerPicks.length} (${ownerPicks.map(p => `${p.round}.${String(p.pick).padStart(2, '0')}`).join(', ')})`);
    console.log(`    Mock pick: ${mockPick?.player.name ?? '?'} (${mockPick?.pickType ?? '?'})`);
    if (wantsBellToo) {
      console.log(`    ⚠️  ALSO TARGETS ${subjectR2Bell.name} — won't trade this pick`);
    } else {
      console.log(`    ✓ Doesn't target ${subjectR2Bell.name} — open to a deal`);
    }
    console.log('');
  }
}

// ── TRADE DOWN candidates: teams without R1 or with weak R1 who'd move up ──
console.log(`── TRADE-DOWN CANDIDATES (R1) ───────────────────────────────────────\n`);

const subjectR1 = subjectPicks.find(p => p.round === 1);
if (subjectR1) {
  const subjectR1Value = pickValue(1, subjectR1.pick);
  console.log(`Your R1 pick: 1.${String(subjectR1.pick).padStart(2, '0')} (value $${(subjectR1Value/1_000_000).toFixed(2)}M)\n`);

  // Candidates: teams without R1, or with R1 later than subject's R1
  for (const [fid, team] of teamById) {
    if (fid === subjectId) continue;
    const picks = picksByFranchise.get(fid) ?? [];
    const theirR1 = picks.find(p => p.round === 1);
    const noR1 = !theirR1;
    const laterR1 = theirR1 && theirR1.pick > subjectR1.pick;
    if (!noR1 && !laterR1) continue;

    const brief = briefById.get(fid);
    const r1Targets = brief?.topTargets.filter(t => !t.preferredRound || t.preferredRound === 1) ?? [];
    const wouldUseAtSubjectSlot = r1Targets.some(t => {
      // Did the mock show their target getting picked by subject's slot?
      const mockPick = report.mock.find(m => m.player.name === t.name);
      return mockPick && mockPick.overallPick > subjectR1.pick;
    });

    const totalPicks = picks.length;
    console.log(`  ${team.name}${noR1 ? ' [NO R1]' : ` [R1 at 1.${String(theirR1.pick).padStart(2, '0')}]`}`);
    console.log(`    Picks: ${picks.map(p => `${p.round}.${String(p.pick).padStart(2, '0')}`).join(', ')} (${totalPicks} total)`);
    if (brief?.summary) {
      console.log(`    Brief excerpt: ${brief.summary.slice(0, 160)}...`);
    }
    if (wouldUseAtSubjectSlot) {
      console.log(`    🎯 Has R1 targets that could still be available at 1.${String(subjectR1.pick).padStart(2, '0')} — likely interested`);
    }
    console.log('');
  }
}

// ── Combined deal scaffolding ─────────────────────────────────────────────
console.log(`\n── COMBINED DEAL SCAFFOLDING ────────────────────────────────────────\n`);
console.log(`Goal: trade DOWN in R1 to recoup capital, then trade UP in R2 to get ${subjectR2Bell?.name ?? 'your R2 target'}.`);
console.log(`Net effect: same R2 target locked in, with a small R1 downgrade and possibly a future pick gained.\n`);
