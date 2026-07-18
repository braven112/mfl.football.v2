/**
 * The Gauntlet — weekly schedule-strength column (Wednesday, both leagues).
 *
 * Unlike the other article types, the numbers are NOT computed here: the
 * Wednesday workflow runs scripts/compute-schedule-strength.mjs first, and
 * this module reads the derived JSON it wrote. Article and dashboard render
 * from the same file, so they can never disagree. The AI only adds voice.
 *
 * Note on weeks: the runner passes `week` = last COMPLETED week. The Gauntlet
 * issue is named for the UPCOMING week (completed + 1), matching the derived
 * file `schedule-strength-<year>-w<completed+1>.json`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isRegularSeasonOrPlayoffs } from '../article-utils/season-guards.mjs';
import { resolveMainRepo } from '../article-utils/data-loaders.mjs';
import { LEAGUES } from '../../src/config/leagues-data.mjs';

function leagueMeta(league) {
  const reg = LEAGUES[league];
  if (!reg) throw new Error(`Unknown league: ${league}`);
  return {
    dataRoot: reg.dataPath,
    baseUrl: `/${reg.slug}`,
    displayName: reg.name,
    // Apex domain for the absolute GroupMe link.
    publicOrigin: `https://${reg.domains[0]}`,
  };
}

const gauntletWeek = (week) => week + 1;

export const config = {
  id: (year, week, league = 'theleague') =>
    `sf_${year}_gauntlet_w${String(gauntletWeek(week)).padStart(2, '0')}_${league === 'theleague' ? 'tl' : 'afl'}`,
  requiredData: [],
  postType: 'article',
  tier: 'analysis',
  maxTokens: 3000,
};

export function guardSeason(week, year, now, { completedWeek }) {
  return isRegularSeasonOrPlayoffs(completedWeek);
}

async function loadDerived(projectRoot, league, year, week) {
  const meta = leagueMeta(league);
  const mainRepo = resolveMainRepo(projectRoot);
  const file = path.join(
    mainRepo, meta.dataRoot, 'derived',
    `schedule-strength-${year}-w${String(gauntletWeek(week)).padStart(2, '0')}.json`
  );
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function buildFactSheet(data, week, year, projectRoot, { league = 'theleague' } = {}) {
  const meta = leagueMeta(league);
  const derived = await loadDerived(projectRoot, league, year, week);

  if (!derived.runIn?.length) {
    throw new Error(`Derived schedule-strength file for ${league} ${year} w${gauntletWeek(week)} has no run-in data.`);
  }

  const lines = [];
  lines.push(`THE GAUNTLET — Week ${derived.week} Schedule Strength — ${meta.displayName} (${year} Season)`);
  lines.push('');
  lines.push('Difficulty is 0-100: the average strength of a team\'s remaining opponents');
  lines.push('(50% opponent season scoring, 25% all-play record, 25% recent form).');
  lines.push('Higher = harder road ahead.');
  lines.push('');

  lines.push('=== REMAINING-SCHEDULE RANKINGS (hardest first) ===');
  for (const r of derived.runIn) {
    const trend = r.trendDeltaRanks == null
      ? ''
      : r.trendDeltaRanks > 0
        ? ` (up ${r.trendDeltaRanks} — got harder)`
        : r.trendDeltaRanks < 0
          ? ` (down ${Math.abs(r.trendDeltaRanks)} — got easier)`
          : ' (unchanged)';
    lines.push(`  ${r.rank}. ${r.name} — difficulty ${r.difficulty}, remaining opp PPG ${r.remainingOppPpg ?? 'n/a'}${trend}`);
  }
  lines.push('');

  lines.push('=== SCHEDULE LUCK (record vs schedule played) ===');
  for (const l of derived.scheduleLuck) {
    lines.push(l.direction === 'unlucky'
      ? `  ${l.name}: ${l.record} against a brutal slate (past difficulty ${l.pastDifficulty}) — better than the record`
      : `  ${l.name}: ${l.record} against a soft slate (past difficulty ${l.pastDifficulty}) — record flatters them`);
  }
  lines.push('');

  const traps = derived.trapWeeks.filter(t => t.avgDifficulty != null);
  if (traps.length > 0) {
    const worst = traps.reduce((a, b) => (b.avgDifficulty > a.avgDifficulty ? b : a));
    lines.push('=== TRAP WEEK ===');
    lines.push(`  Week ${worst.week} is the league-wide wall: average opponent difficulty ${worst.avgDifficulty}.`);
    lines.push('');
  }

  const withTrend = derived.runIn.filter(r => r.trendDeltaRanks != null);
  let riser = null, faller = null;
  if (withTrend.length > 0) {
    riser = withTrend.reduce((a, b) => (b.trendDeltaRanks > a.trendDeltaRanks ? b : a));
    faller = withTrend.reduce((a, b) => (b.trendDeltaRanks < a.trendDeltaRanks ? b : a));
    lines.push('=== MOVERS ===');
    if (riser.trendDeltaRanks > 0) lines.push(`  Biggest riser (schedule got harder): ${riser.name}, up ${riser.trendDeltaRanks} spots`);
    if (faller.trendDeltaRanks < 0) lines.push(`  Biggest faller (schedule got easier): ${faller.name}, down ${Math.abs(faller.trendDeltaRanks)} spots`);
    lines.push('');
  }

  const hardest = derived.runIn[0];
  const easiest = derived.runIn[derived.runIn.length - 1];
  const luckiest = derived.scheduleLuck.find(l => l.direction === 'lucky') ?? null;

  return {
    factSheet: lines.join('\n'),
    enrichment: {
      league,
      year: derived.year,
      week: derived.week,
      hardest: { name: hardest.name, difficulty: hardest.difficulty },
      easiest: { name: easiest.name, difficulty: easiest.difficulty },
      luckiest: luckiest ? { name: luckiest.name, record: luckiest.record } : null,
      dashboardPath: `${meta.baseUrl}/schedule-strength`,
    },
  };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: The Gauntlet (Weekly Schedule-Strength Column)
This is YOUR named weekly analytics column — own it. Lead with the single
spiciest finding (a contender walking into a buzz saw, a record built on a
soft schedule, a trap week). Frame difficulty numbers as roads ahead:
gauntlets, breathers, buzz saws, cupcake runs. Reference specific teams and
numbers from the fact sheet only. Close by pointing readers at the full
dashboard (heat map + week-by-week grid). Do NOT invent matchups, records,
or numbers not in the fact sheet.`);
}

export function getUserPrompt(factSheet) {
  return `Write this week's edition of The Gauntlet using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars) that leads with the week's spiciest schedule-strength finding",
  "excerpt": "2-3 sentence teaser for the feed card. Hook the reader.",
  "content": ["<p>Lead paragraph — the biggest story in the rankings.</p>", "<p>Who has the hardest road and what it means.</p>", "<p>Schedule luck — whose record is lying.</p>", "<p>Trap week / movers.</p>", "<p>Closer — point to the full dashboard.</p>"]
}

INSTRUCTIONS:
- 4-5 content paragraphs.
- Every team name and number must come from the fact sheet.
- Voice: high-energy beat reporter who built the model himself and trusts it.`;
}

export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!aiOutput.content || aiOutput.content.length < 2) errors.push('Too few content paragraphs');
  return errors;
}

export function buildPost(aiOutput, enrichment, articleId, { league = 'theleague' } = {}) {
  const meta = leagueMeta(league);
  return {
    id: articleId,
    timestamp: new Date().toISOString(),
    type: 'article',
    category: 'articles',
    tier: config.tier,
    headline: aiOutput.headline,
    body: aiOutput.excerpt,
    franchiseIds: [],
    link: `${meta.baseUrl}/news/${articleId}`,
    linkLabel: 'Read The Gauntlet',
    league,
    authorId: 'claude',
    content: aiOutput.content,
    // Pointer the article page uses to render the rankings table, luck
    // callout, and trap-weeks strip from the same derived JSON.
    scheduleStrength: { year: enrichment.year, week: enrichment.week },
  };
}

/**
 * One teaser stat + the article link — never a summary. Returning a falsy
 * value skips the promo. The runner only calls this when the feed write
 * actually happened this run.
 */
export function buildGroupMePromo(post, enrichment, { league = 'theleague' } = {}) {
  const meta = leagueMeta(league);
  const { hardest, easiest, week } = enrichment;
  if (!hardest || !easiest) return null;
  return (
    `🚨 THE GAUNTLET — Week ${week}. Nobody has a rougher road ahead than ` +
    `${hardest.name} (difficulty ${hardest.difficulty}/100). ${easiest.name} gets the cupcake run. ` +
    `Full rankings + week-by-week heat map:\n${meta.publicOrigin}${post.link}`
  );
}
