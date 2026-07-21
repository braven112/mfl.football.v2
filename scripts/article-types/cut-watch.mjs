/**
 * Cut Watch — Teams over the 22-man active roster limit.
 * Runs Sundays 8am PT during the cut window (Jul 15 – Aug 16).
 *
 * Fact sheet: Teams over limit with player-level cut candidates. Candidates
 * are ranked by combined value — redraft/dynasty ADP blended by contract
 * length (1yr = pure redraft … 5yr = pure dynasty) — with salary as the
 * fallback when the ADP feeds are unavailable.
 * AI output: { headline, excerpt, content: string[] }
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadTeams, flipName, normalizePosition, formatDefName, formatSalary, resolveDataDir } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isCutWindow } from '../article-utils/season-guards.mjs';
import { LEAGUES, leagueOrigin, DEFAULT_LEAGUE_SLUG } from '../../src/config/leagues-data.mjs';
import { getAugustCutdownDay, calendarDaysUntilCutdown, ptDateParts } from '../lib/august-cutdown.mjs';
import { getRedisConfig, redisCommand } from '../lib/redis.mjs';
import { normalizeFranchiseId } from '../../src/utils/franchise-id.mjs';

// TheLeague's active-roster cap. Cut-watch is TheLeague-only today (the
// August cutdown machinery it reports on doesn't exist for AFL); if that
// changes, this limit must come from the league config, not a const.
const ACTIVE_ROSTER_LIMIT = 22;

// Sort score for players absent from both ADP lists — nobody drafts them
// anywhere, so they're the most cuttable. A plain number (not Infinity) so
// the sort comparator stays NaN-free when two unranked players meet.
const UNRANKED_SCORE = 10_000;

/**
 * Combined-value score for a rostered player: redraft and dynasty ADP
 * blended by contract length. A 1-year player is valued purely on redraft
 * ADP, a 5-year player purely on dynasty ADP, and everything between is a
 * linear mix (2yr = 25% dynasty, 3yr = 50%, 4yr = 75%).
 *
 * Returns { blended, dynastyWeight, redraftAdp, dynastyAdp } where blended
 * is null when the player appears in neither list (treat as most cuttable).
 * When only one list has the player, that list stands in for both sides —
 * a missing feed must not out-punish an actually-bad ranking.
 */
export function blendedCutValue({ redraftAdp, dynastyAdp, contractYears }) {
  const years = Math.min(5, Math.max(1, Number.isFinite(contractYears) ? contractYears : 1));
  const dynastyWeight = (years - 1) / 4;
  const r = Number.isFinite(redraftAdp) ? redraftAdp : null;
  const d = Number.isFinite(dynastyAdp) ? dynastyAdp : null;
  if (r === null && d === null) {
    return { blended: null, dynastyWeight, redraftAdp: null, dynastyAdp: null };
  }
  const rSide = r ?? d;
  const dSide = d ?? r;
  return {
    blended: rSide * (1 - dynastyWeight) + dSide * dynastyWeight,
    dynastyWeight,
    redraftAdp: r,
    dynastyAdp: d,
  };
}

/**
 * Load the prebuild-fetched MFL ADP feeds as Map<playerId, averagePick>.
 * Returns null when unavailable — the fact sheet then falls back to the
 * pre-blend salary ordering rather than failing the article.
 */
/** Fact-sheet suffix explaining a candidate's combined-value score. */
function describeValue(value) {
  if (!value) return '';
  if (value.blended === null) return ' — UNRANKED in league-wide ADP (nobody drafts him)';
  const pct = Math.round(value.dynastyWeight * 100);
  const fmt = (n) => (n === null ? 'n/a' : n.toFixed(1));
  return ` — combined ADP ${value.blended.toFixed(1)} (${pct}% dynasty weight; redraft ${fmt(value.redraftAdp)}, dynasty ${fmt(value.dynastyAdp)})`;
}

async function loadAdpMaps(projectRoot, year, league) {
  try {
    const dir = resolveDataDir(projectRoot, year, league);
    const read = async (name) => {
      const raw = JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), 'utf8'));
      const map = new Map();
      for (const p of raw?.adp?.player ?? []) {
        const pick = parseFloat(p.averagePick);
        if (p.id && Number.isFinite(pick)) map.set(`${p.id}`, pick);
      }
      return map;
    };
    const [redraft, dynasty] = await Promise.all([read('adp-redraft'), read('adp-dynasty')]);
    if (redraft.size === 0 && dynasty.size === 0) return null;
    return { redraft, dynasty };
  } catch (err) {
    console.warn(`  [cut-watch] ADP feeds unavailable (${err.message}) — falling back to salary-based cut candidates`);
    return null;
  }
}

export const config = {
  id: (year, week) => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `sf_${year}_cut_watch_${mm}${dd}`;
  },
  requiredData: ['rosters', 'players', 'league'],
  postType: 'article',
  tier: 'standard',
  maxTokens: 4000,
};

export function guardSeason(week, year, now) {
  return isCutWindow(now);
}

/**
 * Cutdown-plan status for the over-limit franchises, read from the autocut
 * Redis keys. Key format: autocut:{fid} = JSON { year, playerIds, updatedAt }
 * — the same contract src/utils/autocut-storage.ts writes and
 * apply-august-cuts.mjs executes at the deadline. These keys are
 * TheLeague-only (no league prefix); callers must not use this for other
 * leagues. Returns Map<fid, markedCount>, or null when Redis is
 * unreachable — plan intel is additive, the article runs without it.
 *
 * PRIVACY (august-cuts plan decision #10): counts only. The marked player
 * ids NEVER enter the fact sheet, so the AI cannot leak an owner's actual
 * cut list into a league-visible article.
 */
async function loadCutdownPlans(fids) {
  const redis = getRedisConfig();
  if (!redis) return null;
  const planYear = ptDateParts().year;
  const plans = new Map();
  try {
    for (const fid of fids) {
      const raw = await redisCommand(redis, ['GET', `autocut:${normalizeFranchiseId(fid)}`]);
      let list = raw;
      if (typeof raw === 'string') {
        try { list = JSON.parse(raw); } catch { list = null; }
      }
      const marked =
        list && typeof list === 'object' && list.year === planYear && Array.isArray(list.playerIds)
          ? list.playerIds.length
          : 0;
      plans.set(fid, marked);
    }
  } catch (err) {
    console.warn(`  [cut-watch] could not read cutdown plans (${err.message}) — omitting plan intel`);
    return null;
  }
  return plans;
}

export async function buildFactSheet(data, week, year, projectRoot, opts = {}) {
  const players = new Map();
  for (const p of data.players.players.player) {
    if (p.id) {
      const pos = normalizePosition(p.position);
      const isDef = pos === 'Def';
      players.set(p.id, {
        name: isDef ? formatDefName(p.name) : flipName(p.name),
        position: pos,
        team: p.team,
      });
    }
  }

  const league = opts.league ?? DEFAULT_LEAGUE_SLUG;
  const teams = await loadTeams(projectRoot, league);

  // Combined-value rankings (opts.adp is a test seam — pass { redraft, dynasty }
  // Maps or null to bypass the feed read).
  const adp = opts.adp !== undefined ? opts.adp : await loadAdpMaps(projectRoot, year, league);

  const lines = [];
  const now = new Date();
  lines.push(`CUT WATCH — ${LEAGUES[league].name} (${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})`);
  lines.push(`Active roster limit: ${ACTIVE_ROSTER_LIMIT} players`);
  lines.push('');

  const overLimit = [];
  const atLimit = [];
  const underLimit = [];

  for (const f of data.rosters.rosters?.franchise || []) {
    const fid = f.id;
    const teamInfo = teams.get(fid);
    const playerList = Array.isArray(f.player) ? f.player : (f.player ? [f.player] : []);

    // Count active roster players (status: ROSTER)
    const activeRoster = playerList.filter(p => p.status === 'ROSTER');
    const count = activeRoster.length;
    const over = count - ACTIVE_ROSTER_LIMIT;

    // Position breakdown + combined-value score per player
    const positionCounts = {};
    const rosterDetails = activeRoster.map(p => {
      const info = players.get(p.id);
      const pos = info?.position ?? '??';
      positionCounts[pos] = (positionCounts[pos] || 0) + 1;
      const contractYear = parseInt(p.contractYear || 1, 10);
      const value = adp
        ? blendedCutValue({
            redraftAdp: adp.redraft.get(`${p.id}`),
            dynastyAdp: adp.dynasty.get(`${p.id}`),
            contractYears: contractYear,
          })
        : null;
      return {
        name: info?.name ?? `Player ${p.id}`,
        position: pos,
        // `|| 0` also catches NaN from a malformed salary string, which
        // would otherwise poison the sort comparators.
        salary: parseInt(parseFloat(p.salary || 0), 10) || 0,
        contractYear,
        value,
      };
    });

    // Cut candidates: weakest combined value first (unranked players top the
    // list), salary/contract as tiebreakers. Without ADP feeds, fall back to
    // the pre-blend heuristic (lowest salary, shortest contract).
    const cutCandidates = adp
      ? [...rosterDetails].sort((a, b) =>
          (b.value.blended ?? UNRANKED_SCORE) - (a.value.blended ?? UNRANKED_SCORE) ||
          a.salary - b.salary ||
          a.contractYear - b.contractYear)
      : [...rosterDetails].sort((a, b) => a.salary - b.salary || a.contractYear - b.contractYear);

    const entry = {
      fid,
      name: teamInfo?.name ?? `Team ${fid}`,
      count,
      over,
      positionCounts,
      cutCandidates: cutCandidates.slice(0, Math.max(over + 2, 3)),
    };

    if (over > 0) overLimit.push(entry);
    else if (over === 0) atLimit.push(entry);
    else underLimit.push(entry);
  }

  // Cutdown-plan intel for over-limit teams (opts.cutdownPlans is a test
  // seam — pass a Map or null to bypass the live Redis read). The autocut:*
  // keys are TheLeague-only and unprefixed, so any other league skips plan
  // intel entirely rather than reading TheLeague's plans for its own fids.
  // Also gated to the cut window: outside it (manual --week dispatch) the
  // calendar-year vs league-year clocks can disagree and every owner would
  // read as "NONE ON FILE" against a not-yet-written plan year.
  const plans = opts.cutdownPlans !== undefined
    ? opts.cutdownPlans
    : (league === DEFAULT_LEAGUE_SLUG && isCutWindow(now)
        ? await loadCutdownPlans(overLimit.map((e) => e.fid))
        : null);

  if (overLimit.length > 0) {
    lines.push('=== TEAMS OVER THE LIMIT ===');
    if (adp) {
      lines.push('Cut candidates are ranked by COMBINED VALUE: redraft and dynasty ADP');
      lines.push('blended by contract length (1yr = pure redraft, 5yr = pure dynasty).');
      lines.push('Higher blended ADP = weaker hold; "unranked" = drafted in no leagues anywhere.');
      lines.push('');
    }
    for (const e of overLimit.sort((a, b) => b.over - a.over)) {
      lines.push(`── ${e.name}: ${e.count} active players (${e.over} over limit) ──`);
      const posParts = Object.entries(e.positionCounts).map(([p, c]) => `${c} ${p}`).join(', ');
      lines.push(`  Positions: ${posParts}`);
      if (plans) {
        const marked = plans.get(e.fid) ?? 0;
        if (marked >= e.over) {
          lines.push(`  Cutdown plan: FILED — this owner has already marked ${marked} player${marked === 1 ? '' : 's'} for auto-cut (plans made, covers the overage)`);
        } else if (marked > 0) {
          lines.push(`  Cutdown plan: PARTIAL — ${marked} of ${e.over} needed cuts marked; auto-cut picks the remaining ${e.over - marked} newest-acquisition-first at the deadline`);
        } else {
          lines.push(`  Cutdown plan: NONE ON FILE — this owner has not made their picks; all ${e.over} cuts would be auto-chosen at the deadline`);
        }
      }
      lines.push(adp
        ? `  Likely cut candidates (weakest combined value first):`
        : `  Likely cut candidates (lowest salary):`);
      for (const c of e.cutCandidates) {
        lines.push(`    - ${c.position} ${c.name} (${formatSalary(c.salary)}, ${c.contractYear}yr)${describeValue(c.value)}`);
      }
      lines.push('');
    }
  } else {
    lines.push('=== ALL TEAMS AT OR UNDER THE LIMIT ===');
    lines.push('No teams are currently over the active roster limit.');
    lines.push('');
  }

  if (atLimit.length > 0) {
    lines.push('=== TEAMS AT THE LIMIT ===');
    for (const e of atLimit) {
      lines.push(`  ${e.name}: ${e.count} active (exactly at limit)`);
    }
    lines.push('');
  }

  if (underLimit.length > 0) {
    lines.push('=== TEAMS UNDER THE LIMIT ===');
    for (const e of underLimit.sort((a, b) => a.over - b.over)) {
      lines.push(`  ${e.name}: ${e.count} active (${Math.abs(e.over)} under)`);
    }
    lines.push('');
  }

  return {
    factSheet: lines.join('\n'),
    enrichment: {
      // Worst offenders first — buildGroupMePromo prefers the worst offender
      // WITHOUT a filed plan. hasPlan is null when plan intel was unavailable.
      overLimit: [...overLimit]
        .sort((a, b) => b.over - a.over)
        // hasPlan means the plan COVERS the overage — a token 1-of-6 plan
        // still leaves 5 cuts to the newest-first auto-picker, so the owner
        // hasn't really "made their picks" and stays call-out eligible.
        .map(({ fid, name, count, over }) => ({
          name,
          count,
          over,
          hasPlan: plans ? (plans.get(fid) ?? 0) >= over : null,
          markedCount: plans ? (plans.get(fid) ?? 0) : null,
        })),
    },
  };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Cut Watch
Channel the urgency of NFL roster cut day. Name names — who's on the chopping block? Which teams are in the toughest spots? Who has easy decisions vs. gut-wrenching ones? Talk about salary implications of keeping vs. cutting players.`);
}

export function getUserPrompt(factSheet) {
  return `Write a cut watch article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "content": ["<p>Paragraph 1...</p>", "<p>Paragraph 2...</p>"]
}

INSTRUCTIONS:
- Write 3-5 content paragraphs.
- Focus on teams that are over the roster limit.
- If the fact sheet shows cutdown-plan status, LEAD with the over-limit teams
  marked "NONE ON FILE" — those owners haven't made their picks yet, and they
  are the story. Call them out by team name for procrastinating with the
  deadline looming.
- Teams marked "FILED" have already made their plans — give them credit for
  having their affairs in order and shift the heat to the procrastinators.
- NEVER name or guess which players are in a FILED plan — plans are private.
  Your "likely cut candidates" list is salary-based speculation and fair
  game, but never present it as an owner's actual list.
- Name specific players who could be cut and why. The candidates are ranked
  by COMBINED VALUE — redraft and dynasty ADP blended by contract length
  (1-year players are judged purely on redraft value, 5-year players purely
  on dynasty value). Lean on it: a player UNRANKED in league-wide ADP is dead
  weight nobody would draft; a strong blended ADP means that roster spot is
  probably safe.
- Discuss which cuts are easy (unranked, low salary, redundant) vs. painful.
- If no teams are over the limit, write about who's cutting it close.
- Every name and number must come from the fact sheet.`;
}

export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!aiOutput.content || aiOutput.content.length < 2) errors.push('Too few content paragraphs');
  return errors;
}

/**
 * One teaser stat + the article link — never a summary (same contract as
 * schedule-strength.mjs; a falsy return skips the promo). Fires only when at
 * least one team is over the limit: the article itself runs every Sunday of
 * the Jul 15 – Aug 16 window, but an "everyone is compliant" ping would buzz
 * the whole chat for a non-story.
 *
 * `now` is injectable for tests only — the runner never passes it.
 */
export function buildGroupMePromo(post, enrichment, { league = 'theleague', now = new Date() } = {}) {
  const overLimit = enrichment?.overLimit ?? [];
  if (overLimit.length === 0) return null;

  // Canonical host (cookie-safe) via leagueOrigin — never domains[0] ad hoc,
  // or links in GroupMe open logged-out (session cookies are host-only).
  const publicOrigin = leagueOrigin(LEAGUES[league]);
  const totalExcess = overLimit.reduce((sum, t) => sum + t.over, 0);

  // Prefer to call out the worst offender WITHOUT a filed cutdown plan —
  // owners who already made their picks get credit, not the spotlight.
  // hasPlan is null when plan intel was unavailable (falls back to worst
  // offender overall, pre-plan-intel behavior). Sorted defensively — don't
  // rely on the enrichment already being worst-first.
  const sorted = [...overLimit].sort((a, b) => b.over - a.over);
  const noPlan = sorted.filter((t) => t.hasPlan === false);
  const planned = sorted.filter((t) => t.hasPlan === true);
  const worst = noPlan[0] ?? sorted[0];

  const descriptor = worst.hasPlan === false
    ? ' with NO cutdown plan on file'
    : (sorted.length > 1 && worst === sorted[0] ? ', the deepest hole in the league' : '');

  const { year } = ptDateParts(now);
  const deadlineDay = getAugustCutdownDay(year);
  const daysLeft = calendarDaysUntilCutdown(year, now);
  // Deadline already passed (reachable only via manual dispatch / --week
  // override outside the window): a "deadline day" ping would be flatly
  // wrong — skip the promo rather than buzz the chat with stale urgency.
  if (daysLeft < 0) return null;
  const countdown = daysLeft > 0
    ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} to comply`
    : 'deadline day';

  let spread = '';
  if (overLimit.length > 1) {
    spread = ` ${overLimit.length} teams still need to shed ${totalExcess} players combined`;
    if (planned.length > 0) {
      spread += ` — ${planned.length} ${planned.length === 1 ? 'has' : 'have'} already made their picks`;
    }
    spread += '.';
  } else if (worst.hasPlan === true) {
    spread = ' The cutdown plan is already filed — the guillotine drops itself at the deadline.';
  }

  return (
    `🚨 CUT WATCH — ${worst.name}: ${worst.over} over the ${ACTIVE_ROSTER_LIMIT}-man limit` +
    `${descriptor}.${spread} ` +
    `Cutdown is Aug ${deadlineDay} (${countdown}). Today's chopping block:\n` +
    `${publicOrigin}${post.link}`
  );
}

export function buildPost(aiOutput, enrichment, articleId, { league = DEFAULT_LEAGUE_SLUG } = {}) {
  const slug = LEAGUES[league].slug;
  return {
    id: articleId,
    timestamp: new Date().toISOString(),
    type: 'article',
    category: 'articles',
    tier: config.tier,
    headline: aiOutput.headline,
    body: aiOutput.excerpt,
    franchiseIds: [],
    link: `/${slug}/news/${articleId}`,
    linkLabel: 'Read cut watch',
    league: slug,
    authorId: 'claude',
    content: aiOutput.content,
  };
}
