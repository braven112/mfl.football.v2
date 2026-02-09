#!/usr/bin/env node

/**
 * Test script to generate one AI matchup story
 * Proof of concept for Week 15 playoff matchup
 */

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// Load .env file manually
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Load environment variables
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY environment variable');
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY
});

// Helper to load JSON files
function loadJSON(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

// Load data
console.log('📊 Loading league data...');
const standings = loadJSON('data/theleague/mfl-feeds/2025/standings.json');
const weeklyResults = loadJSON('data/theleague/mfl-feeds/2025/weekly-results.json');
const league = loadJSON('data/theleague/mfl-feeds/2025/league.json');

// Get franchise info
function getFranchiseInfo(franchiseId) {
  const standing = standings.leagueStandings.franchise.find(f => f.id === franchiseId);
  if (!standing) return null;

  // Parse record
  const [wins, losses, ties] = standing.h2hwlt.split('-').map(Number);

  // Get last 3 weeks scores
  const last3Weeks = weeklyResults.weeks
    .filter(w => w.week >= 12 && w.week <= 14)
    .map(w => ({
      week: w.week,
      score: w.scores[franchiseId]
    }));

  // Calculate projection based on recent performance (last 3 weeks average)
  const recentScores = last3Weeks.map(w => w.score).filter(s => s > 0);
  const projection = recentScores.length > 0
    ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length
    : parseFloat(standing.avgpf);

  return {
    id: franchiseId,
    name: standing.fname,
    record: { wins, losses, ties },
    standing: parseInt(standing.vp),
    pointsFor: parseFloat(standing.pf),
    pointsAgainst: parseFloat(standing.pa),
    avgPF: parseFloat(standing.avgpf),
    avgPA: parseFloat(standing.avgpa),
    streak: standing.strk,
    last3Weeks,
    powerRanking: parseFloat(standing.pwr),
    projection: projection
  };
}

// Format helper functions
function formatLastThree(weeks) {
  return weeks.map(w => `Week ${w.week}: ${w.score.toFixed(1)} pts`).join(', ');
}

function getSeasonPhase(week) {
  if (week <= 4) return 'early';
  if (week >= 8 && week <= 10) return 'trade-deadline';
  if (week >= 11 && week <= 14) return 'playoff-race';
  if (week >= 15) return 'playoffs';
  return 'mid-season';
}

function getNarrativeFocus(phase) {
  switch (phase) {
    case 'playoffs':
      return `Playoff tournament - focus on championship implications, playoff positioning,
      and stakes. Analyze which team has the edge and what it takes to advance to the
      next round. Winner keeps title hopes alive, loser continues in consolation playoffs.`;
    case 'playoff-race':
      return `Playoff race - focus on seeding implications, must-win scenarios, magic
      numbers to clinch. Calculate playoff probabilities based on remaining schedule.`;
    default:
      return `Mid-season - evaluate what's working and what's not for each team.`;
  }
}

// Build the prompt
function buildPrompt(homeTeam, awayTeam, week) {
  const seasonPhase = getSeasonPhase(week);
  const narrativeFocus = getNarrativeFocus(seasonPhase);

  return `You are an NFL insider writing like Adam Schefter. Write a professional,
factual 80-120 word fantasy football playoff matchup preview for Week ${week}.

TONE & STYLE:
- Professional journalism (Adam Schefter style)
- Authoritative and analytical
- Focus on implications and stakes
- Use specific stats and data points
- Break down strengths and weaknesses
- Direct, no-nonsense approach
- IMPORTANT: Use clear paragraph breaks for readability (2-3 tight paragraphs)
- Be EXTREMELY concise - every word must count

MATCHUP DETAILS:
Home: ${homeTeam.name} (${homeTeam.record.wins}-${homeTeam.record.losses}, ${homeTeam.standing}th in standings)
  - Seed: 4 (in Championship Bracket)
  - Points For: ${homeTeam.pointsFor.toFixed(1)} (${homeTeam.avgPF.toFixed(1)} PPG average)
  - Points Against: ${homeTeam.pointsAgainst.toFixed(1)} (${homeTeam.avgPA.toFixed(1)} PPG average)
  - Last 3 weeks: ${formatLastThree(homeTeam.last3Weeks)}
  - Current streak: ${homeTeam.streak}
  - Power ranking: ${homeTeam.powerRanking.toFixed(1)}
  - Week 15 Projection: ${homeTeam.projection.toFixed(1)} points

Away: ${awayTeam.name} (${awayTeam.record.wins}-${awayTeam.record.losses}, ${awayTeam.standing}th in standings)
  - Seed: 5 (in Championship Bracket)
  - Points For: ${awayTeam.pointsFor.toFixed(1)} (${awayTeam.avgPF.toFixed(1)} PPG average)
  - Points Against: ${awayTeam.pointsAgainst.toFixed(1)} (${awayTeam.avgPA.toFixed(1)} PPG average)
  - Last 3 weeks: ${formatLastThree(awayTeam.last3Weeks)}
  - Current streak: ${awayTeam.streak}
  - Power ranking: ${awayTeam.powerRanking.toFixed(1)}
  - Week 15 Projection: ${awayTeam.projection.toFixed(1)} points

PROJECTION:
Based on recent form (last 3 weeks average), ${homeTeam.name} projects to ${homeTeam.projection.toFixed(1)} points vs ${awayTeam.name}'s ${awayTeam.projection.toFixed(1)} points.
Projected outcome: ${homeTeam.projection > awayTeam.projection ? homeTeam.name : awayTeam.name} by ${Math.abs(homeTeam.projection - awayTeam.projection).toFixed(1)} points

SEASON CONTEXT (Week ${week}):
${narrativeFocus}

PLAYOFF STAKES:
- First-round playoff game
- Winner advances to face the 1-seed in Week 16 semifinals
- Loser drops to consolation playoffs, continues playing for final standings placement
- Both teams fought all season to reach this point
- 16-team league, only top 7 make the playoffs

LEAGUE CONTEXT:
- League average PPG: ~98.5
- These teams are very evenly matched based on seeding
- Both teams earned home playoff games through regular season performance

WRITING REQUIREMENTS:
- STRICT WORD COUNT: 80-130 words (no more, no less)
- Use 2-3 tight paragraphs with clear breaks between them
- Lead with the biggest storyline (playoff stakes)
- Include 2-3 key statistics only
- Focus on what matters most - recent form, scoring, stakes
- Emphasize single-elimination stakes
- MUST include the projection/prediction at the end
- Format prediction like: "Projection: [Team Name] [projected score]-[projected score]"
- End with the prediction
- Write in present tense
- Use exact team names provided
- Be EXTREMELY concise - cut all fluff
- Every sentence must deliver value
- Sound like Adam Schefter - tight, factual, authoritative with data-driven prediction

Write the preview now:`;
}

// Generate story
async function generateStory(homeTeam, awayTeam, week) {
  console.log(`\n✍️  Generating story for Week ${week}...`);
  console.log(`   ${awayTeam.name} (${awayTeam.record.wins}-${awayTeam.record.losses})`);
  console.log(`   @ ${homeTeam.name} (${homeTeam.record.wins}-${homeTeam.record.losses})`);
  console.log('');

  const prompt = buildPrompt(homeTeam, awayTeam, week);

  console.log('🤖 Calling Claude API...');

  const message = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 250,
    temperature: 0.8,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  return message.content[0].text;
}

// Main
async function main() {
  console.log('🏈 AI Matchup Story Generator - Test\n');

  // Week 15 Playoff Game: 4-seed (0013) vs 5-seed (0015)
  const week = 15;
  const homeTeam = getFranchiseInfo('0013');
  const awayTeam = getFranchiseInfo('0015');

  if (!homeTeam || !awayTeam) {
    console.error('Failed to load team data');
    process.exit(1);
  }

  try {
    const story = await generateStory(homeTeam, awayTeam, week);

    console.log('\n' + '='.repeat(80));
    console.log('GENERATED STORY');
    console.log('='.repeat(80) + '\n');
    console.log(story);
    console.log('\n' + '='.repeat(80));

    // Stats
    const wordCount = story.split(/\s+/).length;
    console.log(`\n📊 Story Stats:`);
    console.log(`   Word count: ${wordCount}`);
    console.log(`   Model: claude-3-5-haiku-20241022`);
    console.log(`   Estimated cost: ~$0.002`);

    // Save to file
    const output = {
      generated: new Date().toISOString(),
      week,
      matchup: {
        home: homeTeam.name,
        away: awayTeam.name
      },
      story,
      metadata: {
        wordCount,
        model: 'claude-3-5-haiku-20241022',
        generatedAt: new Date().toISOString()
      }
    };

    const outPath = 'data/theleague/test-matchup-story.json';
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\n💾 Saved to: ${outPath}`);

  } catch (error) {
    console.error('\n❌ Error generating story:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    process.exit(1);
  }
}

main();
