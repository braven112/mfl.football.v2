/**
 * Generate AI-powered game blurbs for a specific fantasy team's perspective
 * Uses Anthropic API to create contextual analysis for each NFL game
 */

import Anthropic from '@anthropic-ai/sdk';

export interface GameBlurbRequest {
  nflTeam1: string;
  nflTeam2: string;
  myPlayers: { name: string; position: string; projection: number }[];
  oppPlayers: { name: string; position: string; projection: number }[];
  myTeamName: string;
  oppTeamName: string;
  gameInfo: { day: string; time: string; channel?: string };
}

export interface GameBlurb {
  nflMatchup: string;
  blurb: string;
  chars: number;
}

/**
 * Generate contextual blurbs for NFL games from a specific team's perspective
 */
export async function generateGameBlurbs(
  games: GameBlurbRequest[],
  apiKey?: string
): Promise<GameBlurb[]> {
  if (!apiKey) {
    console.warn('[generate-blurbs] No API key provided, returning empty blurbs');
    return [];
  }

  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are writing contextual NFL game analysis for a fantasy football playoff matchup.

CRITICAL RULES:
- NEVER mention players not listed in the data for that specific game
- NEVER use "strategy" language - use outcome/impact language instead
- Focus ONLY on the players actually playing in THIS game
- Analyze potential outcomes, not strategies
- Write from the perspective of ONE team (use "you" and "your players")

Each blurb must:
- Focus on the fantasy implications of THIS specific NFL game
- Reference ONLY the players shown in the game data
- Be 150-200 characters (player names shown separately, don't repeat)
- Analyze the potential impact/outcome for the matchup
- Use second-person ("your", "you") when referring to the viewing team's players
- Avoid words like "strategy", "lineup", "game plan" - use "potential", "impact", "outcome" instead`;

  const gamesData = games.map(g => ({
    nflMatchup: `${g.nflTeam1} @ ${g.nflTeam2}`,
    yourPlayers: g.myPlayers.map(p => `${p.name} (${p.position}, proj: ${p.projection.toFixed(1)})`),
    opponentPlayers: g.oppPlayers.map(p => `${p.name} (${p.position}, proj: ${p.projection.toFixed(1)})`),
    gameInfo: `${g.gameInfo.day} ${g.gameInfo.time}${g.gameInfo.channel ? ', ' + g.gameInfo.channel : ''}`
  }));

  const userPrompt = `NFL GAMES WITH YOUR FANTASY PLAYERS:
${JSON.stringify(gamesData, null, 2)}

Generate a contextual analysis for each NFL game from the viewing team's perspective. Each blurb should:
1. Focus on YOUR players and how they match up against the opponent's players
2. Highlight what to watch for in this game
3. Be 150-200 chars total
4. Explain why this game matters to YOUR matchup outcome
5. Use second-person ("your", "you") when referring to the viewing team
6. Provide game flow analysis tied to fantasy implications

Return JSON only (no markdown):
[
  {
    "nflMatchup": "SF @ LAR",
    "blurb": "Your players have favorable matchups here. High-scoring divisional battle could give you the edge if game script plays out as projected.",
    "chars": 145
  }
]

Constraints: Array of objects only. Fields: nflMatchup, blurb (150-200 chars), chars. No extra text.`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from API');
    }

    // Parse JSON from response
    const text = content.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[generate-blurbs] Could not parse JSON from response:', text);
      return [];
    }

    const blurbs = JSON.parse(jsonMatch[0]) as GameBlurb[];
    return blurbs;
  } catch (error) {
    console.error('[generate-blurbs] Error generating blurbs:', error);
    return [];
  }
}
