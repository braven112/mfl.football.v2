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
import { LEAGUES, leagueUrl, DEFAULT_LEAGUE_SLUG } from '../../src/config/leagues-data.mjs';
import { primaryLink, linkList } from '../article-utils/article-links.mjs';

function leagueMeta(league) {
  const reg = LEAGUES[league];
  if (!reg) throw new Error(`Unknown league: ${league}`);
  return {
    dataRoot: reg.dataPath,
    baseUrl: `/${reg.slug}`,
    displayName: reg.name,
    /**
     * Absolute URL for a feed path. leagueUrl pins the canonical (cookie-safe)
     * host AND drops the league prefix the path carries for the shared host —
     * hand-concatenating an origin with `/theleague/news/…` ships
     * `theleague.us/theleague/news/…`, which only resolves via a 301.
     */
    publicUrl: (p) => leagueUrl(reg, p),
  };
}

const gauntletWeek = (week) => week + 1;

/** How many of the hardest schedules the column names. */
const HARDEST_COVERED = 3;
/** Two paragraphs, three at most — and each one short (owner's call, Oct 2026). */
const MAX_PARAGRAPHS = 3;
const MAX_PARAGRAPH_CHARS = 320;

export const config = {
  // League token comes from the registry's navSlug so ids stay unique if a
  // third league ever appears (a hardcoded binary suffix would collide).
  id: (year, week, league = 'theleague') =>
    `sf_${year}_gauntlet_w${String(gauntletWeek(week)).padStart(2, '0')}_${LEAGUES[league]?.navSlug ?? league}`,
  requiredData: [],
  postType: 'article',
  tier: 'analysis',
  maxTokens: 1200,
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

  // A missing derived file or an empty run-in (season over, no remaining
  // weeks) is a clean skip, not an error — returning null tells the runner
  // to exit quietly instead of failing the workflow at season end.
  let derived;
  try {
    derived = await loadDerived(projectRoot, league, year, week);
  } catch {
    console.log(`  [skip] No derived schedule-strength file for ${league} ${year} w${gauntletWeek(week)}.`);
    return null;
  }
  if (!derived.runIn?.length) {
    console.log(`  [skip] ${league} ${year} w${gauntletWeek(week)} has no remaining schedule (season complete).`);
    return null;
  }

  // The column is two short paragraphs about the top of the table and its
  // bottom, sitting under the rankings chart (owner's call, Oct 2026: the old
  // five-paragraph rundown of luck, trap weeks and movers went unread). So the
  // fact sheet carries ONLY what the copy may cover — handing the model the
  // full table is how every team ended up named. The chart shows the rest.
  const hardest = derived.runIn[0];
  const easiest = derived.runIn[derived.runIn.length - 1];
  const top = derived.runIn.slice(0, HARDEST_COVERED);
  const trendNote = (r) => r.trendDeltaRanks == null || r.trendDeltaRanks === 0
    ? ''
    : r.trendDeltaRanks > 0
      ? ` (up ${r.trendDeltaRanks} — got harder)`
      : ` (down ${Math.abs(r.trendDeltaRanks)} — got easier)`;
  const row = (r) => `  ${r.rank}. ${r.name} — difficulty ${r.difficulty}, remaining opp PPG ${r.remainingOppPpg ?? 'n/a'}${trendNote(r)}`;

  const lines = [];
  lines.push(`THE GAUNTLET — Week ${derived.week} Schedule Strength — ${meta.displayName} (${year} Season)`);
  lines.push('');
  lines.push('Difficulty is 0-100: how strong a team\'s remaining opponents are. Higher = harder road ahead.');
  lines.push(`${derived.runIn.length} teams ranked; the full table is shown above the column.`);
  lines.push('');
  lines.push('=== HARDEST REMAINING SCHEDULES ===');
  for (const r of top) lines.push(row(r));
  lines.push('');
  if (!top.includes(easiest)) {
    lines.push('=== EASIEST REMAINING SCHEDULE ===');
    lines.push(row(easiest));
    lines.push('');
  }

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

export function getSystemPrompt({ league = DEFAULT_LEAGUE_SLUG, persona } = {}) {
  return buildCachedSystem(`\n\nARTICLE TYPE: The Gauntlet (Weekly Schedule-Strength Column)
This is YOUR named weekly analytics column — own it, and keep it SHORT.
The rankings chart sits directly above your copy, so readers already see
every team: your job is two quick paragraphs, not a rundown. Name the 2-3
hardest roads ahead and, briefly, the easiest one. Frame difficulty as roads
ahead: gauntlets, buzz saws, cupcake runs. Use only teams and numbers from
the fact sheet. Do NOT invent matchups, records, or numbers.`, { league, persona });
}

export function getUserPrompt(factSheet) {
  return `Write this week's edition of The Gauntlet using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars) that leads with the week's spiciest schedule-strength finding",
  "excerpt": "One sentence teaser for the feed card.",
  "content": ["<p>The 2-3 hardest remaining schedules, with their difficulty numbers.</p>", "<p>The easiest road, and a pointer to the full rankings.</p>"]
}

INSTRUCTIONS:
- EXACTLY 2 content paragraphs (3 only if truly needed). Never more.
- Each paragraph is 2 short sentences, under 50 words. No lists of every team.
- Do not cover schedule luck, trap weeks or movers — the page shows those.
- Every team name and number must come from the fact sheet.
- Voice: high-energy beat reporter who built the model himself and trusts it.`;
}

/**
 * Characters a reader sees: everything outside `<…>` tags. A length count only
 * — the result is never rendered, so this is deliberately not a sanitizer (a
 * regex tag-strip here is what CodeQL reads as one).
 */
function visibleLength(html) {
  let n = 0;
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) n++;
  }
  return n;
}

export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!aiOutput.content || aiOutput.content.length < 2) errors.push('Too few content paragraphs');
  if (aiOutput.content?.length > MAX_PARAGRAPHS) errors.push(`More than ${MAX_PARAGRAPHS} paragraphs (extras are dropped)`);
  for (const [i, p] of (aiOutput.content ?? []).entries()) {
    const chars = visibleLength(String(p));
    if (chars > MAX_PARAGRAPH_CHARS) errors.push(`Paragraph ${i + 1} is ${chars} chars (max ${MAX_PARAGRAPH_CHARS})`);
  }
  return errors;
}

/**
 * Where this article points, and which parts of the site it plugs.
 *
 * The column is the prose half of a rankings table that lives on its own page
 * (and is embedded above and below the copy by GauntletArticleSection). It
 * carries the primary link and no feature plugs: in a two-paragraph column
 * every plug costs a sentence, and the old five-paragraph edition spent one on
 * each of trade builder, free agents, playoffs and transactions.
 *
 * The pipeline calls this on every run. `applyArticleLinks` injects the
 * PRIMARY link if the model drops it and strips any href the model invented;
 * the `featureLink` plugs are never injected, only offered — see
 * article-links.mjs for why a forced plug is worse than no plug. Plugs for
 * pages a league does not have resolve to null and `linkList` drops them, so
 * this one list serves every league.
 */
export function relatedLinks(_enrichment, { league = 'theleague' } = {}) {
  return linkList(
    primaryLink(league, 'schedule-strength', {
      label: 'the Gauntlet rankings',
      cta: 'The full remaining-schedule rankings are on the Gauntlet page.',
    }),
  );
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
    // Hard cap: validate() only warns, and a sixth paragraph is exactly the
    // column the owner asked to stop publishing.
    content: (aiOutput.content ?? []).slice(0, MAX_PARAGRAPHS),
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
  // One sentence and a link — the column does the talking (owner's call,
  // Oct 2026). `easiest` stays a precondition: an edition without both ends
  // of the table is not a finished column.
  return (
    `🚨 The Gauntlet, Week ${week}: nobody has a rougher road ahead than ` +
    `${hardest.name} (${hardest.difficulty}/100) ▸ ${meta.publicUrl(post.link)}`
  );
}
