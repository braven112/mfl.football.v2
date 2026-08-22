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
    name[f.id] = f.name;
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
  lines.push(
    `  - Bye-week luck is nearly even: the gap between the most and least favoured franchise is ${release.summary.netByeSpread}.`,
  );
  lines.push(`  - Home games run ${release.summary.homeGames.min} to ${release.summary.homeGames.max} per franchise.`);
  if (release.summary.minRematchGap != null) {
    lines.push(`  - No two division rivals meet twice inside ${release.summary.minRematchGap} weeks of each other.`);
  }
  lines.push(`  - ${release.summary.games} games in total.`);
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
      doubleheaderWeeks: release.doubleheaderWeeks,
      summary: release.summary,
      releasePageUrl: leagueUrl(registry, `/${registry.slug}/schedule-release`),
    },
  };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Schedule Release
The schedule for the coming season just dropped. This is a release-day column:
energy first, analysis second. Lead with the games people will circle, not with
the methodology. The construction facts are there to reassure anyone who
suspects the draw was unfair — mention them lightly, in passing, the way a beat
writer notes the league office got something right for once. Never present the
schedule as an opinion: it is set, it is final, and every team is looking at
the same one.`);
}

export function getUserPrompt(factSheet) {
  return `Write the schedule-release column using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "intro": ["<p>Opening paragraph — the schedule is out, set the tone.</p>"],
  "sections": [
    { "heading": "Section heading", "paragraphs": ["<p>...</p>"] }
  ],
  "outro": ["<p>Closing line — point at the opener.</p>"]
}

RULES:
- Use ONLY franchise names and week numbers that appear above. Never invent a matchup.
- Give each of the four circled games its own beat — that is the spine of the column.
- Do not restate every construction fact; pick the one or two that land.
- No predictions of wins and losses. The schedule is news, not a forecast.`;
}
