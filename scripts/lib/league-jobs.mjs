/**
 * Which leagues each recurring job runs for — read off the registry
 * (src/config/leagues-data.mjs), never listed in a workflow.
 *
 * A launched league joins a job the moment its registry entry qualifies, with
 * no workflow edit. The rule the owner set (Oct 2026): DATA jobs run for every
 * league that syncs from MFL; AI / column jobs run only for a league whose
 * checkbox turns that feature on, so ticking a box is also the opt-in to its
 * Claude cost.
 *
 * Workflows read this through scripts/league-jobs.mjs; prebuild imports it.
 * tests/league-jobs.test.ts pins today's leagues per job, so a predicate edit
 * that silently drops or adds a league fails there first.
 *
 * Not here on purpose: the Schefter GroupMe scanners (rumor scan, transaction
 * scan, lineup reminders). Each league posts through its own bot, and a
 * workflow can only hand a step secrets it names — so adding a GroupMe league
 * to those is a secrets change anyway.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, DEFAULT_LEAGUE_SLUG } from '../../src/config/leagues-data.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A league MFL syncs live. Best ball is draft-only: no live syncing. */
const syncs = (l) => !l.bestBall;

/** Whether the league renders `page` (a file under its src/pages/<slug>/). */
const hasPage = (l, page) => existsSync(join(ROOT, 'src/pages', l.slug, page));

/**
 * A Schefter column the league's feed is on for, and its article set allows —
 * article-leagues.mjs's rule (`articleTypes` absent = every type), read off
 * the ENTRY so a league not yet in the registry answers for itself.
 */
const writes = (type) => (l) =>
  Boolean(l.features?.schefterFeed) && (!Array.isArray(l.articleTypes) || l.articleTypes.includes(type));

export const LEAGUE_JOBS = {
  // ── Data jobs: every league that syncs ─────────────────────────────────
  /** roster-sync.yml: the MFL feed fetch. */
  'mfl-sync': syncs,
  /** roster-sync.yml: salary averages — contract leagues only. */
  'salary-sync': (l) => syncs(l) && Boolean(l.features?.salaryCap),
  /** weekly-stats-sync.yml: fantasy points allowed, read by the shared player modal. */
  'fantasy-points-allowed': syncs,
  /** prebuild: the per-league player identity table. */
  'player-identity-union': syncs,
  /** prebuild + roster-sync.yml: the Top Players leaderboard — for leagues that HAVE the page. */
  'top-players': (l) => syncs(l) && hasPage(l, 'top-players.astro'),

  // ── Schedule: leagues whose schedule this site draws ───────────────────
  /** schedule-release.yml: the draw. A league without a policy keeps MFL's own schedule. */
  'schedule-draw': (l) => Boolean(l.schedulePolicy),

  // ── Columns: on by checkbox ────────────────────────────────────────────
  /** The Pecking Order (the "Power rankings" box). */
  'pecking-order': (l) => syncs(l) && Boolean(l.features?.powerRankings),
  /** The Owners' Poll riding on it (nag + close passes). */
  'owners-poll': (l) => syncs(l) && Boolean(l.features?.powerRankings) && Boolean(l.ownersPoll?.enabled),
  /** The Gauntlet. */
  'article:schedule-strength': writes('schedule-strength'),
  /** Release-day column: only where this site draws the schedule. */
  'article:schedule-release': (l) => writes('schedule-release')(l) && Boolean(l.schedulePolicy),
  /**
   * Every other weekly column (previews, recaps, …): still the default league
   * alone, as before this module existed. Widening them is a Claude-cost call
   * per column, so it is a deliberate predicate change here, never a side
   * effect of a league launching.
   */
  'article:weekly': (l) => l.slug === DEFAULT_LEAGUE_SLUG && Boolean(l.features?.schefterFeed),
};

export const JOB_NAMES = Object.keys(LEAGUE_JOBS);

/**
 * Registry entries `job` runs for, default league first, then registry order.
 * @param {string} job
 * @param {Array<Record<string, any>>} [leagues] any registry-shaped entries (tests pass a league not in the registry)
 */
export function leaguesFor(job, leagues = ALL_LEAGUES) {
  const test = LEAGUE_JOBS[job];
  if (!test) throw new Error(`Unknown league job "${job}". Known: ${JOB_NAMES.join(', ')}`);
  return leagues
    .filter((l) => test(l))
    .sort((a, b) => Number(b.slug === DEFAULT_LEAGUE_SLUG) - Number(a.slug === DEFAULT_LEAGUE_SLUG));
}

/**
 * Fill `{field}` placeholders from a registry entry: any top-level field,
 * `features.<key>`, and `default` (true for the default league). Unknown or
 * object-valued fields are an error, so a typo in a workflow fails the run
 * instead of syncing a league called "undefined".
 */
export function formatLeague(template, league) {
  return template.replace(/\{([\w.]+)\}/g, (_, key) => {
    const value =
      key === 'default'
        ? league.slug === DEFAULT_LEAGUE_SLUG
        : key.split('.').reduce((v, k) => (v == null ? v : v[k]), league);
    if (value == null || typeof value === 'object') {
      throw new Error(`league-jobs: {${key}} is not a scalar field of ${league.slug}`);
    }
    return String(value);
  });
}
