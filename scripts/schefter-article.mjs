#!/usr/bin/env node
/**
 * Schefter Article Generator — Auction Grades Edition
 *
 * Generates auction grade cards for the Schefter Report feed.
 * Analyzes pre-auction rosters to identify lineup holes, then grades
 * each team on how well they filled those holes at auction.
 *
 * ALL data is pre-resolved by this script — the AI only adds voice/commentary.
 * The AI never reads raw MFL data files or interprets IDs.
 *
 * Usage: node scripts/schefter-article.mjs --type auction-recap
 *
 * Environment:
 *   ANTHROPIC_API_KEY — Required for Schefter voice generation
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// ── Constants ──

/** Starting lineup requirements: 1 QB, 1+ RB, 1+ WR, 1+ TE, 1 PK, 1 Def = 9 starters */
const STARTING_POSITIONS = { QB: 1, RB: 1, WR: 1, TE: 1, PK: 1, Def: 1 };
const FLEX_MINIMUM = 3; // At least 3 RB/WR/TE starters beyond the 1-each minimum
const SALARY_CAP = 45_000_000;

// Normalize MFL position strings to canonical form
function normalizePosition(pos) {
  if (!pos) return '??';
  const upper = pos.toUpperCase();
  if (upper === 'DEF') return 'Def';
  if (['TMQB', 'TMRB', 'TMWR', 'TMTE', 'TMPK'].includes(upper)) return upper.slice(2);
  return pos;
}

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
  const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
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

/**
 * Find the most recent pre-auction roster snapshot.
 * We look for the last date where the average roster size is still small
 * (pre-auction rosters are ~16 players; post-auction ~22-28).
 */
async function findPreAuctionSnapshot(rosterHistoryDir) {
  const files = await fs.readdir(rosterHistoryDir);
  const dated = files
    .filter(f => f.startsWith('rosters-') && f.endsWith('.json'))
    .map(f => f.replace('rosters-', '').replace('.json', ''))
    .sort();

  // Walk backwards from most recent to find the last snapshot before rosters jumped
  let preAuctionDate = dated[0]; // fallback to earliest
  for (let i = dated.length - 1; i >= 0; i--) {
    const data = await loadJSON(path.join(rosterHistoryDir, `rosters-${dated[i]}.json`));
    const franchises = data.rosters.franchise;
    const avg = franchises.reduce((sum, f) => {
      const count = Array.isArray(f.player) ? f.player.length : (f.player ? 1 : 0);
      return sum + count;
    }, 0) / franchises.length;

    if (avg < 18) { // Pre-auction threshold
      preAuctionDate = dated[i];
      break;
    }
  }
  return preAuctionDate;
}

async function resolveAuctionData() {
  const mainRepo = projectRoot.includes('.claude/worktrees/')
    ? projectRoot.replace(/\.claude\/worktrees\/[^/]+$/, '')
    : projectRoot;
  const mainData = path.join(mainRepo, 'data', 'theleague', 'mfl-feeds', '2026');

  // Find pre-auction snapshot
  const rosterHistoryDir = path.join(mainData, 'roster-history');
  const preAuctionDate = await findPreAuctionSnapshot(rosterHistoryDir);
  console.log(`  Using pre-auction snapshot: ${preAuctionDate}`);

  const [auctionRaw, playersRaw, configRaw, preAuctionRosters] = await Promise.all([
    loadJSON(path.join(mainData, 'auctionResults.json')),
    loadJSON(path.join(mainData, 'players.json')),
    loadJSON(path.join(projectRoot, 'src', 'data', 'theleague.config.json')),
    loadJSON(path.join(rosterHistoryDir, `rosters-${preAuctionDate}.json`)),
  ]);

  // Build lookup maps
  const players = new Map();
  for (const p of playersRaw.players.player) {
    if (p.id) players.set(p.id, { name: p.name, position: normalizePosition(p.position), team: p.team });
  }
  const teams = new Map();
  for (const t of configRaw.teams) {
    teams.set(t.franchiseId, { name: t.name, abbrev: t.abbrev, color: t.color });
  }

  // ── Resolve pre-auction rosters ──
  const preAuctionByFranchise = {};
  for (const franchise of preAuctionRosters.rosters.franchise) {
    const rosterPlayers = Array.isArray(franchise.player) ? franchise.player : (franchise.player ? [franchise.player] : []);
    const positionCounts = { QB: 0, RB: 0, WR: 0, TE: 0, PK: 0, Def: 0 };
    const rosterList = [];

    for (const rp of rosterPlayers) {
      const info = players.get(rp.id);
      if (!info) continue;
      const pos = normalizePosition(info.position);
      if (positionCounts[pos] !== undefined) positionCounts[pos]++;
      const isDef = pos === 'Def';
      rosterList.push({
        name: isDef ? formatDefName(info.name) : flipName(info.name),
        position: pos,
        salary: parseInt(parseFloat(rp.salary), 10),
        contractYears: parseInt(rp.contractYear, 10),
      });
    }

    // Identify holes: positions with 0 players = critical hole
    // QB and PK with exactly 0 = critical (need exactly 1)
    // Def with 0 = critical
    // RB/WR/TE: need enough to fill flex. If total RB+WR+TE < 4 (1 each + 3 flex minimum), that's thin
    const holes = [];
    const thin = [];
    for (const [pos, min] of Object.entries(STARTING_POSITIONS)) {
      if (positionCounts[pos] === 0) {
        holes.push(pos);
      } else if (positionCounts[pos] === 1 && ['RB', 'WR', 'TE'].includes(pos)) {
        thin.push(pos);
      }
    }
    // Check flex depth
    const flexTotal = positionCounts.RB + positionCounts.WR + positionCounts.TE;
    const flexShort = Math.max(0, (3 + FLEX_MINIMUM) - flexTotal); // Need 6 total (1+1+1+3flex)

    const totalSalary = rosterList.reduce((s, p) => s + p.salary, 0);

    preAuctionByFranchise[franchise.id] = {
      team: teams.get(franchise.id)?.name ?? `Team ${franchise.id}`,
      abbrev: teams.get(franchise.id)?.abbrev ?? franchise.id,
      color: teams.get(franchise.id)?.color ?? '#666',
      players: rosterList,
      positionCounts,
      holes,
      thin,
      flexShort,
      totalSalary,
      capSpace: SALARY_CAP - totalSalary,
      rosterSize: rosterList.length,
    };
  }

  // ── Resolve auction results ──
  const results = Array.isArray(auctionRaw.auctionResults.auctionUnit.auction)
    ? auctionRaw.auctionResults.auctionUnit.auction
    : [auctionRaw.auctionResults.auctionUnit.auction];

  const resolved = results.map(a => {
    const p = players.get(a.player);
    const pos = normalizePosition(p?.position);
    const isDef = pos === 'Def';
    return {
      player: isDef ? formatDefName(p.name) : flipName(p?.name),
      position: pos,
      nflTeam: p?.team ?? '??',
      team: teams.get(a.franchise)?.name ?? `Team ${a.franchise}`,
      franchiseId: a.franchise,
      salary: parseInt(a.winningBid, 10),
      salaryDisplay: formatSalary(a.winningBid),
      isDef,
    };
  }).sort((a, b) => b.salary - a.salary);

  // ── Build per-franchise auction + needs analysis ──
  const franchiseGradeData = {};
  for (const [fid, preData] of Object.entries(preAuctionByFranchise)) {
    const auctionPickups = resolved.filter(r => r.franchiseId === fid);
    const auctionSpend = auctionPickups.reduce((s, r) => s + r.salary, 0);

    // Which positions did they acquire?
    const acquiredPositions = {};
    for (const p of auctionPickups) {
      acquiredPositions[p.position] = (acquiredPositions[p.position] || 0) + 1;
    }

    // Did they fill their holes?
    const holesFilled = preData.holes.filter(pos => acquiredPositions[pos] > 0);
    const holesRemaining = preData.holes.filter(pos => !acquiredPositions[pos]);

    // Post-auction position counts
    const postPositionCounts = { ...preData.positionCounts };
    for (const p of auctionPickups) {
      if (postPositionCounts[p.position] !== undefined) {
        postPositionCounts[p.position]++;
      }
    }
    const postFlexTotal = postPositionCounts.RB + postPositionCounts.WR + postPositionCounts.TE;

    franchiseGradeData[fid] = {
      ...preData,
      auctionPickups,
      auctionSpend,
      acquiredPositions,
      holesFilled,
      holesRemaining,
      postPositionCounts,
      postFlexTotal,
      postCapSpace: preData.capSpace - auctionSpend,
      totalRosterSize: preData.rosterSize + auctionPickups.length,
    };
  }

  return {
    resolved,
    franchiseGradeData,
    totalPlayers: resolved.length,
    totalSpend: resolved.reduce((s, r) => s + r.salary, 0),
    preAuctionDate,
  };
}

// ── Fact Sheet Builder (deterministic) ──

function buildFactSheet(data) {
  const lines = [];

  lines.push(`AUCTION SUMMARY: ${data.totalPlayers} players auctioned. ${formatSalary(data.totalSpend)} total league spend.`);
  lines.push('');

  lines.push('=== FRANCHISE-BY-FRANCHISE AUCTION GRADES DATA ===');
  lines.push('(Grade each team. Use ONLY this data. Do not invent facts.)');
  lines.push('');

  // Sort franchises by auction spend descending for the fact sheet
  const sorted = Object.entries(data.franchiseGradeData)
    .filter(([, d]) => d.auctionPickups.length > 0)
    .sort((a, b) => b[1].auctionSpend - a[1].auctionSpend);

  for (const [fid, d] of sorted) {
    lines.push(`── ${d.team} (${d.abbrev}) ──`);
    lines.push(`  Pre-auction roster: ${d.rosterSize} players, ${formatSalary(d.totalSalary)} committed, ${formatSalary(d.capSpace)} cap space`);

    // Pre-auction position breakdown
    const posParts = Object.entries(d.positionCounts)
      .map(([pos, count]) => `${count} ${pos}`)
      .join(', ');
    lines.push(`  Pre-auction positions: ${posParts}`);

    if (d.holes.length > 0) {
      lines.push(`  CRITICAL HOLES (0 players): ${d.holes.join(', ')}`);
    }
    if (d.thin.length > 0) {
      lines.push(`  THIN positions (only 1): ${d.thin.join(', ')}`);
    }
    if (d.flexShort > 0) {
      lines.push(`  FLEX DEPTH: ${d.flexShort} short of filling 9-starter lineup`);
    }

    lines.push(`  Auction spend: ${formatSalary(d.auctionSpend)} on ${d.auctionPickups.length} players`);
    lines.push(`  Acquired:`);
    for (const p of d.auctionPickups.sort((a, b) => b.salary - a.salary)) {
      lines.push(`    - ${p.position} ${p.player} (${p.salaryDisplay})`);
    }

    if (d.holesFilled.length > 0) {
      lines.push(`  Holes FILLED: ${d.holesFilled.join(', ')}`);
    }
    if (d.holesRemaining.length > 0) {
      lines.push(`  Holes STILL OPEN: ${d.holesRemaining.join(', ')}`);
    }

    // Post-auction position counts
    const postPosParts = Object.entries(d.postPositionCounts)
      .map(([pos, count]) => `${count} ${pos}`)
      .join(', ');
    lines.push(`  Post-auction positions: ${postPosParts}`);
    lines.push(`  Post-auction cap space: ${formatSalary(d.postCapSpace)}`);
    lines.push('');
  }

  // Teams that didn't bid at all
  const nonBidders = Object.entries(data.franchiseGradeData)
    .filter(([, d]) => d.auctionPickups.length === 0);
  if (nonBidders.length > 0) {
    lines.push('=== TEAMS THAT DID NOT PARTICIPATE ===');
    for (const [, d] of nonBidders) {
      const posParts = Object.entries(d.positionCounts)
        .map(([pos, count]) => `${count} ${pos}`)
        .join(', ');
      lines.push(`  ${d.team}: ${d.rosterSize} players, positions: ${posParts}`);
      if (d.holes.length > 0) lines.push(`    Unfilled holes: ${d.holes.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('=== TOP 15 MOST EXPENSIVE ACQUISITIONS ===');
  for (const [i, r] of data.resolved.slice(0, 15).entries()) {
    lines.push(`  ${i + 1}. ${r.position} ${r.player} → ${r.team} at ${r.salaryDisplay}`);
  }
  lines.push('');

  lines.push('GRADING CRITERIA (weight these factors):');
  lines.push('  1. HOLE FILLING (most important): Did they address critical starting lineup gaps? Teams that walked away with 0 players at a starting position lose major points.');
  lines.push('  2. VALUE: Did they get good players at reasonable prices relative to other auction prices? Overpays vs steals.');
  lines.push('  3. LINEUP QUALITY: How good is their projected starting lineup after the auction? Star power + depth.');
  lines.push('  4. CAP MANAGEMENT: Did they spend wisely relative to cap space? Did they leave room for in-season moves?');
  lines.push('');
  lines.push('AUCTION CONTEXT:');
  lines.push('  - Salary cap is $45M per franchise. These are dynasty salaries, not NFL salaries.');
  lines.push('  - The auction runs on MFL with a slow-close format.');
  lines.push('  - The real action happens in a 7-10 day window.');
  lines.push('  - Players not auctioned can be claimed as free agents after the auction closes.');
  lines.push('  - This is an offseason auction — these are new roster acquisitions, not extensions.');

  return lines.join('\n');
}

// ── AI Voice Layer ──

async function generateArticle(factSheet, data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY required');
    process.exit(1);
  }

  // Build the list of franchise IDs for the JSON schema
  const participatingTeams = Object.entries(data.franchiseGradeData)
    .filter(([, d]) => d.auctionPickups.length > 0)
    .sort((a, b) => b[1].auctionSpend - a[1].auctionSpend);

  const teamListForPrompt = participatingTeams
    .map(([fid, d]) => `"${fid}" (${d.team})`)
    .join(', ');

  const systemPrompt = `You are Claude Schefter, beat reporter and league insider for TheLeague — a dynasty fantasy football league.

VOICE: Channel Adam Schefter's high-energy breaking news style.
- Use "I'm told...", "League sources tell me...", "Boom!", "Money is nice, but championships are better"
- Be opinionated. Be bold with grades. Call out overpays and steals.
- Never break character. Never hedge with "it appears" or "I'm an AI."
- Keep paragraphs 2-4 sentences. Punchy, not rambling.

CRITICAL RULE: You may ONLY reference player → team → salary assignments that appear in the FACT SHEET. Do NOT invent, guess, or infer any player-team assignments. Every name you mention must come from the fact sheet.`;

  const userPrompt = `Write 2026 offseason auction GRADES using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars, about grading the auction)",
  "excerpt": "2-3 sentence teaser for the feed card. Hook the reader. Mention grades.",
  "intro": ["<p>Opening paragraph — set the scene, Schefter energy, explain you're grading every team.</p>", "<p>Optional second intro paragraph.</p>"],
  "grades": [
    {
      "franchiseId": "0001",
      "grade": "A",
      "headline": "Punchy 5-8 word summary of their auction",
      "body": "<p>2-3 sentences explaining the grade. Reference specific players they acquired and holes they filled (or didn't). Use <strong> for player names. Be specific about what they did well or poorly.</p>"
    }
  ]
}

INSTRUCTIONS:
- Write 1-2 opening "intro" paragraphs to set the scene.
- Then provide a "grades" array with ONE entry per franchise that participated in the auction.
- Participating franchise IDs: ${teamListForPrompt}
- Grade scale: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F
- GRADE BASED ON THE CRITERIA IN THE FACT SHEET:
  * Hole filling is the #1 factor. If they had QB=0 before and still have QB=0, that's devastating.
  * Value matters — overpaying $10M for one player when others went for $3M is bad.
  * Lineup quality after the auction — does this team look competitive?
  * Cap management — burning all cap space in the auction leaves no room for in-season pickups.
- Sort grades from best to worst.
- Every player name you mention MUST appear in the fact sheet for that team.
- Be bold. Don't give everyone a B. Spread the grades out.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const resData = await res.json();
  const text = resData.content?.[0]?.text ?? '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in API response');
  return JSON.parse(jsonMatch[0]);
}

// ── Validation ──

function validateArticle(article, data) {
  const errors = [];

  if (!article.headline || article.headline.length > 100) errors.push('Headline missing or too long');
  if (!article.excerpt || article.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!article.intro || article.intro.length < 1) errors.push('Missing intro paragraphs');
  if (!article.grades || article.grades.length < 3) errors.push('Too few grades (expected at least 3 teams)');

  // Validate grade values
  const validGrades = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
  for (const g of (article.grades || [])) {
    if (!validGrades.includes(g.grade)) {
      errors.push(`Invalid grade "${g.grade}" for franchise ${g.franchiseId}`);
    }
    if (!data.franchiseGradeData[g.franchiseId]) {
      errors.push(`Unknown franchise ${g.franchiseId}`);
    }
  }

  if (errors.length > 0) {
    console.warn('Validation warnings:', errors);
  }

  return errors;
}

/**
 * Enrich the AI output with deterministic data from the fact sheet.
 * This ensures the article has all the structured data needed for rendering
 * without relying on the AI to produce it.
 */
function enrichGrades(article, data) {
  for (const grade of article.grades) {
    const d = data.franchiseGradeData[grade.franchiseId];
    if (!d) continue;

    grade.teamName = d.team;
    grade.abbrev = d.abbrev;
    grade.color = d.color;
    grade.auctionSpend = d.auctionSpend;
    grade.auctionSpendDisplay = formatSalary(d.auctionSpend);
    grade.playerCount = d.auctionPickups.length;
    grade.holesBefore = d.holes;
    grade.holesRemaining = d.holesRemaining;
    grade.holesFilled = d.holesFilled;
    grade.postCapSpace = d.postCapSpace;
    grade.postCapSpaceDisplay = formatSalary(d.postCapSpace);
    grade.pickups = d.auctionPickups.map(p => ({
      name: p.player,
      position: p.position,
      salary: p.salaryDisplay,
    }));
  }
  return article;
}

// ── Main ──

async function main() {
  console.log('🎙️ Schefter Auction Grades Generator\n');

  // Step 1: Resolve all data (deterministic)
  console.log('Step 1: Resolving auction + roster data...');
  const data = await resolveAuctionData();
  console.log(`  ${data.totalPlayers} players auctioned, ${formatSalary(data.totalSpend)} total spend`);
  const participating = Object.values(data.franchiseGradeData).filter(d => d.auctionPickups.length > 0);
  console.log(`  ${participating.length} franchises participated`);

  // Step 2: Build fact sheet (deterministic)
  console.log('\nStep 2: Building fact sheet...');
  const factSheet = buildFactSheet(data);
  await fs.writeFile(
    path.join(projectRoot, 'scripts/auction-fact-sheet.txt'),
    factSheet,
  );
  console.log('  Fact sheet written to scripts/auction-fact-sheet.txt');

  // Step 3: Generate grades (AI)
  console.log('\nStep 3: Generating Schefter grades...');
  const article = await generateArticle(factSheet, data);
  console.log(`  Headline: ${article.headline}`);
  console.log(`  Grades: ${article.grades?.length ?? 0} teams`);

  // Step 4: Validate
  console.log('\nStep 4: Validating...');
  const errors = validateArticle(article, data);
  if (errors.length === 0) console.log('  ✓ Validation passed');

  // Step 5: Enrich with deterministic data
  console.log('\nStep 5: Enriching grades with roster data...');
  const enriched = enrichGrades(article, data);

  // Step 6: Write output
  const outputPath = path.join(projectRoot, 'scripts/auction-recap-output.json');
  await fs.writeFile(outputPath, JSON.stringify(enriched, null, 2) + '\n');
  console.log(`\n✅ Auction grades written to scripts/auction-recap-output.json`);

  // Print grade summary
  console.log('\nGrade Summary:');
  for (const g of enriched.grades) {
    const holes = g.holesRemaining.length > 0 ? ` ⚠️ ${g.holesRemaining.join(',')}` : '';
    console.log(`  ${g.grade.padEnd(3)} ${g.teamName} — ${g.playerCount} players, ${g.auctionSpendDisplay}${holes}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
