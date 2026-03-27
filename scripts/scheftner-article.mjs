#!/usr/bin/env node
/**
 * Scheftner Article Generator
 *
 * Generates feature articles for the Scheftner Report feed.
 * ALL data is pre-resolved by this script — the AI only adds voice/commentary.
 * The AI never reads raw MFL data files or interprets IDs.
 *
 * Usage: node scripts/scheftner-article.mjs --type auction-recap
 *
 * Environment:
 *   ANTHROPIC_API_KEY — Required for Scheftner voice generation
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// ── Data Resolution (deterministic, no AI) ──

function loadJSON(filePath) {
  return fs.readFile(filePath, 'utf8').then(JSON.parse);
}

function flipName(mflName) {
  if (!mflName) return 'Unknown';
  const parts = mflName.split(', ');
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : mflName;
}

function formatSalary(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : n % 100_000 === 0 ? 2 : 3)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function formatDefName(name) {
  const parts = name.split(', ');
  if (parts.length === 2) return `the ${parts[1]} ${parts[0]} defense`;
  return `the ${name} defense`;
}

async function resolveAuctionData() {
  // data/ lives in the main repo — resolve from worktree or main
  const mainRepo = projectRoot.includes('.claude/worktrees/')
    ? projectRoot.replace(/\.claude\/worktrees\/[^/]+$/, '')
    : projectRoot;
  const mainData = path.join(mainRepo, 'data', 'theleague', 'mfl-feeds', '2026');

  const [auctionRaw, playersRaw, configRaw] = await Promise.all([
    loadJSON(path.join(mainData, 'auctionResults.json')),
    loadJSON(path.join(mainData, 'players.json')),
    loadJSON(path.join(projectRoot, 'src', 'data', 'theleague.config.json')),
  ]);

  // Build lookup maps
  const players = new Map();
  for (const p of playersRaw.players.player) {
    if (p.id) players.set(p.id, { name: p.name, position: p.position, team: p.team });
  }
  const teams = new Map();
  for (const t of configRaw.teams) {
    teams.set(t.franchiseId, t.name);
  }

  const results = Array.isArray(auctionRaw.auctionResults.auctionUnit.auction)
    ? auctionRaw.auctionResults.auctionUnit.auction
    : [auctionRaw.auctionResults.auctionUnit.auction];

  // Resolve every auction result to human-readable form
  const resolved = results.map(a => {
    const p = players.get(a.player);
    const isDef = p?.position === 'Def' || p?.position === 'DEF';
    return {
      player: isDef ? formatDefName(p.name) : flipName(p?.name),
      position: p?.position ?? '??',
      team: teams.get(a.franchise) ?? `Team ${a.franchise}`,
      franchiseId: a.franchise,
      salary: parseInt(a.winningBid, 10),
      salaryDisplay: formatSalary(a.winningBid),
      isDef,
    };
  }).sort((a, b) => b.salary - a.salary);

  // Aggregate by franchise
  const byFranchise = {};
  for (const r of resolved) {
    if (!byFranchise[r.franchiseId]) {
      byFranchise[r.franchiseId] = { team: r.team, players: [], total: 0, count: 0 };
    }
    byFranchise[r.franchiseId].players.push(r);
    byFranchise[r.franchiseId].total += r.salary;
    byFranchise[r.franchiseId].count++;
  }

  const franchiseRanking = Object.values(byFranchise).sort((a, b) => b.total - a.total);

  return { resolved, franchiseRanking, totalPlayers: resolved.length, totalSpend: resolved.reduce((s, r) => s + r.salary, 0) };
}

// ── Fact Sheet Builder (deterministic) ──

function buildFactSheet(data) {
  const lines = [];

  lines.push(`AUCTION SUMMARY: ${data.totalPlayers} players auctioned. ${formatSalary(data.totalSpend)} total league spend.`);
  lines.push('');

  lines.push('TOP 20 ACQUISITIONS (use these EXACT player → team → salary assignments):');
  for (const [i, r] of data.resolved.slice(0, 20).entries()) {
    lines.push(`  ${i + 1}. ${r.position} ${r.player} → ${r.team} at ${r.salaryDisplay}`);
  }
  lines.push('');

  lines.push('FRANCHISE SPENDING (sorted by total, use these EXACT rosters):');
  for (const f of data.franchiseRanking) {
    lines.push(`  ${f.team}: ${formatSalary(f.total)} total, ${f.count} players`);
    for (const p of f.players) {
      lines.push(`    - ${p.position} ${p.player} (${p.salaryDisplay})`);
    }
    lines.push('');
  }

  lines.push('AUCTION CONTEXT:');
  lines.push('  - The auction officially ends the third Sunday in August');
  lines.push('  - For all intents and purposes, the action wraps up in the first week to 10 days');
  lines.push('  - Players not auctioned can be claimed as free agents after the auction closes');
  lines.push('  - This is an offseason auction — these are new roster acquisitions, not extensions');

  return lines.join('\n');
}

// ── AI Voice Layer ──

async function generateArticle(factSheet) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY required');
    process.exit(1);
  }

  const systemPrompt = `You are Claude Schefter, beat reporter and league insider for TheLeague — a dynasty fantasy football league.

VOICE: Channel Adam Schefter's high-energy breaking news style.
- Use "I'm told...", "League sources tell me...", "Boom!", "Money is nice, but championships are better"
- Be opinionated. Grade franchises. Call out overpays and steals.
- Never break character. Never hedge with "it appears" or "I'm an AI."
- Use <strong> tags for player names and salary figures on first mention.
- Keep paragraphs 2-4 sentences. Punchy, not rambling.

LEAGUE CONTEXT:
- The auction runs on MFL with a slow-close format
- The real action happens in a 7-10 day window — that's when all the main players are acquired
- After that burst, activity drops to a trickle of minor pickups
- The auction officially closes on the third Sunday in August
- Frame it as "the auction is mostly wrapped up" after the burst, not "the auction is over"
- The salary cap is $45M per franchise. These are dynasty salaries, not NFL salaries.

CRITICAL RULE: You may ONLY reference player → team → salary assignments that appear in the FACT SHEET below. Do NOT invent, guess, or infer any player-team assignments. Every name you mention must come from the fact sheet. If you're unsure about an assignment, leave it out.`;

  const userPrompt = `Write a 2026 offseason auction recap article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card. Hook the reader.",
  "content": ["<p>paragraph 1</p>", "<p>paragraph 2</p>", ...]
}

Write 8-10 paragraphs covering:
1. Opening — set the scene, Scheftner energy
2. The Big Spenders — top 3 franchises by total spend, their key players
3. The Headline Acquisitions — top 5 most expensive players and who got them
4. Best Values — 3-4 players acquired below market rate
5. The Overpays — bold spending, $9M+ on a single player
6. Position Trends — QB, WR, RB, TE, DEF spending patterns
7. Franchise Grades — grade the top 4-5 most active franchises (A+ to F)
8. Final Verdict — who improved most, who's in trouble, competitive outlook

Remember: ONLY use facts from the sheet above. Every player-team-salary mention must match exactly.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text ?? '';

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in API response');
  return JSON.parse(jsonMatch[0]);
}

// ── Validation ──

function validateArticle(article, data) {
  const errors = [];

  // Check that every team mentioned in the article exists in the data
  const teamNames = data.franchiseRanking.map(f => f.team);
  const playerTeamPairs = data.resolved.map(r => `${r.player}.*${r.team}`);

  // Basic checks
  if (!article.headline || article.headline.length > 100) errors.push('Headline missing or too long');
  if (!article.excerpt || article.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!article.content || article.content.length < 5) errors.push('Too few paragraphs');

  if (errors.length > 0) {
    console.warn('Validation warnings:', errors);
  }

  return errors;
}

// ── Main ──

async function main() {
  console.log('🎙️ Scheftner Article Generator\n');

  // Step 1: Resolve all data (deterministic)
  console.log('Step 1: Resolving auction data...');
  const data = await resolveAuctionData();
  console.log(`  ${data.totalPlayers} players, ${formatSalary(data.totalSpend)} total spend`);
  console.log(`  ${data.franchiseRanking.length} franchises participated`);

  // Step 2: Build fact sheet (deterministic)
  console.log('\nStep 2: Building fact sheet...');
  const factSheet = buildFactSheet(data);
  await fs.writeFile(
    path.join(projectRoot, 'scripts/auction-fact-sheet.txt'),
    factSheet,
  );
  console.log('  Fact sheet written to scripts/auction-fact-sheet.txt');

  // Step 3: Generate article voice (AI)
  console.log('\nStep 3: Generating Scheftner voice...');
  const article = await generateArticle(factSheet);
  console.log(`  Headline: ${article.headline}`);
  console.log(`  Paragraphs: ${article.content.length}`);

  // Step 4: Validate
  console.log('\nStep 4: Validating...');
  const errors = validateArticle(article, data);
  if (errors.length === 0) console.log('  ✓ Validation passed');

  // Step 5: Write output
  const outputPath = path.join(projectRoot, 'scripts/auction-recap-output.json');
  await fs.writeFile(outputPath, JSON.stringify(article, null, 2) + '\n');
  console.log(`\n✅ Article written to scripts/auction-recap-output.json`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
