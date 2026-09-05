#!/usr/bin/env node
/**
 * Gameday health check — pre-kickoff smoke test of live-game infrastructure.
 *
 * Runs shortly before each NFL game window (see
 * .github/workflows/gameday-health-check.yml) so that a broken live-scoring
 * pipeline surfaces in the Actions tab — and optionally GroupMe — before
 * owners hit it, instead of via complaints mid-game.
 *
 * For every league in the registry (skipping draft-only best-ball leagues,
 * which have no live gameday surface owners watch on an apex domain):
 *
 *   1. `/api/live-scoring?week=<current week>` on the league's apex domain
 *      responds 200 with valid non-empty JSON. Only `L` is sent: the route
 *      derives that league's MFL host from the registry, so the probe still
 *      exercises the league's own MFL path end to end without putting a
 *      `host=<hostname>` param on the wire (see below).
 *   2. `/api/nfl-scoreboard?week=<current week>` on the same domain
 *      responds 200 with valid non-empty JSON (ESPN proxy behind the
 *      NFL-games strip).
 *   3. The MFL export API for the league answers `TYPE=league` on the
 *      league's own MFL host.
 *
 * Check 1 is SKIPPED before the Week 1 kickoff. MFL serves no live scoring
 * until there are games, so a pre-season probe fails on a perfectly healthy
 * league; the cron window opens in September but kickoff is mid-month, so
 * that gap is real every year. Checks 2 and 3 stay meaningful year-round and
 * keep running.
 *
 * That skip has a failure mode of its own, and it is the worse one: the week
 * resolver returns 0 BOTH before kickoff and for a year missing from its
 * KICKOFF_DATES table (2024-2027 as of writing). Left alone, the first
 * uncovered season would skip every live-scoring probe on every run and
 * report all-green — a monitor that has quietly stopped monitoring, which is
 * strictly worse than one that cries wolf. So a missing kickoff date is its
 * own FAILING check, named as such.
 *
 * The current week comes from the shared resolver
 * (scripts/article-utils/week-resolver.mjs) — do not reinvent week math here.
 *
 * Two false alarms this shape has already produced, both on the check's very
 * first scheduled run (2026-09-03) — do not reintroduce either:
 *   - A `host=` param on the probe URL reads like an SSRF attempt to a WAF.
 *     Both leagues' live-scoring probes came back 403 from the edge, with no
 *     matching entry in the app's runtime logs — the request never reached
 *     the route. `L` alone is enough now.
 *   - Probing week 1 in the pre-kickoff window (see above).
 *
 * Failures: prints a per-check summary and exits non-zero so the Actions run
 * fails visibly. If GROUPME_ROGER_BOT_ID is set, also posts a short
 * admin-oriented failure summary to GroupMe; when unset, GroupMe is skipped
 * silently (local runs, forks).
 *
 * Env:
 *   GROUPME_ROGER_BOT_ID   optional — failure summary post target
 */

import { ALL_LEAGUES, leagueOrigin, SHARED_APP_ORIGIN } from '../src/config/leagues-data.mjs';
import { fetchExport, mflHostPrefix } from './lib/mfl-api.mjs';
import { getCurrentNFLWeek, getKickoffDate, getSeasonYear } from './article-utils/week-resolver.mjs';
import { postToGroupMe } from './lib/groupme.mjs';
import {
  clampHealthCheckWeek,
  shouldProbeLiveScoring,
  evaluateJsonText,
  evaluateJsonValue,
  buildFailureSummary,
} from './lib/gameday-health.mjs';

const TAG = '[gameday-health]';
const FETCH_TIMEOUT_MS = 20_000;
// Same UA the app's own live-scoring route sends to MFL.
const USER_AGENT = 'Mozilla/5.0 (compatible; FantasyLeague/1.0)';

/** @typedef {import('./lib/gameday-health.mjs').CheckResult} CheckResult */

/**
 * Probe an app endpoint: 200 + valid non-empty JSON body.
 * @param {string} name
 * @param {string} url
 * @returns {Promise<CheckResult>}
 */
async function checkAppEndpoint(name, url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { name, ok: false, detail: `HTTP ${res.status}` };
    const verdict = evaluateJsonText(await res.text());
    return { name, ok: verdict.ok, detail: verdict.ok ? 'HTTP 200, JSON ok' : verdict.reason };
  } catch (err) {
    return { name, ok: false, detail: `fetch failed: ${err?.message ?? err}` };
  }
}

/**
 * Probe the MFL export API for a league (TYPE=league on its own host).
 * @param {{ slug: string, id: string, mflHost: string }} league
 * @param {number} year
 * @returns {Promise<CheckResult>}
 */
async function checkMflExport(league, year) {
  const name = `${league.slug} MFL export (TYPE=league on ${league.mflHost})`;
  try {
    const data = await fetchExport(
      { host: mflHostPrefix(league.mflHost), leagueId: league.id, year, type: 'league' },
      { userAgent: USER_AGENT, retries: 2, sleepMs: 2000, timeoutMs: FETCH_TIMEOUT_MS },
    );
    const verdict = evaluateJsonValue(data);
    if (!verdict.ok) return { name, ok: false, detail: verdict.reason };
    if (!data.league) return { name, ok: false, detail: 'JSON ok but no `league` object in payload' };
    return { name, ok: true, detail: 'MFL answered with league payload' };
  } catch (err) {
    return { name, ok: false, detail: `fetch failed: ${err?.message ?? err}` };
  }
}

async function main() {
  const now = new Date();
  const year = getSeasonYear(now);
  const rawWeek = getCurrentNFLWeek(year, now);
  const week = clampHealthCheckWeek(rawWeek);
  const liveScoringInPlay = shouldProbeLiveScoring(rawWeek);
  console.log(`${TAG} season ${year}, current NFL week ${rawWeek} → probing week ${week}`);

  /** @type {CheckResult[]} */
  const results = [];

  // A week of 0 means "pre-season" only if we actually know when kickoff is.
  // Without a kickoff date the week math is dead and the skip below would run
  // all season without saying so, so make that its own loud failure.
  const kickoff = getKickoffDate(year);
  if (!kickoff) {
    results.push({
      name: `NFL kickoff date known for ${year}`,
      ok: false,
      detail:
        `no ${year} entry in KICKOFF_DATES (scripts/article-utils/week-resolver.mjs) — ` +
        'week math is dead and live-scoring probes are being skipped every run. Add the year.',
    });
  } else if (!liveScoringInPlay) {
    console.log(
      `${TAG} pre-season (week ${rawWeek}, kickoff ${kickoff.toISOString()}) — ` +
        'skipping live-scoring probes; MFL serves no live scoring until Week 1 kicks off.',
    );
  }

  for (const league of ALL_LEAGUES) {
    if (league.bestBall) {
      console.log(`${TAG} skipping ${league.slug} (draft-only best-ball league)`);
      continue;
    }
    // Path-only leagues (no apex domain) fall back to the shared app origin.
    const origin = leagueOrigin(league) ?? SHARED_APP_ORIGIN;

    if (liveScoringInPlay && kickoff) {
      // `L` only — the route resolves this league's MFL host from the registry.
      const liveScoringUrl = `${origin}/api/live-scoring?week=${week}&L=${encodeURIComponent(league.id)}`;
      results.push(await checkAppEndpoint(`${league.slug} /api/live-scoring (${origin})`, liveScoringUrl));
    }
    results.push(
      await checkAppEndpoint(
        `${league.slug} /api/nfl-scoreboard (${origin})`,
        `${origin}/api/nfl-scoreboard?week=${week}`,
      ),
    );
    results.push(await checkMflExport(league, year));
  }

  console.log(`\n${TAG} results:`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  const summary = buildFailureSummary(results, { week, year });
  if (!summary) {
    console.log(`\n${TAG} all ${results.length} checks passed.`);
    return;
  }

  console.error(`\n${summary}`);
  // NOT capped, for two reasons. It has no single league to charge — the
  // summary spans every league and is emitted outside the per-league loop —
  // and it only fires when something is actually broken on a game day, where
  // swallowing the alert is far worse than an extra message. Revisit if it
  // ever becomes chatty.
  await postToGroupMe({
    botId: process.env.GROUPME_ROGER_BOT_ID,
    text: summary,
    checkStatus: true,
    // Skip GroupMe silently when the bot id is unset (local runs, forks).
    onPosted: () => console.log(`${TAG} failure summary posted to GroupMe`),
    onHttpError: (status) => console.warn(`${TAG} GroupMe post failed: HTTP ${status}`),
    onFetchError: (err) => console.warn(`${TAG} GroupMe post failed: ${err.message}`),
  });
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`${TAG} fatal:`, err);
  process.exitCode = 1;
});
