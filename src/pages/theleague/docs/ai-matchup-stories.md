# AI-Generated Matchup Preview Stories

## Overview
Automatically generate personalized, AI-written preview stories for each weekly matchup. Stories should feel like ESPN-style previews with personality, stats, and storylines.

## Story Format

### Structure (80-120 words) **✨ UPDATED**
1. **NFL Matchup Focus** - Lead with key NFL games and player vs defense matchups (PRIMARY FOCUS)
2. **Team Context** - Recent performance, playoff implications
3. **Prediction** - Data-driven projection with specific scores

### Tone
- **Adam Schefter Style** - Professional NFL insider journalism
- Authoritative, factual, direct
- **PRIMARY FOCUS: NFL games that will drive fantasy scores**
- Highlight specific player vs defense matchups (e.g., "Player A facing Team B who ranks 2nd vs RBs")
- Use defensive rankings by position to identify favorable/tough matchups
- 2-3 tight paragraphs with clear breaks
- MUST include projection at the end
- De-emphasize "single elimination" and "bracket" language - just say "playoffs"
- Focus on championship implications and playoff advancement

### Example Output (Late Season - Playoff Race)
```
The playoff picture comes into sharper focus in Week 14 when the Dawg Pound
(8-5, 3rd place) hosts the Gridiron Gang (7-6, 7th place) in a matchup with
significant postseason implications. The Dawg Pound controls their own
destiny for the 3-seed, while the Gridiron Gang faces a must-win scenario -
historically, teams at 7-7 with two weeks remaining have just a 12% chance
of making the playoffs in this league format.

The Dawg Pound enters averaging 112 PPG over their last three contests,
ranking 2nd in the league during that span. Their strength lies in a top-5
QB-WR stack, though the loss of their RB1 (OUT, knee) creates a significant
vulnerability in their rushing attack. The Gridiron Gang counters with the
league's 4th-ranked scoring offense and just activated their WR1 from IR -
a timely boost for a team that's won four of five.

These teams split their season series with the home team prevailing both
times. The Gridiron Gang's recent waiver addition at flex has averaged 18+
points in three games since joining the roster, providing unexpected
production. Meanwhile, the Dawg Pound's TE has found the end zone in seven
consecutive weeks, the league's longest active streak.

With the 3-seed potentially hanging in the balance, this matchup carries
weight beyond the standings. The winner positions themselves for January
football. The loser faces an uphill climb.
```

### Example Output (Early Season - Winless Team)
```
Week 4 presents a critical juncture for the Mighty Ducks (0-3, 16th place)
as they face the Thunder Birds (2-1, 6th place) in what could define their
season trajectory. League history isn't kind to slow starts - teams beginning
0-4 have made the playoffs just 8% of the time over the past decade, making
this essentially a must-win for the Ducks.

The Thunder Birds appear to have found their rhythm, averaging 105 PPG while
allowing just 92 defensively. Their balanced attack features a top-tier RB
who's averaging 22 points per game, complemented by a reliable WR corps. The
Mighty Ducks, by contrast, rank last in scoring at 78 PPG and have struggled
with QB inconsistency - their starter has thrown multiple interceptions in
each game.

There's a path forward for the Ducks. They've faced the league's toughest
schedule through three weeks and just added a high-upside QB off waivers who
offers dual-threat capability. Their defense - featuring three top-20 players
at their positions - has kept them competitive despite offensive struggles.
The Thunder Birds counter with the league's best TE, who's averaging 19 PPG.

The Mighty Ducks' window for salvaging this season is narrowing rapidly. A
win here, coupled with a softer schedule ahead, could spark a turnaround.
Another loss likely shifts focus toward 2026 draft positioning.
```

### Example Output (Mid-Season - Trade Deadline Week)
```
With the trade deadline looming Tuesday, Week 9's matchup between the
Corsairs (5-3, 4th place) and the Renegades (4-4, 9th place) takes on
added significance. Both teams sit in the muddled middle, and how they
approach the next 48 hours could define their seasons.

The Corsairs have playoff aspirations but possess a glaring weakness at RB,
where injuries have forced them to start replacement-level options averaging
just 8 PPG - ranking 15th among playoff contenders. Their elite QB-WR tandem
(combined 50 PPG) has masked the deficiency, but championship teams in this
league average 18+ PPG from the RB position. The Renegades, meanwhile, have
three startable RBs but lack WR depth behind their aging WR1 (34 years old,
injury history).

These teams appear built to deal with each other. The Corsairs possess
expendable WR depth and desperately need backfield help. The Renegades own
surplus RB assets and a thin receiver room. The salary cap implications
favor both sides making a move.

The Renegades dropped their last two games by a combined 8 points, suggesting
they're closer than their record indicates. The Corsairs have won three
straight but face the league's toughest remaining schedule. Sunday's result,
combined with deadline decisions, will determine whether either team emerges
as a legitimate contender or begins planning for next season's draft.
```

## NFL Matchup Integration **✨ NEW**

### Overview
The AI stories now focus primarily on **NFL games** as these drive fantasy scores. Each story analyzes key players and their NFL matchups using defensive rankings.

### Data Requirements
1. **Player Rosters** - Top players on each fantasy team (by salary)
2. **NFL Schedule** - Which NFL teams play each other in the target week
3. **Defensive Rankings** - How each NFL defense ranks vs QB, RB, WR, TE

### Matchup Analysis
For each fantasy matchup, the system:
1. Identifies top 10 players on each team (by salary)
2. Looks up each player's NFL team and Week N opponent
3. Checks the opponent's defensive ranking for that position
4. Flags favorable matchups (defense ranks bottom 10) and tough matchups (defense ranks top 10)
5. Feeds top 4 matchups to AI for story generation

### Example Matchup Data
```javascript
{
  name: "Hockenson, T.J.",
  position: "TE",
  nflTeam: "MIN",
  opponent: "CHI",
  defenseRank: 24,  // CHI ranks 24th vs TE (favorable)
  isGoodMatchup: true,
  salary: 5940000
}
```

### Defensive Rankings
Rankings are by position (lower = tougher defense):
- **QB**: Which defenses are best/worst against quarterbacks
- **RB**: Which defenses shut down/allow rushing production
- **WR**: Which secondaries are lockdown/exploitable
- **TE**: Which defenses struggle with tight ends

### Implementation Files
- **[test-matchup-story-nfl.mjs](scripts/test-matchup-story-nfl.mjs)** - Enhanced generator with NFL analysis
- **[matchup-preview-example.astro](src/pages/theleague/matchup-preview-example.astro)** - Visual component with NFL matchups section

## Technical Implementation

### Architecture Overview
```
1. Data Collection → 2. NFL Matchup Analysis → 3. Story Generation → 4. Storage → 5. Display
```

### Step 1: Data Collection Script
**File:** `scripts/collect-matchup-data.mjs`

**Purpose:** Gather all relevant data for each matchup into a structured format

**Data to Collect (per matchup):**
```javascript
{
  week: 14,
  matchupId: "week14_0001_vs_0005",
  homeTeam: {
    franchiseId: "0001",
    name: "Team Name",
    owner: "Owner Name",
    record: { wins: 8, losses: 5, ties: 0 },
    standing: 3,
    pointsFor: 1234,
    pointsAgainst: 1156,
    lastThreeWeeks: [
      { week: 13, score: 112, opponent: "0003", result: "W" },
      { week: 12, score: 98, opponent: "0007", result: "L" },
      { week: 11, score: 125, opponent: "0009", result: "W" }
    ],
    streak: { type: "W", count: 2 },
    keyPlayers: [
      {
        id: "14881",
        name: "Josh Allen",
        position: "QB",
        avgPoints: 24.5,
        injuryStatus: null,
        recentlyAcquired: false
      }
      // Top 5-7 players by avg points
    ],
    injuredPlayers: [
      { name: "Player X", position: "RB", status: "OUT" }
    ],
    recentMoves: [
      {
        type: "add",
        player: "Player Y",
        date: "2025-12-05",
        context: "waiver claim for $5k"
      }
    ],
    playoffStatus: {
      inPlayoffs: true,
      seed: 3,
      gamesBack: 0,
      clinched: false
    }
  },
  awayTeam: {
    // Same structure as homeTeam
  },
  headToHeadHistory: {
    thisSeasonMatchups: [
      { week: 8, homeScore: 105, awayScore: 98 }
    ],
    allTimeRecord: {
      homeWins: 12,
      awayWins: 8,
      ties: 0,
      avgHomeScore: 102.5,
      avgAwayScore: 98.3
    }
  },
  stakes: {
    playoffImplications: true,
    rivalryGame: false,
    description: "Winner likely clinches playoff spot"
  }
}
```

**Data Sources:**
- `standings.json` - Records, rankings, playoff status
- `weekly-results.json` - Recent scores, matchup schedule
- `rosters.json` - Current rosters, key players
- `players.json` - Player details, injury status
- `transactions.json` - Recent moves (last 7-14 days)
- `salaryAdjustments.json` - Player salaries (to identify "stars")

### Step 2: Story Generation Script
**File:** `scripts/generate-matchup-stories.mjs`

**Purpose:** Use AI API to generate stories from matchup data

**Options:**

#### Option A: Claude API (Anthropic) - RECOMMENDED
**Pros:**
- Best writing quality
- Great at following tone/style guidelines
- Good at sports analysis
- You're already using Claude Code!

**Cons:**
- Costs money (but reasonable)
- Requires API key

**Cost Estimate:**
- ~1,000-2,000 tokens per story (input + output)
- 8 matchups/week × 14 weeks = 112 stories/season
- Claude Sonnet: ~$0.02-0.04 per story = ~$2-5/season
- Claude Haiku: ~$0.002-0.004 per story = ~$0.25-0.50/season

**Implementation:**
```javascript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function generateStory(matchupData) {
  const prompt = buildPrompt(matchupData); // See prompt template below

  const message = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022', // Fast and cheap
    max_tokens: 500,
    temperature: 0.8, // More creative
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  return message.content[0].text;
}
```

#### Option B: OpenAI API (GPT-4)
**Pros:**
- Also high quality
- Well-documented

**Cons:**
- Similar cost to Claude
- Might be more expensive than Haiku

**Cost Estimate:**
- Similar to Claude (~$2-5/season with GPT-4o-mini)

#### Option C: Local LLM (Ollama)
**Pros:**
- Free (no API costs)
- Full control
- Privacy

**Cons:**
- Requires local setup
- Slower generation
- Lower quality than Claude/GPT-4
- Needs decent hardware

### Season-Aware Narrative Framework

The prompt adapts based on week number and team situations:

**Weeks 1-4 (Early Season)**
- Focus: Possibilities, early trends, schedule strength
- For struggling teams: Historical comeback stats, turnaround potential
- For hot starts: Sustainability analysis, schedule difficulty ahead
- Stats: "Teams starting 0-4 have made playoffs X% of time"
- Tone: Optimistic for underdogs, cautionary for early leaders

**Weeks 5-9 (Mid-Season)**
- Focus: Playoff picture forming, strengths/weaknesses exposed
- Analyze what's working and what's not for each team
- Reference league averages to contextualize performance
- Emerging trends in scoring, injuries, roster construction

**Weeks 8-10 (Trade Deadline)**
- Focus: Roster needs, trade opportunities, buyer vs seller
- Identify specific weaknesses (RB depth, WR1, TE upgrade)
- Discuss salary cap implications
- Suggest logical trade fits between teams
- Separate contenders from pretenders

**Weeks 11-14 (Playoff Race)**
- Focus: Playoff seeding, division titles, must-win scenarios
- Playoff probability stats based on record and games remaining
- "Magic numbers" for clinching
- Tiebreaker implications
- Path to playoffs for bubble teams

**Week 15+ (Playoffs)**
- Focus: Championship implications, tournament bracket
- Historical playoff performance
- Best-ball vs studs-and-duds approaches
- Ceiling vs floor analysis

**For Eliminated Teams (Any Week)**
- Focus: Draft positioning, compensatory picks for next season
- Building for 2026 narrative
- Young player development
- Salary cap reset opportunities
- "Playing spoiler" angle if facing playoff teams

### Prompt Template (Season-Aware)

```javascript
function buildPrompt(data) {
  const { week, homeTeam, awayTeam, headToHeadHistory, stakes } = data;

  // Determine season phase and narrative focus
  const seasonPhase = getSeasonPhase(week);
  const narrativeFocus = getNarrativeFocus(seasonPhase, homeTeam, awayTeam);

  // Historical stats to include based on context
  const relevantStats = getRelevantStats(homeTeam, awayTeam, seasonPhase);

  return `You are an NFL insider writing like Adam Schefter. Write a professional,
factual 200-300 word fantasy football matchup preview for Week ${week}.

TONE & STYLE:
- Professional journalism (Adam Schefter style)
- Authoritative and analytical
- Focus on implications and stakes
- Use specific stats and data points
- Break down strengths and weaknesses
- Direct, no-nonsense approach

MATCHUP DETAILS:
Home: ${homeTeam.name} (${homeTeam.record.wins}-${homeTeam.record.losses}-${homeTeam.record.ties})
  - Standing: ${homeTeam.standing}th place
  - Points For: ${homeTeam.pointsFor} (${homeTeam.ppgRank}th in league)
  - Points Against: ${homeTeam.pointsAgainst}
  - Last 3 weeks: ${formatLastThree(homeTeam.lastThreeWeeks)}
  - Streak: ${homeTeam.streak.type}${homeTeam.streak.count}

Away: ${awayTeam.name} (${awayTeam.record.wins}-${awayTeam.record.losses}-${awayTeam.record.ties})
  - Standing: ${awayTeam.standing}th place
  - Points For: ${awayTeam.pointsFor} (${awayTeam.ppgRank}th in league)
  - Points Against: ${awayTeam.pointsAgainst}
  - Last 3 weeks: ${formatLastThree(awayTeam.lastThreeWeeks)}
  - Streak: ${awayTeam.streak.type}${awayTeam.streak.count}

SEASON CONTEXT (Week ${week}):
${narrativeFocus}

TEAM STRENGTHS/WEAKNESSES:
Home Team:
  Strengths: ${formatStrengths(homeTeam)}
  Weaknesses: ${formatWeaknesses(homeTeam)}
  Key Players: ${formatKeyPlayers(homeTeam.keyPlayers)}

Away Team:
  Strengths: ${formatStrengths(awayTeam)}
  Weaknesses: ${formatWeaknesses(awayTeam)}
  Key Players: ${formatKeyPlayers(awayTeam.keyPlayers)}

INJURIES & ROSTER MOVES:
Home: ${formatInjuriesAndMoves(homeTeam)}
Away: ${formatInjuriesAndMoves(awayTeam)}

HEAD-TO-HEAD HISTORY:
${formatH2H(headToHeadHistory)}

RELEVANT LEAGUE STATS:
${relevantStats}

PLAYOFF/DRAFT IMPLICATIONS:
${formatImplications(homeTeam, awayTeam, week)}

WRITING REQUIREMENTS:
- Exactly 80-130 words
- Lead with the biggest storyline/implication
- Include 2-3 specific statistics or data points
- Analyze both teams' strengths and weaknesses
- Reference injuries and their impact
- Discuss playoff seeding OR draft positioning (depending on team status)
- ${seasonPhase === 'trade-deadline' ? 'Mention specific roster needs/trade opportunities' : ''}
- ${seasonPhase === 'early' ? 'Include historical stat about early season records' : ''}
- ${seasonPhase === 'playoff-race' ? 'Include playoff probability or magic number if relevant' : ''}
- Predict a final score
- End with the stakes or key factor to watch
- Write in present tense
- Use exact team names provided
- Be factual and analytical, not hyped or emotional

Write the preview now:`;
}

// Helper function to determine season phase
function getSeasonPhase(week) {
  if (week <= 4) return 'early';
  if (week >= 8 && week <= 10) return 'trade-deadline';
  if (week >= 11 && week <= 14) return 'playoff-race';
  if (week >= 15) return 'playoffs';
  return 'mid-season';
}

// Helper function to generate narrative focus based on phase
function getNarrativeFocus(phase, homeTeam, awayTeam) {
  switch (phase) {
    case 'early':
      return `Early season - focus on schedule strength, early trends, and historical
      data about teams with similar starts. For struggling teams, emphasize comeback
      possibilities. Example: "Teams starting 0-4 have made playoffs 8% of the time
      in league history."`;

    case 'trade-deadline':
      return `Trade deadline week - identify specific roster weaknesses (RB depth,
      WR1 need, TE upgrade) and potential trade fits. Discuss salary cap implications
      and whether teams should be buyers or sellers based on playoff chances.`;

    case 'playoff-race':
      return `Playoff race - focus on seeding implications, must-win scenarios, magic
      numbers to clinch. Calculate playoff probabilities based on remaining schedule.
      Discuss tiebreaker scenarios if relevant.`;

    case 'playoffs':
      return `Playoff tournament - championship implications, bracket positioning,
      best strategies for playoff scoring.`;

    default:
      return `Mid-season - evaluate playoff contenders vs pretenders. Analyze what's
      working and what's not. Compare team performance to league averages.`;
  }
}

// Helper function to generate relevant stats based on context
function getRelevantStats(homeTeam, awayTeam, phase) {
  const stats = [];

  // Early season records
  if (phase === 'early') {
    if (homeTeam.record.wins === 0) {
      stats.push(`Teams starting 0-${homeTeam.record.losses} have made playoffs 8% of the time in league history`);
    }
  }

  // Playoff probability
  if (phase === 'playoff-race') {
    const homePlayoffPct = calculatePlayoffProbability(homeTeam);
    const awayPlayoffPct = calculatePlayoffProbability(awayTeam);
    stats.push(`${homeTeam.name} playoff probability: ${homePlayoffPct}%`);
    stats.push(`${awayTeam.name} playoff probability: ${awayPlayoffPct}%`);
  }

  // League averages for context
  stats.push(`League average PPG: 98.5`);
  stats.push(`League average points allowed: 98.5`);

  return stats.join('\n');
}

// Helper function to format implications
function formatImplications(homeTeam, awayTeam, week) {
  const implications = [];

  // Playoff implications
  if (homeTeam.playoffStatus.inPlayoffs) {
    implications.push(`${homeTeam.name} currently holds ${homeTeam.playoffStatus.seed} seed`);
    if (!homeTeam.playoffStatus.clinched) {
      implications.push(`Not yet clinched - needs wins to secure playoff spot`);
    }
  } else {
    const gamesBack = homeTeam.playoffStatus.gamesBack;
    if (gamesBack <= 2) {
      implications.push(`${homeTeam.name} is ${gamesBack} games back of playoffs`);
    } else {
      implications.push(`${homeTeam.name} likely out of playoff race - focus shifts to 2026 draft positioning`);
    }
  }

  return implications.join('\n');
}
```

### Calculating League Stats & Historical Data

To make stories compelling with real data, you'll need to calculate:

#### Historical Playoff Stats
Analyze past seasons to generate stats like:
- "Teams starting 0-4 have made playoffs 8% of time in league history"
- "Teams at 7-7 with 2 weeks left have 12% playoff chance"
- "No team has come back from 0-5 to make playoffs in this league"

**Implementation:**
```javascript
// scripts/calculate-league-history-stats.mjs
// Run once to analyze historical data from past seasons

function calculateStartRecordPlayoffRate(startRecord) {
  const years = ['2015', '2016', '2017', ...]; // Your league history
  let teamsWithRecord = 0;
  let teamsWhoMadePlayoffs = 0;

  for (const year of years) {
    const standings = loadJSON(`data/theleague/mfl-feeds/${year}/standings.json`);
    const playoffs = loadJSON(`data/theleague/mfl-feeds/${year}/playoff-brackets.json`);

    // For each team, check their record after week N
    // Check if they made playoffs
    // Tally results
  }

  return (teamsWhoMadePlayoffs / teamsWithRecord * 100).toFixed(0);
}

// Store in data/theleague/league-stats.json
const leagueStats = {
  historicalPlayoffRates: {
    '0-3': { playoffRate: 15, sampleSize: 45 },
    '0-4': { playoffRate: 8, sampleSize: 38 },
    '1-3': { playoffRate: 25, sampleSize: 52 },
    '3-0': { playoffRate: 85, sampleSize: 41 },
    // ... etc
  },
  championshipTeamAverages: {
    ppg: 108.5,
    rbPoints: 18.2,
    wrPoints: 24.1,
    qbPoints: 22.8,
    tePoints: 11.2
  }
};
```

#### Team Strength/Weakness Detection

Analyze rosters to identify strengths and weaknesses:

```javascript
function analyzeTeamStrengthsWeaknesses(franchiseId, rosters, players, salaries) {
  const roster = rosters.find(r => r.franchiseId === franchiseId);
  const teamPlayers = roster.players.map(pid => players[pid]);

  // Calculate position group scoring
  const positionScores = {
    QB: calculatePositionGroupScore(teamPlayers, 'QB'),
    RB: calculatePositionGroupScore(teamPlayers, 'RB'),
    WR: calculatePositionGroupScore(teamPlayers, 'WR'),
    TE: calculatePositionGroupScore(teamPlayers, 'TE')
  };

  // Compare to league averages
  const strengths = [];
  const weaknesses = [];

  if (positionScores.QB > leagueAverage.QB * 1.15) {
    strengths.push(`Elite QB play (${positionScores.QB} PPG, ${rankInLeague(positionScores.QB, 'QB')}th in league)`);
  }

  if (positionScores.RB < leagueAverage.RB * 0.85) {
    weaknesses.push(`Struggling RB room (${positionScores.RB} PPG, ranks ${rankInLeague(positionScores.RB, 'RB')}th)`);
  }

  // Check for elite combos (QB-WR stack)
  const hasEliteStack = checkForEliteStack(teamPlayers);
  if (hasEliteStack) {
    strengths.push(`Top-5 QB-WR stack (combined ${hasEliteStack.totalPoints} PPG)`);
  }

  // Check depth
  const rbDepth = teamPlayers.filter(p => p.position === 'RB' && p.avgPoints > 10).length;
  if (rbDepth < 2) {
    weaknesses.push(`Thin RB depth (only ${rbDepth} RBs averaging 10+ PPG)`);
  }

  // Check for injury concerns
  const injuredStarters = teamPlayers.filter(p => p.injuryStatus && p.avgPoints > 15);
  if (injuredStarters.length > 0) {
    weaknesses.push(`${injuredStarters.length} key starters injured`);
  }

  return { strengths, weaknesses };
}

function formatStrengths(team) {
  // Return top 2-3 strengths
  return team.strengths.slice(0, 3).join('; ');
}

function formatWeaknesses(team) {
  // Return top 2-3 weaknesses
  return team.weaknesses.slice(0, 3).join('; ');
}
```

#### Playoff Probability Calculator

Calculate real-time playoff chances:

```javascript
function calculatePlayoffProbability(team, week, standings) {
  const gamesRemaining = 14 - week;
  const currentRecord = team.record.wins;
  const playoffLine = 7; // 7 teams make playoffs

  // Simple approach: What % of win combinations lead to playoffs?
  // More complex: Monte Carlo simulation of remaining games

  // Example simple calculation:
  const currentStanding = team.standing;
  const gamesBack = standings[playoffLine - 1].wins - currentRecord;

  if (currentStanding <= playoffLine) {
    // In playoffs now
    if (gamesBack < -2) return 95; // Likely locked in
    if (gamesBack < -1) return 85;
    if (gamesBack <= 0) return 70;
  } else {
    // Outside looking in
    if (gamesBack > gamesRemaining) return 0; // Mathematically eliminated
    if (gamesBack === gamesRemaining) return 15; // Must win out
    if (gamesBack === gamesRemaining - 1) return 35;
    if (gamesBack <= 1) return 55;
  }

  return 50; // Toss-up
}
```

#### Trade Deadline Analysis

Identify roster needs for trade deadline stories:

```javascript
function identifyTradeNeeds(team, week) {
  const needs = [];

  // Position-specific needs
  if (team.weaknesses.includes('RB')) {
    needs.push({
      position: 'RB',
      severity: 'critical',
      description: 'RB depth chart is thin with injuries',
      targetProfile: 'RB2 or high-upside handcuff'
    });
  }

  // Playoff team needs (win-now mode)
  if (team.playoffStatus.inPlayoffs && week >= 8) {
    // Look for any weakness that could be upgraded
    if (team.positionRanks.TE > 10) {
      needs.push({
        position: 'TE',
        severity: 'moderate',
        description: 'TE production below league average',
        targetProfile: 'Top-10 TE for playoff push'
      });
    }
  }

  // Eliminated team (seller mode)
  if (!team.playoffStatus.inPlayoffs && team.playoffStatus.gamesBack > 2) {
    needs.push({
      type: 'rebuild',
      description: 'Should consider trading veterans for draft picks',
      assets: identifyTradableVeterans(team)
    });
  }

  return needs;
}
```

### Step 3: Storage
**File:** `data/theleague/mfl-feeds/2025/matchup-stories.json`

**Structure:**
```json
{
  "generated": "2025-12-11T10:00:00Z",
  "week": 14,
  "stories": {
    "0001": {
      "franchiseId": "0001",
      "opponent": "0005",
      "story": "When Team A faces off against...",
      "metadata": {
        "wordCount": 287,
        "generatedAt": "2025-12-11T10:00:00Z",
        "model": "claude-3-5-haiku-20241022"
      }
    },
    "0002": {
      "franchiseId": "0002",
      "opponent": "0006",
      "story": "..."
    }
    // ... all 16 franchises (8 matchups, but store from both perspectives)
  }
}
```

**Why store both perspectives?**
- Each owner sees the story from their POV on their homepage
- Story emphasizes "YOUR team" vs "THEIR team"

### Step 4: Generation Workflow

#### When to Generate?
**Option A: Build-time (Static Generation)**
- Generate during `npm run build` or scheduled cron job
- Pro: Fast page loads, no runtime cost
- Con: Stories don't update if data changes mid-week

**Option B: On-Demand (Dynamic Generation)**
- Generate when user visits homepage (with caching)
- Pro: Always fresh
- Con: API costs per request, slower page loads

**Option C: Scheduled Batch Job (RECOMMENDED)**
- Run script Monday/Tuesday before each week
- Generate all 8 matchup stories at once
- Store in JSON file
- Pages read from cached JSON
- Pro: Fresh weekly, controlled costs, fast pages
- Con: Need to remember to run it

#### Implementation: Scheduled Script

**File:** `scripts/generate-weekly-stories.mjs`

```javascript
#!/usr/bin/env node

/**
 * Generate AI preview stories for all Week N matchups
 *
 * Usage:
 *   node scripts/generate-weekly-stories.mjs
 *
 * Env vars:
 *   MFL_LEAGUE_ID - League ID (default: 13522)
 *   MFL_YEAR - Season year (default: current year)
 *   MFL_WEEK - Week number (default: current week)
 *   ANTHROPIC_API_KEY - Required for Claude API
 */

import fs from 'node:fs';
import path from 'node:path';
import { Anthropic } from '@anthropic-ai/sdk';

// 1. Load MFL data
// 2. Identify current week's matchups
// 3. For each matchup, collect data
// 4. Generate story via Claude API
// 5. Store in matchup-stories.json
// 6. Log results

async function main() {
  console.log('🏈 Generating weekly matchup preview stories...');

  // Load data
  const standings = loadJSON('standings.json');
  const weeklyResults = loadJSON('weekly-results.json');
  const rosters = loadJSON('rosters.json');
  const players = loadJSON('players.json');
  const transactions = loadJSON('transactions.json');

  // Determine current week and matchups
  const currentWeek = determineCurrentWeek(weeklyResults);
  const matchups = getMatchupsForWeek(weeklyResults, currentWeek);

  console.log(`📅 Generating stories for Week ${currentWeek}`);
  console.log(`🎮 Found ${matchups.length} matchups`);

  // Generate stories
  const stories = {};
  for (const matchup of matchups) {
    console.log(`\n✍️  Generating: ${matchup.home} vs ${matchup.away}`);

    const data = collectMatchupData(matchup, {
      standings,
      weeklyResults,
      rosters,
      players,
      transactions
    });

    const story = await generateStory(data);

    // Store from both team perspectives
    stories[matchup.home] = {
      franchiseId: matchup.home,
      opponent: matchup.away,
      story: story,
      metadata: {
        wordCount: story.split(/\s+/).length,
        generatedAt: new Date().toISOString(),
        model: 'claude-3-5-haiku-20241022'
      }
    };

    stories[matchup.away] = {
      franchiseId: matchup.away,
      opponent: matchup.home,
      story: story,
      metadata: {
        wordCount: story.split(/\s+/).length,
        generatedAt: new Date().toISOString(),
        model: 'claude-3-5-haiku-20241022'
      }
    };

    // Be nice to API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Save results
  const output = {
    generated: new Date().toISOString(),
    week: currentWeek,
    stories
  };

  const outPath = path.join(
    'data/theleague/mfl-feeds',
    process.env.MFL_YEAR || new Date().getFullYear().toString(),
    'matchup-stories.json'
  );

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved ${matchups.length} matchup stories to ${outPath}`);
  console.log(`📊 Total API calls: ${matchups.length}`);
  console.log(`💰 Estimated cost: $${(matchups.length * 0.004).toFixed(2)}`);
}

main();
```

**Run weekly via:**
- Manual: `MFL_WEEK=14 npm run generate:stories`
- Cron: `0 10 * * TUE node scripts/generate-weekly-stories.mjs`
- GitHub Actions: Schedule weekly on Tuesday mornings

### Step 5: Display on Homepage

**In Astro page:**

```astro
---
// src/pages/theleague/home.astro
import { getCurrentWeek, getStories } from '@/lib/matchup-stories';

const currentWeek = getCurrentWeek();
const stories = getStories(currentWeek);

// Get current user's franchise ID (from auth/cookie/param)
const franchiseId = Astro.locals.franchiseId || '0001';
const userStory = stories[franchiseId];
---

{userStory && (
  <section class="matchup-preview">
    <h2>This Week's Matchup - Week {currentWeek}</h2>
    <div class="story-content">
      <div class="story-text">
        {userStory.story.split('\n').map(paragraph => (
          <p>{paragraph}</p>
        ))}
      </div>
      <div class="story-meta">
        <small>AI-generated preview • Updated {formatDate(userStory.metadata.generatedAt)}</small>
      </div>
    </div>
  </section>
)}
```

## Workflow Summary

### Weekly Process
1. **Monday Evening** - MFL data updates with week's matchups
2. **Tuesday Morning** - Run `npm run generate:stories`
   - Script collects all matchup data
   - Calls Claude API for each matchup (8 calls)
   - Stores stories in JSON (~$0.03 total cost)
3. **Tuesday-Sunday** - Homepage displays generated stories
4. **Next week** - Repeat

### One-Time Setup
1. Sign up for Anthropic API key (https://console.anthropic.com/)
2. Add `ANTHROPIC_API_KEY` to `.env`
3. Install `@anthropic-ai/sdk` package
4. Create generation script
5. Add to `package.json`: `"generate:stories": "node scripts/generate-weekly-stories.mjs"`
6. Test with current week
7. Add to weekly routine (or automate)

## Cost Analysis

### Season Costs (Claude Haiku)
- 8 matchups/week × 14 regular season weeks = 112 stories
- ~1,500 tokens per story (1,000 input + 500 output)
- Claude Haiku pricing: $0.25/1M input, $1.25/1M output
- Input cost: 112 × 1,000 × $0.25/1M = $0.03
- Output cost: 112 × 500 × $1.25/1M = $0.07
- **Total season: ~$0.10**

### Season Costs (Claude Sonnet - Higher Quality)
- Same calculation with Sonnet pricing ($3/$15 per 1M)
- Input cost: 112 × 1,000 × $3/1M = $0.34
- Output cost: 112 × 500 × $15/1M = $0.84
- **Total season: ~$1.18**

**Recommendation:** Start with Haiku (basically free), upgrade to Sonnet if quality isn't good enough.

## Advanced Features (Future)

### Personalization
- Analyze owner's team strengths/weaknesses
- Reference specific players by name
- Adjust tone based on rivalry games
- Include trash talk for certain matchups

### Multi-Format Stories
- Short version (100 words) for mobile
- Long version (500 words) with deep analysis
- Social media version (280 chars for Twitter/X)
- Email newsletter version with images

### Interactive Elements
- "Key matchup" player vs player comparison
- Embedded charts (scoring trends)
- Injury report callouts with player headshots
- Click to expand for more stats

### Historical Context
- Reference memorable past matchups
- Season storylines (revenge tour, worst to first, etc.)
- Owner vs owner history and records

### Voice/Audio
- Generate text-to-speech narration
- Podcast-style preview
- Alexa/Google Home integration

## Questions to Answer

1. **Tone preference?** Professional, humorous, dramatic, or mix?
2. **Length?** 200 words (quick read) or 500 words (deep dive)?
3. **Update frequency?** Weekly only, or re-generate if injuries change?
4. **Manual review?** Auto-publish or human approval before showing?
5. **Fallback?** What to show if generation fails? (Use previous week, generic template, skip?)

## Implementation Status **✨ UPDATED - API INTEGRATION COMPLETE**

### ✅ Completed
1. **Anthropic API Setup** - API key configured in `.env`
2. **Test Script** - [test-matchup-story-nfl.mjs](scripts/test-matchup-story-nfl.mjs) generates NFL-enhanced stories
3. **NFL Matchup Analysis** - Player vs defense analysis with rankings
4. **Visual Component** - [matchup-preview-example.astro](src/pages/theleague/matchup-preview-example.astro) with scoreboard and matchup cards
5. **Tone Refinement** - 80-120 word limit, Adam Schefter style, championship focus
6. **Data Integration** - Rosters, players, standings, weekly results
7. **Cost Optimization** - Using Claude 3.5 Haiku (~$0.002 per story)
8. **NFL Data Service** - [nfl-data-service.mjs](scripts/nfl-data-service.mjs) with real API integration
   - ✅ ESPN API for NFL schedule, game times, broadcast channels
   - ✅ Weather.gov API for real-time weather forecasts by stadium
   - ✅ Defensive rankings by position (QB, RB, WR, TE)
   - ✅ Data caching for performance (1-hour cache)
9. **TV Network Logos** - Using actual network logos from `/assets/tv-logos/` folder
   - ABC, CBS, ESPN, FOX, Prime Video, Netflix, YouTube TV
10. **Player Headshots** - ESPN CDN integration for player photos
11. **NFL Team Logos** - ESPN CDN integration for team logos
12. **Game Details** - Time, day, channel, weather, temperature, conditions for every game

### 🚧 In Progress
1. **Weekly Generation Script** - Build full automation for all matchups
2. **Defensive Rankings Enhancement** - Implement FantasyPros API for real-time rankings (currently using cached data)

### 📋 Next Steps

1. **Build Weekly Generation**
   - Extend test script to generate all 8 matchups per week
   - Add to `package.json` scripts
   - Store in `matchup-stories.json`

2. **Integrate into Homepage**
   - Display story on owner-specific homepage
   - Add "Key NFL Matchups" visual section with real data
   - Include team icons and defensive rankings

3. **Automate**
   - Schedule weekly generation (Tuesday mornings)
   - GitHub Actions or cron job
   - Error handling and notifications

4. **Enhance Defensive Rankings**
   - Implement FantasyPros API or ESPN Fantasy API
   - Update rankings weekly based on actual performance
   - Add context (yards allowed, TDs allowed, etc.)

5. **Additional Enhancements**
   - Include Vegas lines for NFL games
   - Show injury reports with player status
   - Add "key player matchup" analysis with detailed stats
