#!/usr/bin/env node
/**
 * Dump per-franchise prompts to tmp files. Used by Plan B (live agent
 * invocations from a Claude Code session) when ANTHROPIC_API_KEY isn't
 * available. The main generator script normally calls Anthropic directly;
 * this entry point just produces the prompts so a human (or another agent)
 * can run them.
 *
 * Usage:
 *   node scripts/scouting/dump-prompts.mjs 2026
 *
 * Writes:
 *   tmp/scouting-prompts/<franchiseId>.txt — one user prompt per franchise
 *   tmp/scouting-prompts/_system.txt       — shared system prompt
 *   tmp/scouting-prompts/_index.json       — { franchiseId, name, picks, promptPath }
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRookieDraftInputs, summarizeFranchiseRoster } from './lib/load-inputs.mjs';
import { loadDossier, seedDossier, refreshDossierSnapshot, writeDossier, franchiseSlug } from './lib/dossier.mjs';

const ROUNDS_TO_PREDICT = 3;
const year = parseInt(process.argv[2], 10);
if (!year) {
  console.error('Usage: node scripts/scouting/dump-prompts.mjs <year>');
  process.exit(1);
}

const inputs = loadRookieDraftInputs(year);
const outDir = path.join(process.cwd(), 'tmp', 'scouting-prompts');
fs.mkdirSync(outDir, { recursive: true });

// Shared text — same as in generate-rookie-draft.mjs
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

const SYSTEM_PROMPT = `You are a franchise GM simulator for TheLeague (MFL 13522), a 16-team dynasty salary cap fantasy football league.

LEAGUE RULES (relevant for rookie draft):
- $45M hard salary cap (cannot exceed)
- 22 active roster + 3 taxi squad (rookies only) + unlimited IR
- Taxi squad cap hit: 50% of base salary in current year, full salary in projections
- Contracts 1-5 years, 10% annual escalation
- Active roster minimum 20 players Week 1-17

You will be given one franchise to role-play. Reason as their GM would, using their roster, cap posture, RSP affinity, and any behavioral notes. Do NOT recommend the optimal pick — predict what THIS GM would actually do.

OUTPUT CONTRACT — your final action MUST be to write the brief JSON to the exact file path given in the prompt. The JSON must match this schema (no markdown, no commentary in the file — just JSON):
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

fs.writeFileSync(path.join(outDir, '_system.txt'), SYSTEM_PROMPT);

const briefsOutDir = path.join(
  process.cwd(),
  'data',
  'fantasy-expert',
  'scouting-system',
  'reports',
  `${year}-rookie-draft`,
  '_briefs',
);
fs.mkdirSync(briefsOutDir, { recursive: true });

const index = [];

for (const franchise of inputs.franchises) {
  const fid = franchise.franchiseId;
  const slug = franchiseSlug(franchise.nameShort || franchise.name);

  const rosterSummary = summarizeFranchiseRoster(fid, inputs.rosters, inputs.playerById);
  let dossier = loadDossier(fid, slug);
  if (!dossier) {
    dossier = seedDossier({ franchise, rosterSummary, rspAffinity: inputs.rspAffinity, season: year });
  } else {
    dossier = refreshDossierSnapshot(dossier, { rosterSummary, season: year });
  }
  writeDossier(dossier);

  const theirPicks = inputs.pickOwnership
    .filter(p => p.franchiseId === fid && p.round <= ROUNDS_TO_PREDICT)
    .map(p => ({ round: p.round, pick: p.pick }));

  if (theirPicks.length === 0) {
    console.log(`  ${franchise.name}: no picks in rounds 1-${ROUNDS_TO_PREDICT}, skipping`);
    continue;
  }

  const picksLine = theirPicks.map(p => `${p.round}.${String(p.pick).padStart(2, '0')}`).join(', ');
  const posCounts = Object.entries(rosterSummary.byPosition).filter(([, n]) => n > 0)
    .map(([pos, n]) => `${pos}:${n}`).join(' ');
  const behavioralNotesText = (dossier.behavioralNotes || []).length > 0
    ? dossier.behavioralNotes.map(n => `- ${n.text} (confidence ${n.confidence})`).join('\n')
    : '(none yet — first run)';

  const briefOutFile = path.join(briefsOutDir, `${fid}.json`);

  const userPrompt = `You are simulating: ${franchise.name} (${franchise.abbrev}, ${franchise.division} Division)

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

WRITE THE FINAL JSON to this file path (no other output, no commentary in the file):
${path.relative(process.cwd(), briefOutFile)}`;

  const promptFile = path.join(outDir, `${fid}.txt`);
  fs.writeFileSync(promptFile, userPrompt);
  index.push({
    franchiseId: fid,
    franchiseName: franchise.name,
    picks: picksLine,
    promptPath: path.relative(process.cwd(), promptFile),
    briefOutPath: path.relative(process.cwd(), briefOutFile),
  });
}

fs.writeFileSync(path.join(outDir, '_index.json'), JSON.stringify(index, null, 2));

console.log(`\n✅ Dumped ${index.length} prompts to ${path.relative(process.cwd(), outDir)}/`);
console.log(`   System prompt: ${path.relative(process.cwd(), path.join(outDir, '_system.txt'))}`);
console.log(`   Index:         ${path.relative(process.cwd(), path.join(outDir, '_index.json'))}`);
console.log(`   Briefs land in: ${path.relative(process.cwd(), briefsOutDir)}/`);
