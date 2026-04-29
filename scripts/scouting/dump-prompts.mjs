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
function topConsensusText(n = 50) {
  return inputs.consensusBoard.slice(0, n).map(p =>
    `${p.rank}. ${p.name} (${p.position}${p.positionRank}, ${p.nflTeam || 'FA'}) — ${p.tier}`
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
const consensusBoardText = topConsensusText(50);
const allPicksText = pickOwnershipText();

// Per-franchise board weighting based on RSP affinity.
// Primary: 50% Consensus (post-NFL-draft, all teams use it the same).
// Other 50% split between RSP and MFL ADP, weighted by affinity.
function affinityWeights(score) {
  // Returns { consensus, rsp, adp } summing to 100.
  if (score === 'high') return { consensus: 50, rsp: 40, adp: 10 };
  if (score === 'medium') return { consensus: 50, rsp: 25, adp: 25 };
  return { consensus: 50, rsp: 10, adp: 40 };
}

const SYSTEM_PROMPT = `You are a franchise GM simulator for TheLeague (MFL 13522), a 16-team dynasty salary cap fantasy football league.

LEAGUE RULES (relevant for rookie draft):
- $45M hard salary cap (cannot exceed)
- 22 active roster + 3 taxi squad (rookies only) + unlimited IR
- Taxi squad cap hit: 50% of base salary in current year, full salary in projections
- Contracts 1-5 years, 10% annual escalation
- Active roster minimum 20 players Week 1-17

You will be given one franchise to role-play. Reason as their GM would, using their roster, cap posture, RSP affinity, behavioral notes, and the BOARD WEIGHTING described in the prompt. Do NOT recommend the optimal pick — predict what THIS GM would actually do.

═══ HOW TO WEIGHT THE BOARDS ═══

Every franchise builds a personal board from three sources. The PRIMARY board is the Consensus list (post-NFL-draft, tiered, with NFL team assignments) — every franchise weights it 50%. The other 50% splits between RSP (Matt Waldman, deep scouting) and MFL Dynasty ADP (market price), based on the franchise's RSP affinity:

- HIGH RSP affinity   →  50% Consensus + 40% RSP + 10% MFL ADP   (Waldman devotees; will reach for RSP-loved sleepers)
- MEDIUM RSP affinity →  50% Consensus + 25% RSP + 25% MFL ADP   (blend pragmatically)
- LOW RSP affinity    →  50% Consensus + 10% RSP + 40% MFL ADP   (ADP-driven; chase consensus and big names)

You don't need to compute exact weighted scores — just reason as a GM with that bias would. A high-affinity GM at 1.10 might pick the player Waldman ranks #6 if Consensus has him in Tier 2. A low-affinity GM at the same slot would never reach past Consensus Tier 2 unless ADP also confirms.

OUTPUT CONTRACT — your final action MUST be to write the brief JSON to the exact file path given in the prompt. The JSON must match this schema (no markdown, no commentary in the file — just JSON):
{
  "topTargets": [
    { "name": "Full Name", "position": "QB|RB|WR|TE", "reasoning": "1-2 sentences citing specific board positions (Consensus #X Tier Y, RSP DoT score, ADP rank) and roster need", "desire": 0.0-1.0 }
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

  const weights = affinityWeights(dossier.rspAffinity.score);

  const userPrompt = `You are simulating: ${franchise.name} (${franchise.abbrev}, ${franchise.division} Division)

YOUR PICKS in rounds 1-${ROUNDS_TO_PREDICT}: ${picksLine}

YOUR ROSTER (${rosterSummary.players.length} players):
- Cap used: $${(rosterSummary.capUsed / 1_000_000).toFixed(1)}M of $45.0M (space: $${((45_000_000 - rosterSummary.capUsed) / 1_000_000).toFixed(1)}M)
- Position counts: ${posCounts || '(empty)'}
- Active: ${rosterSummary.activeCount}, Taxi: ${rosterSummary.taxiCount}, IR: ${rosterSummary.irCount}
- Contracts expiring after this year: ${rosterSummary.contractsExpiring}

RSP AFFINITY: ${dossier.rspAffinity.score} (${dossier.rspAffinity.abCount} A/B-tier RSP players currently rostered, ${dossier.rspAffinity.abPct}%)

YOUR PERSONAL BOARD WEIGHTING:
- ${weights.consensus}% Consensus (primary, all GMs anchor here)
- ${weights.rsp}% RSP (Waldman scouting)
- ${weights.adp}% MFL Dynasty ADP (market price)

BEHAVIORAL NOTES from prior reports:
${behavioralNotesText}

═══ THE BOARDS ═══

▶ PRIMARY: CONSENSUS TOP 50 (post-NFL-draft, tiered, with NFL team assignments — weight 50% for ALL franchises):
${consensusBoardText}

▶ RSP TOP 30 (Matt Waldman, pre-draft, DoT score — weight ${weights.rsp}% for you):
${rspBoardText}

▶ MFL DYNASTY ADP TOP 30 (rookies only — weight ${weights.adp}% for you):
${adpBoardText || '(no rookie ADP data available — defer to other boards)'}

Note: RSP is pre-NFL-draft scouting; Consensus is post-NFL-draft (NFL fit + landing spot baked in). When the boards conflict, lean toward your weighting — but be willing to take a Consensus Tier-1 over an RSP-favored player two tiers down.

═══ MARKET CONTEXT ═══

Pick ownership across all franchises (rounds 1-${ROUNDS_TO_PREDICT}):
${allPicksText}

═══ TASK ═══

Produce the GM brief JSON for ${franchise.name}. Cite specific players from the boards (e.g. "Consensus #5 Tier 2, RSP DoT 86.3").
Apply YOUR weighting (${weights.consensus}% / ${weights.rsp}% / ${weights.adp}%) — don't reason as a generic GM.
Anchor reasoning in roster shape, cap, and your weighting bias.

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
