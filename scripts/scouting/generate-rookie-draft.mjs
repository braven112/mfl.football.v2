#!/usr/bin/env node
/**
 * Rookie-draft scouting report generator.
 *
 * Usage:
 *   pnpm scout:rookie-draft 2026
 *   ANTHROPIC_API_KEY=... node scripts/scouting/generate-rookie-draft.mjs 2026
 *
 * What it does:
 *   1. Loads MFL feeds (rosters, picks, league, ADP), RSP/FBG boards, RSP affinity
 *   2. For each of the 16 franchises:
 *      - Builds/refreshes the dossier (data/.../franchises/<id>-<slug>.json)
 *      - Calls Anthropic Opus role-playing that GM
 *      - Parses the GM brief JSON
 *   3. Assembles a 3-round mock from the briefs (with conflict resolution)
 *   4. Writes:
 *      - reports/<year>-rookie-draft/predictions.json (full report)
 *      - reports/<year>-rookie-draft/meta.json (generation metadata)
 *      - franchises/<id>-<slug>.json (refreshed dossiers)
 *   5. Appends every prediction to predictions-ledger.json
 *
 * Cost: ~16 Opus calls × ~5K tokens ≈ $0.50-$1.00 per regen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { callAnthropicJSON, SCOUTING_MODEL } from './lib/anthropic-client.mjs';
import { loadRookieDraftInputs, summarizeFranchiseRoster } from './lib/load-inputs.mjs';
import { loadDossier, seedDossier, refreshDossierSnapshot, writeDossier, franchiseSlug } from './lib/dossier.mjs';
import { assembleMock } from './lib/assemble-mock.mjs';
import { appendPredictions, predictionsFromReport } from './lib/ledger.mjs';

const REPO_ROOT = process.cwd();
const REPORTS_DIR = path.join(REPO_ROOT, 'data', 'fantasy-expert', 'scouting-system', 'reports');
const EVENT_TYPE = 'rookie-draft';
const ROUNDS_TO_PREDICT = 3;

// ── CLI args ────────────────────────────────────────────────────────────────
const year = parseInt(process.argv[2], 10);
if (!year || year < 2024 || year > 2030) {
  console.error('Usage: node scripts/scouting/generate-rookie-draft.mjs <year>');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY environment variable required');
  process.exit(1);
}

// Optional: limit to a subset of franchises for testing
const ONLY_FRANCHISES = (process.env.SCOUT_ONLY || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

console.log(`\n🏈 Generating ${year} rookie-draft scouting report (model: ${SCOUTING_MODEL})\n`);

const startTime = Date.now();
const inputs = loadRookieDraftInputs(year);

// ── Pre-build shared context strings ────────────────────────────────────────
function topRspText(n = 30) {
  const sorted = [...inputs.rspBoard].sort((a, b) => (b.preDraftScore || 0) - (a.preDraftScore || 0));
  return sorted.slice(0, n).map((p, i) =>
    `${i + 1}. ${p.name} (${p.position}, ${p.school || '?'}) — DoT ${p.preDraftScore?.toFixed?.(1) ?? '?'}, grade ${p.preDraftGrade || '?'}${p.notes ? ` · ${String(p.notes).slice(0, 120)}` : ''}`
  ).join('\n');
}

function topAdpText(n = 30) {
  return inputs.rookieAdp.slice(0, n).map(a =>
    `${a.rank}. ${a.name} (${a.position}) — ADP ${a.averagePick?.toFixed(2) ?? '?'}`
  ).join('\n');
}

function pickOwnershipText() {
  const targetRounds = inputs.pickOwnership.filter(p => p.round <= ROUNDS_TO_PREDICT);
  const byFranchise = new Map();
  for (const p of targetRounds) {
    const arr = byFranchise.get(p.franchiseId) ?? [];
    arr.push(`${p.round}.${String(p.pick).padStart(2, '0')}`);
    byFranchise.set(p.franchiseId, arr);
  }
  const lines = [];
  for (const [fid, picks] of byFranchise) {
    const team = inputs.franchises.find(f => f.franchiseId === fid);
    lines.push(`${team?.name || fid}: ${picks.join(', ')}`);
  }
  return lines.join('\n');
}

const rspBoardText = topRspText(30);
const adpBoardText = topAdpText(30);
const allPicksText = pickOwnershipText();

// ── System prompt (cache-eligible) ──────────────────────────────────────────
const SYSTEM_PROMPT = `You are a franchise GM simulator for TheLeague (MFL 13522), a 16-team dynasty salary cap fantasy football league.

LEAGUE RULES (relevant for rookie draft):
- $45M hard salary cap (cannot exceed)
- 22 active roster + 3 taxi squad (rookies only) + unlimited IR
- Taxi squad cap hit: 50% of base salary in current year, full salary in projections
- Contracts 1-5 years, 10% annual escalation
- Active roster minimum 20 players Week 1-17

You will be given one franchise to role-play. Reason as their GM would, using their roster, cap posture, RSP affinity, and any behavioral notes. Do NOT recommend the optimal pick — predict what THIS GM would actually do.

OUTPUT CONTRACT — respond with valid JSON only, no markdown fences, matching this schema:
{
  "topTargets": [
    { "name": "Full Name", "position": "QB|RB|WR|TE", "reasoning": "1-2 sentences citing specific data (RSP rank, position need, cap fit)", "desire": 0.0-1.0 }
  ],
  "positionalPriority": ["RB", "WR", ...],
  "capPosture": "1 sentence — e.g. 'Cap-strapped at $44.2M used; rookies must go taxi'",
  "taxiCandidates": ["Player 1", "Player 2"],
  "wildcard": { "name": "...", "position": "...", "reasoning": "...", "desire": 0.3 },
  "summary": "2-3 sentence narrative — what this GM is trying to do in this draft and why"
}

Provide 3-5 topTargets ordered by desire (highest first). Wildcard is optional but recommended — a lower-confidence pick that fits this GM's tendencies but isn't a consensus target.`;

// ── Per-franchise prompt builder ────────────────────────────────────────────
function buildFranchisePrompt(franchise, dossier, rosterSummary, theirPicks) {
  const picksLine = theirPicks.length > 0
    ? theirPicks.map(p => `${p.round}.${String(p.pick).padStart(2, '0')}`).join(', ')
    : '(no picks in rounds 1-3)';

  // Position count — quick way for the GM to see roster shape
  const posCounts = Object.entries(rosterSummary.byPosition).filter(([, n]) => n > 0)
    .map(([pos, n]) => `${pos}:${n}`).join(' ');

  const behavioralNotesText = (dossier.behavioralNotes || []).length > 0
    ? dossier.behavioralNotes.map(n => `- ${n.text} (confidence ${n.confidence})`).join('\n')
    : '(none yet — first run)';

  return `You are simulating: ${franchise.name} (${franchise.abbrev}, ${franchise.division} Division)

YOUR PICKS in rounds 1-${ROUNDS_TO_PREDICT}: ${picksLine}

YOUR ROSTER (${rosterSummary.players.length} players):
- Cap used: $${(rosterSummary.capUsed / 1_000_000).toFixed(1)}M of $45.0M (space: $${((45_000_000 - rosterSummary.capUsed) / 1_000_000).toFixed(1)}M)
- Position counts: ${posCounts || '(empty)'}
- Active: ${rosterSummary.activeCount}, Taxi: ${rosterSummary.taxiCount}, IR: ${rosterSummary.irCount}
- Contracts expiring after this year: ${rosterSummary.contractsExpiring}

RSP AFFINITY: ${dossier.rspAffinity.score} (${dossier.rspAffinity.abCount} A/B-tier RSP players currently rostered, ${dossier.rspAffinity.abPct}%)
${dossier.rspAffinity.score === 'high' ? 'You read Waldman religiously and weight RSP rankings heavily.' : ''}
${dossier.rspAffinity.score === 'medium' ? 'You blend RSP with consensus boards.' : ''}
${dossier.rspAffinity.score === 'low' ? 'You chase consensus ADP and big names; RSP rankings carry less weight for you.' : ''}

BEHAVIORAL NOTES from prior reports:
${behavioralNotesText}

═══ THE BOARDS ═══

RSP TOP 30 (Matt Waldman, pre-draft, DoT score):
${rspBoardText}

MFL DYNASTY ADP TOP 30 (rookies only):
${adpBoardText || '(no rookie ADP data available — defer to RSP)'}

═══ MARKET CONTEXT ═══

Pick ownership across all franchises (rounds 1-${ROUNDS_TO_PREDICT}):
${allPicksText}

═══ TASK ═══

Produce the GM brief JSON for ${franchise.name}. Cite specific players from the boards above.
Anchor reasoning in roster shape, cap, and RSP affinity. Do not pick players who already left the boards above unless you have strong reason.

Output JSON only.`;
}

// ── Main loop ───────────────────────────────────────────────────────────────
const briefs = [];
const dossiersUpdated = [];
let agentCallCount = 0;

const targetFranchises = ONLY_FRANCHISES.length > 0
  ? inputs.franchises.filter(f => ONLY_FRANCHISES.includes(f.franchiseId))
  : inputs.franchises;

console.log(`Processing ${targetFranchises.length} franchise(s)...\n`);

for (const franchise of targetFranchises) {
  const fid = franchise.franchiseId;
  const slug = franchiseSlug(franchise.nameShort || franchise.name);

  // Build/refresh dossier
  const rosterSummary = summarizeFranchiseRoster(fid, inputs.rosters, inputs.playerById);
  let dossier = loadDossier(fid, slug);
  if (!dossier) {
    dossier = seedDossier({ franchise, rosterSummary, rspAffinity: inputs.rspAffinity, season: year });
  } else {
    dossier = refreshDossierSnapshot(dossier, { rosterSummary, season: year });
  }

  // Their picks
  const theirPicks = inputs.pickOwnership
    .filter(p => p.franchiseId === fid && p.round <= ROUNDS_TO_PREDICT)
    .map(p => ({ round: p.round, pick: p.pick }));

  // Skip franchises with no picks in rounds 1-3 — they can't draft anyone.
  if (theirPicks.length === 0) {
    console.log(`  · ${franchise.name} — no picks in rounds 1-${ROUNDS_TO_PREDICT}, skipping brief`);
    writeDossier(dossier);
    dossiersUpdated.push(franchise.franchiseId);
    continue;
  }

  const prompt = buildFranchisePrompt(franchise, dossier, rosterSummary, theirPicks);

  process.stdout.write(`  → ${franchise.name} (${theirPicks.length} pick${theirPicks.length === 1 ? '' : 's'})... `);
  const t0 = Date.now();
  let parsed;
  try {
    parsed = await callAnthropicJSON({ system: SYSTEM_PROMPT, user: prompt });
    agentCallCount++;
  } catch (err) {
    console.log(`✗ FAILED`);
    console.error(`    ${err.message}`);
    continue;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✓ ${elapsed}s`);

  // Validate required fields
  if (!parsed.topTargets || !Array.isArray(parsed.topTargets) || parsed.topTargets.length === 0) {
    console.warn(`    ⚠️  ${franchise.name} returned no topTargets, skipping`);
    continue;
  }

  briefs.push({
    franchiseId: fid,
    franchiseName: franchise.name,
    topTargets: parsed.topTargets,
    positionalPriority: parsed.positionalPriority || [],
    capPosture: parsed.capPosture || '',
    taxiCandidates: parsed.taxiCandidates || [],
    wildcard: parsed.wildcard,
    summary: parsed.summary || '',
  });

  writeDossier(dossier);
  dossiersUpdated.push(fid);
}

// ── Assemble mock ───────────────────────────────────────────────────────────
console.log(`\n🎯 Assembling 3-round mock from ${briefs.length} briefs...`);

const teamById = new Map(inputs.franchises.map(f => [f.franchiseId, f]));
const targetPicks = inputs.pickOwnership.filter(p => p.round <= ROUNDS_TO_PREDICT);

const mock = assembleMock({
  briefs,
  pickOwnership: targetPicks,
  rspBoard: inputs.rspBoard,
  rookieAdp: inputs.rookieAdp,
  teamById,
});

console.log(`   Mock: ${mock.length} picks across ${ROUNDS_TO_PREDICT} round(s)`);

// ── Market notes (heuristics over the briefs) ───────────────────────────────
const marketNotes = [];

// Most-contested players
const desireByName = new Map();
for (const b of briefs) {
  for (const t of b.topTargets) {
    const key = t.name.toLowerCase();
    const cur = desireByName.get(key) ?? { name: t.name, position: t.position, count: 0, totalDesire: 0 };
    cur.count++;
    cur.totalDesire += t.desire || 0;
    desireByName.set(key, cur);
  }
}
const contested = Array.from(desireByName.values())
  .filter(p => p.count >= 3)
  .sort((a, b) => b.totalDesire - a.totalDesire)
  .slice(0, 3);

for (const c of contested) {
  marketNotes.push(`Heavily contested: ${c.name} (${c.position}) is a top-target for ${c.count} different franchises.`);
}

// Cap-strapped franchises
const capStrappedCount = briefs.filter(b => /cap.{0,8}strapped|tight cap|no cap room|forced.{0,8}taxi/i.test(b.capPosture)).length;
if (capStrappedCount > 4) {
  marketNotes.push(`${capStrappedCount} franchises are cap-constrained — expect heavy taxi-stash usage and/or rookie pick trades.`);
}

// ── Write outputs ───────────────────────────────────────────────────────────
const reportDir = path.join(REPORTS_DIR, `${year}-${EVENT_TYPE}`);
fs.mkdirSync(reportDir, { recursive: true });

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
  generator: 'scripts/scouting/generate-rookie-draft.mjs',
  modelUsed: SCOUTING_MODEL,
  agentCallCount,
  durationMs: Date.now() - startTime,
};

fs.writeFileSync(path.join(reportDir, 'predictions.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(reportDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

// ── Append to ledger ────────────────────────────────────────────────────────
const newPredictions = predictionsFromReport(report);
const totalPredictions = appendPredictions(newPredictions);

// ── Summary ─────────────────────────────────────────────────────────────────
const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`
✅ Done in ${totalSec}s
   ${briefs.length} GM briefs
   ${mock.length} mock picks (rounds 1-${ROUNDS_TO_PREDICT})
   ${dossiersUpdated.length} dossiers updated
   ${newPredictions.length} predictions appended to ledger (total: ${totalPredictions})
   Agent calls: ${agentCallCount}

   Output: ${path.relative(REPO_ROOT, reportDir)}/

   View at: /admin/scouting/${year}-rookie-draft
`);
