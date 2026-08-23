/**
 * Schedule Release — Schefter's release-day column.
 *
 * WHEN IT FIRES. Not on the calendar, and not when the reveal locks. It fires
 * once the commissioner's paste has actually LANDED in MFL and the live
 * schedule matches the schedule the league was shown. That ordering is the
 * whole point: announcing a schedule nobody can open yet, or analysing one
 * that turned out not to be what got pasted, is worse than announcing late.
 *
 * MFL has no schedule write API, so the paste is a human step of unknown
 * duration — the commissioner may reveal on release day and paste that
 * evening, or three days later. The guard below just waits for the feed to
 * agree with the reveal, which also means each league announces on its own
 * schedule with no second date to maintain.
 *
 * ALL DATA IS PRE-RESOLVED HERE. The AI is handed a fact sheet of names,
 * weeks and numbers and only adds voice — it never reads a franchise id or
 * decides which games matter. The marquee four come from the LOCKED reveal, so
 * the column headlines exactly the games the page showed.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { resolveMainRepo } from '../article-utils/data-loaders.mjs';
import { LEAGUES, leagueUrl } from '../../src/config/leagues-data.mjs';
import {
  describeSeries,
  rivalryPairKey,
  rivalrySeriesByPair,
} from '../../src/utils/rivalry-intensity.mjs';
import { RIVALRY_MEETINGS_TO_MENTION } from '../../src/utils/schedule-release.mjs';
import { SCHEDULE_POLICY } from '../../src/utils/schedule-plan.mjs';
import {
  describeDivisionByeSplit,
  divisionByeSplit,
  scheduleConstraints,
  TIER_LABEL,
} from '../../src/utils/schedule-constraints.mjs';
import { primaryLink, articleLink, featureLink, linkList } from '../article-utils/article-links.mjs';

export const config = {
  // One per league per season. The league token comes from the registry so a
  // third league could never collide with a hardcoded binary suffix.
  id: (year, _week, league = 'theleague') =>
    `sf_${year}_schedule_release_${LEAGUES[league]?.navSlug ?? league}`,
  requiredData: ['league', 'schedule'],
  postType: 'article',
  tier: 'breaking',
  maxTokens: 4000,
};

/**
 * No week or season window — a schedule release happens in the offseason, when
 * `completedWeek` refers to a season that finished months ago. The real gate is
 * in buildFactSheet, which needs the reveal AND the matching live schedule.
 */
export function guardSeason() {
  return true;
}

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const pairKey = (a, b) => [a, b].sort().join('-');

/** Every matchup in a schedule feed, keyed by week, as order-free pair keys. */
function scheduleFingerprint(weeklySchedule, lastWeek) {
  const byWeek = new Map();
  for (const week of asArray(weeklySchedule)) {
    const w = Number(week.week);
    if (!Number.isInteger(w) || w < 1 || w > lastWeek) continue;
    const pairs = [];
    for (const m of asArray(week.matchup)) {
      const sides = asArray(m.franchise);
      if (sides.length !== 2 || sides[0].id === sides[1].id) continue;
      pairs.push(pairKey(sides[0].id, sides[1].id));
    }
    if (pairs.length) byWeek.set(w, pairs.sort().join('|'));
  }
  return byWeek;
}

function releaseFingerprint(weeks) {
  const byWeek = new Map();
  for (const [w, games] of Object.entries(weeks)) {
    byWeek.set(Number(w), games.map((g) => pairKey(g.away, g.home)).sort().join('|'));
  }
  return byWeek;
}

/** Does the live schedule match the reveal, week for week? */
function pasteHasLanded(live, revealed) {
  if (live.size !== revealed.size || live.size === 0) return false;
  for (const [week, sig] of revealed) {
    if (live.get(week) !== sig) return false;
  }
  return true;
}

export async function buildFactSheet(data, week, year, projectRoot, { league = 'theleague' } = {}) {
  const registry = LEAGUES[league];
  const mainRepo = resolveMainRepo(projectRoot);

  // The locked reveal — the archive scripts/lock-schedule-release.mjs commits.
  const archive = path.join(mainRepo, registry.dataPath, 'schedule-release', `${year}.json`);
  let release;
  try {
    release = JSON.parse(await fs.readFile(archive, 'utf8'));
  } catch {
    console.log(`  [skip] no locked reveal at ${path.relative(mainRepo, archive)} — nothing to announce yet.`);
    return null;
  }

  const meta = data.league?.league;
  if (!meta) {
    console.log('  [skip] league feed missing.');
    return null;
  }
  const lastWeek = Number(meta.lastRegularSeasonWeek);

  // The gate: has the commissioner's paste landed, and is it the schedule the
  // league was actually shown? A feed that still carries last season's
  // schedule, or a different one, means we wait.
  const live = scheduleFingerprint(data.schedule?.schedule?.weeklySchedule, lastWeek);
  if (!pasteHasLanded(live, releaseFingerprint(release.weeks))) {
    console.log('  [skip] the revealed schedule is not live in MFL yet — waiting for the paste.');
    return null;
  }

  const name = {};
  const divisionName = {};
  for (const d of asArray(meta.divisions?.division)) divisionName[d.id] = d.name;
  const divisionOf = {};
  for (const f of asArray(meta.franchises?.franchise)) {
    // MFL stores a few franchise names with a stray leading/trailing space.
    name[f.id] = String(f.name ?? '').trim();
    divisionOf[f.id] = divisionName[String(f.division)] ?? String(f.division);
  }

  const lines = [];
  lines.push(`LEAGUE: ${meta.name}`);
  lines.push(`SEASON: ${year}`);
  lines.push(`REGULAR SEASON: Weeks 1-${lastWeek}`);
  lines.push(`DOUBLEHEADER WEEKS: ${release.doubleheaderWeeks.join(', ')}`);
  lines.push(`WEEKS WITH NO NFL BYES: ${release.byeFreeWeeks.join(', ')}`);
  lines.push('');
  lines.push('THE FOUR GAMES TO CIRCLE (these are the ones the league was shown on release day):');
  for (const m of release.marquee) {
    lines.push(`  Week ${m.week}: ${m.awayName} at ${m.homeName}${m.why.length ? ` — ${m.why.join(', ')}` : ''}`);
  }
  lines.push('');
  lines.push('HOW THE SCHEDULE WAS BUILT (facts, already verified — do not recompute):');
  lines.push(`  - Every doubleheader avoids NFL bye weeks.`);
  lines.push(
    `  - ${release.summary.byeFreeDivisionGames} of a possible ${release.summary.divisionGameCeiling} division games fall in weeks with no NFL byes.`,
  );
  // The bye-free count alone reads as a clean sweep. State the OTHER side of
  // it — how many division games are on a bye and why — or the column
  // implies a promise the schedule does not make. `divisionGames` is absent
  // on reveals locked before it was recorded; the column simply omits the
  // line rather than guessing a denominator.
  const byeSplit = divisionByeSplit({
    total: release.summary.divisionGames,
    byeFree: release.summary.byeFreeDivisionGames,
    ceiling: release.summary.divisionGameCeiling,
  });
  if (byeSplit) {
    lines.push(
      `  - The other ${byeSplit.onByes} of ${byeSplit.total} division games (${byeSplit.percent}%) DO fall on ` +
        `NFL bye weeks: ${describeDivisionByeSplit(byeSplit)}. Do not call this a scheduling failure.`,
    );
  }
  lines.push(
    `  - Bye-week luck is nearly even: the gap between the most and least favoured franchise is ${release.summary.netByeSpread}.`,
  );
  lines.push(`  - Home games run ${release.summary.homeGames.min} to ${release.summary.homeGames.max} per franchise.`);
  if (release.summary.minRematchGap != null) {
    lines.push(`  - No two division rivals meet twice inside ${release.summary.minRematchGap} weeks of each other.`);
  }
  lines.push(`  - ${release.summary.games} games in total.`);
  lines.push('');
  // The precedence, not just the rules. Nearly every "why is my schedule like
  // this" question is answered by a higher-ranked rule beating a lower one,
  // and a column that lists the goals without the order cannot give that
  // answer. Shared with the reveal page so the two cannot drift.
  lines.push('THE CONSTRAINTS, IN PRIORITY ORDER (each one yields to every one above it):');
  for (const c of scheduleConstraints({ crossConference: Boolean(SCHEDULE_POLICY[league]?.crossConference) })) {
    lines.push(`  ${c.rank}. [${TIER_LABEL[c.tier]}] ${c.rule}`);
    lines.push(`     ${c.why}`);
  }
  // THE RIVALRY RENEWALS. Ranked by the same intensity formula the rivalry
  // pages use (`rivalry-intensity.mjs`) so the column and the site agree about
  // who a franchise's real rival is. Records are rendered through
  // `describeSeries`, never formatted here — the stored record belongs to
  // whichever id sorts first, so hand-formatting it prints the wrong team
  // winning the series.
  const historyFile = path.join(mainRepo, registry.dataPath, 'derived', 'franchise-history.json');
  let series = {};
  try {
    const history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
    series = rivalrySeriesByPair(history.franchises ?? history);
  } catch {
    // A league with no ingested head-to-head simply gets no rivalry section.
  }
  const renewals = [];
  const seenPair = new Set();
  for (const [w, games] of Object.entries(release.weeks)) {
    for (const g of games) {
      const key = rivalryPairKey(g.away, g.home);
      const s = series[key];
      if (!s || s.games < RIVALRY_MEETINGS_TO_MENTION) continue;
      // A pairing plays twice in a division; the FIRST meeting is the renewal.
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      // Null for a DISPUTED series — the two stored copies of that pairing
      // disagree, so there is no record to hand the model. Dropping the whole
      // renewal is right: a line naming two teams with no record is an
      // invitation to invent one, and this sheet is the only thing standing
      // between the column and a made-up head-to-head.
      const described = describeSeries(s, g.away, g.home, (id) => name[id]);
      if (!described) continue;
      renewals.push({
        week: Number(w),
        line: `  Week ${w}: ${name[g.away] ?? g.away} at ${name[g.home] ?? g.home} — ${described}`,
        intensity: s.intensity,
      });
    }
  }
  if (renewals.length) {
    renewals.sort((x, y) => y.intensity - x.intensity);
    lines.push('');
    lines.push('THE RIVALRIES THIS SCHEDULE RENEWS (most charged first — all-time records under the CURRENT owners):');
    for (const r of renewals.slice(0, 8)) lines.push(r.line);
    lines.push(
      `  (${renewals.length} pairings in this schedule have met ${RIVALRY_MEETINGS_TO_MENTION}+ times.)`,
    );
  }

  lines.push('');
  lines.push('OPENING WEEK:');
  for (const g of release.weeks['1'] ?? []) {
    lines.push(`  ${name[g.away] ?? g.away} at ${name[g.home] ?? g.home}`);
  }
  lines.push('');
  lines.push(`FINAL WEEK (Week ${lastWeek}) — division games decide the season:`);
  for (const g of release.weeks[String(lastWeek)] ?? []) {
    const rivalry = divisionOf[g.away] === divisionOf[g.home] ? ' (division)' : '';
    lines.push(`  ${name[g.away] ?? g.away} at ${name[g.home] ?? g.home}${rivalry}`);
  }

  return {
    factSheet: lines.join('\n'),
    enrichment: {
      league,
      year,
      marquee: release.marquee,
      rivalryRenewals: renewals.length,
      doubleheaderWeeks: release.doubleheaderWeeks,
      summary: release.summary,
      releasePageUrl: leagueUrl(registry, `/${registry.slug}/schedule-release`),
    },
  };
}

/**
 * Shape check on the model's JSON. Warnings only — the pipeline logs them and
 * still publishes, matching every other article type.
 */
export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!Array.isArray(aiOutput.content) || aiOutput.content.length < 2) errors.push('Too few content paragraphs');
  return errors;
}

/**
 * Where this article points, and which parts of the site it plugs.
 *
 * The whole reason release day is an event: the reveal page shows the locked
 * schedule week by week, and the column announcing it is worthless if the
 * reader cannot get there. This is the link the 2026 column shipped without.
 *
 * The plugs are the release-day ones — a schedule people have just seen is
 * what sends them to the rivalry pages, the calendar, and their throwback era.
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
    primaryLink(league, 'schedule-release', {
      label: 'the full schedule release',
      cta: 'Go see the whole thing, week by week, on the schedule release page.',
    }),
    articleLink(league, 'rivalries', { label: 'the rivalry pages' }),
    featureLink(league, 'calendar'),
    featureLink(league, 'throwback-settings'),
    featureLink(league, 'schedule-strength'),
  );
}

/**
 * The feed post. `content` is a flat array of `<p>` strings, which is what the
 * news page renders (`post.content?.map(p => <p set:html={p} />)`) — it has no
 * concept of sections, so a nested shape would have published an article that
 * renders as nothing.
 */
export function buildPost(aiOutput, enrichment, articleId, { league = 'theleague' } = {}) {
  const registry = LEAGUES[league];
  return {
    id: articleId,
    timestamp: new Date().toISOString(),
    type: 'article',
    category: 'articles',
    tier: config.tier,
    headline: aiOutput.headline,
    body: aiOutput.excerpt,
    // The four circled games, so the feed card can badge the franchises in it.
    franchiseIds: [...new Set((enrichment?.marquee ?? []).flatMap((m) => [m.away, m.home]))],
    link: `/${registry.slug}/news/${articleId}`,
    linkLabel: 'Read the schedule breakdown',
    league,
    authorId: 'claude',
    content: aiOutput.content,
  };
}

/**
 * GroupMe promo — the chat's version of the tease.
 *
 * Names the four games rather than summarising them, because the chat is where
 * owners argue about the draw and a game with two names in it is the thing
 * that starts that. The link goes LAST and carries no trailing punctuation:
 * GroupMe autolinks a sentence-ending period into the href and 404s it for
 * every owner (docs/claude/rules/league-urls.md). `leagueUrl` is already
 * applied in buildFactSheet, so this never concatenates an origin with a path.
 */
export function buildGroupMePromo(post, enrichment, { league = 'theleague' } = {}) {
  const registry = LEAGUES[league];
  if (!registry || !enrichment?.marquee?.length) return null;
  const games = enrichment.marquee
    .map((m) => `  Wk ${m.week}: ${m.awayName} at ${m.homeName}`)
    .join('\n');
  const dh = enrichment.doubleheaderWeeks?.length
    ? ` Doubleheaders in Weeks ${enrichment.doubleheaderWeeks.join(', ')}, none of them on an NFL bye.`
    : '';
  return (
    `📅 THE ${enrichment.year} SCHEDULE IS OUT. Every matchup is live in MFL.` +
    `${dh}\n\nFour to circle:\n${games}\n\n` +
    `Schefter's full breakdown:\n${leagueUrl(registry, post.link)}`
  );
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Schedule Release
The schedule for the coming season just dropped. This is a release-day column:
energy first, analysis second. Lead with the games people will circle, not with
the methodology. The construction facts are there to reassure anyone who
suspects the draw was unfair — mention them lightly, in passing, the way a beat
writer notes the league office got something right for once. Never present the
schedule as an opinion: it is set, it is final, and every team is looking at
the same one.

BYE-WEEK DIVISION GAMES ARE NOT A SCANDAL. The fact sheet gives both numbers:
how many division games dodge the NFL byes and how many do not. Some leagues
CANNOT get to zero — the format runs out of bye-free weeks before it runs out
of division games — and where the fact sheet says a count is forced, say so or
say nothing. Never write that the league office failed to avoid a bye week it
had no way to avoid, and never round the awkward number away. The constraint
list is in priority order for exactly this reason: if the schedule breaks a
stated goal, a higher-ranked rule beat it, and that is the story.

RIVALRIES ARE THE STORY. A schedule is a list of dates until you say who is
playing whom and what happened the last dozen times. The fact sheet ranks the
pairings this schedule renews, with all-time records — use them. A game between
two teams that have split twenty meetings is worth more words than a
construction fact. Cite the record when you name a rivalry; never estimate one,
and never say a team leads a series unless the fact sheet says so.`);
}

export function getUserPrompt(factSheet) {
  return `Write the schedule-release column using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "content": [
    "<p>Opening paragraph — the schedule is out, set the tone.</p>",
    "<p>...</p>",
    "<p>Closing line — point at the opener.</p>"
  ]
}

RULES:
- "content" is a flat array of 6-10 standalone <p> paragraphs. No headings, no nesting.
- Use ONLY franchise names and week numbers that appear above. Never invent a matchup.
- Give each of the four circled games its own beat — that is the spine of the column.
- Devote a section to the rivalry renewals, using the all-time records exactly as written.
  Quote a record verbatim or not at all — do not recompute, round, or flip it.
- If a game falls in Throwback Week, say so: those franchises play it in their old identities.
- Do not restate every construction fact; pick the one or two that land.
- No predictions of wins and losses. The schedule is news, not a forecast.`;
}
