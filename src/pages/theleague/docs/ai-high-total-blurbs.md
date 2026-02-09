# High-Total NFL Blurbs Prompt

Use this prompt set to generate sub-100-character betting-style hooks for NFL games with high projected totals. Keep this separate from the longer matchup-preview prompt in `ai-matchup-stories.md`.

## System Message
```
You write ultra-tight betting-style blurbs. No filler. Direct, data-led, and under 100 characters per blurb.
```

## User Message Template
```
Given this pre-filtered high-total games JSON (from the data step):

<INSERT JSON FROM getHighTotalGames HERE>

Write one blurb per game. Each blurb must:
- Be <100 characters; if any blurb is 100+ chars, reject and rewrite shorter.
- Focus on the top 1-2 angles: high team total, pace mismatch, red-zone edge, key injury, weather if impactful.
- Only include the top 1–2 angles (e.g., injury impact, defensive ranking, weather). Drop everything else.
- No narratives; output a single sentence fragment. No fluff, no markdown, no filler.

Return JSON only (no markdown). Output contract per item:
{
  "matchup": "KC @ LV",
  "hook": "Mahomes faces 30+ total, LV 30th vs deep ball",
  "teamTotal": 31.2,          // higher of the two team totals provided
  "combinedTotal": 59.0,      // from input
  "keyStat": "LV 30th vs deep passes", // optional, brief
  "chars": 74
}

Expect an array of these objects:
[
  {
    "matchup": "...",
    "hook": "...",
    "teamTotal": 0,
    "combinedTotal": 0,
    "keyStat": "...",
    "chars": 0
  }
]

Constraints: JSON array only. Fields per item: matchup, hook, teamTotal, combinedTotal, keyStat (optional), chars (<100). No extra text.
```
