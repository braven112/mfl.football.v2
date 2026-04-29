#!/usr/bin/env node
/**
 * Finalize a rookie-draft report from per-franchise brief JSON files written
 * to disk by agents (Plan B path — when ANTHROPIC_API_KEY isn't set and the
 * briefs were produced by Claude Code agent invocations rather than the
 * direct API generator).
 *
 * Reads:  data/.../reports/<year>-rookie-draft/_briefs/<franchiseId>.json
 * Writes: data/.../reports/<year>-rookie-draft/predictions.json + meta.json
 * Appends to: data/.../predictions-ledger.json
 *
 * Usage:
 *   node scripts/scouting/finalize-from-briefs.mjs 2026
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRookieDraftInputs } from './lib/load-inputs.mjs';
import { assembleMock } from './lib/assemble-mock.mjs';
import { appendPredictions, predictionsFromReport } from './lib/ledger.mjs';

const REPO_ROOT = process.cwd();
const REPORTS_DIR = path.join(REPO_ROOT, 'data', 'fantasy-expert', 'scouting-system', 'reports');
const EVENT_TYPE = 'rookie-draft';
const ROUNDS_TO_PREDICT = 3;

const year = parseInt(process.argv[2], 10);
if (!year) {
  console.error('Usage: node scripts/scouting/finalize-from-briefs.mjs <year>');
  process.exit(1);
}

const reportDir = path.join(REPORTS_DIR, `${year}-${EVENT_TYPE}`);
const briefsDir = path.join(reportDir, '_briefs');

if (!fs.existsSync(briefsDir)) {
  console.error(`Briefs directory not found: ${path.relative(REPO_ROOT, briefsDir)}`);
  console.error('Run dump-prompts.mjs and the per-franchise agents first.');
  process.exit(1);
}

const inputs = loadRookieDraftInputs(year);
const teamById = new Map(inputs.franchises.map(f => [f.franchiseId, f]));

// Load all briefs
const briefFiles = fs.readdirSync(briefsDir).filter(f => f.endsWith('.json'));
console.log(`Loading ${briefFiles.length} briefs from ${path.relative(REPO_ROOT, briefsDir)}/`);

const briefs = [];
const skipped = [];

for (const file of briefFiles) {
  const fid = path.basename(file, '.json');
  const team = teamById.get(fid);
  if (!team) {
    console.warn(`  ⚠️  ${file}: unknown franchise id, skipping`);
    skipped.push(fid);
    continue;
  }

  let parsed;
  try {
    const raw = fs.readFileSync(path.join(briefsDir, file), 'utf8');
    // Strip leading/trailing markdown fences if present
    const cleaned = raw
      .replace(/^```(json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn(`  ⚠️  ${file}: JSON parse failed (${err.message}), skipping`);
    skipped.push(fid);
    continue;
  }

  if (!parsed.topTargets || !Array.isArray(parsed.topTargets) || parsed.topTargets.length === 0) {
    console.warn(`  ⚠️  ${file}: missing topTargets, skipping`);
    skipped.push(fid);
    continue;
  }

  briefs.push({
    franchiseId: fid,
    franchiseName: team.name,
    topTargets: parsed.topTargets,
    positionalPriority: parsed.positionalPriority || [],
    capPosture: parsed.capPosture || '',
    taxiCandidates: parsed.taxiCandidates || [],
    wildcard: parsed.wildcard,
    summary: parsed.summary || '',
  });
}

console.log(`  ✓ ${briefs.length} briefs loaded${skipped.length > 0 ? ` (skipped: ${skipped.join(', ')})` : ''}\n`);

// Assemble mock
console.log('Assembling 3-round mock...');
const targetPicks = inputs.pickOwnership.filter(p => p.round <= ROUNDS_TO_PREDICT);
const mock = assembleMock({
  briefs,
  pickOwnership: targetPicks,
  rspBoard: inputs.rspBoard,
  rookieAdp: inputs.rookieAdp,
  teamById,
});
console.log(`  ✓ ${mock.length} mock picks\n`);

// Market notes
const marketNotes = [];
const desireByName = new Map();
for (const b of briefs) {
  for (const t of b.topTargets) {
    const key = (t.name || '').toLowerCase();
    if (!key) continue;
    const cur = desireByName.get(key) ?? { name: t.name, position: t.position, count: 0, totalDesire: 0 };
    cur.count++;
    cur.totalDesire += t.desire || 0;
    desireByName.set(key, cur);
  }
}
const contested = Array.from(desireByName.values())
  .filter(p => p.count >= 3)
  .sort((a, b) => b.totalDesire - a.totalDesire)
  .slice(0, 4);

for (const c of contested) {
  marketNotes.push(`Heavily contested: ${c.name} (${c.position}) is a top-target for ${c.count} different franchises.`);
}

const capStrappedCount = briefs.filter(b => /cap.{0,8}strapped|tight cap|no cap room|forced.{0,8}taxi/i.test(b.capPosture || '')).length;
if (capStrappedCount > 4) {
  marketNotes.push(`${capStrappedCount} franchises are cap-constrained — expect heavy taxi-stash usage and/or rookie pick trades.`);
}

// Write outputs
const report = {
  eventType: EVENT_TYPE,
  year,
  briefs,
  mock,
  marketNotes,
};
const meta = {
  eventType: EVENT_TYPE,
  year,
  generatedAt: new Date().toISOString(),
  generator: 'scripts/scouting/finalize-from-briefs.mjs (Plan B agent path)',
  modelUsed: 'claude-opus-4-7 (via franchise-gm-simulator agent)',
  agentCallCount: briefs.length,
  durationMs: 0,
};

fs.writeFileSync(path.join(reportDir, 'predictions.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(reportDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

const newPredictions = predictionsFromReport(report);
const totalPredictions = appendPredictions(newPredictions);

console.log(`✅ Done
   ${briefs.length} GM briefs
   ${mock.length} mock picks
   ${marketNotes.length} market notes
   ${newPredictions.length} predictions appended to ledger (total: ${totalPredictions})

   Report: ${path.relative(REPO_ROOT, path.join(reportDir, 'predictions.json'))}
   View:   /admin/scouting/${year}-rookie-draft
`);
