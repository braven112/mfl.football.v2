#!/usr/bin/env node
/**
 * Wait until this week's What's New article is actually READABLE in production,
 * before the push notification that links to it goes out.
 *
 * THE RACE THIS CLOSES
 * --------------------
 * `weekly-changelog-rollup.yml` already orders the notification after the
 * commit, and its own comment admits the gap: "The race is not fully closed —
 * the deploy takes a few minutes and the job does not wait for it — but the
 * [id] route redirects an unknown id to /whats-new rather than 404ing, so the
 * worst case is an early tap landing on the listing."
 *
 * That was an acceptable trade while the rollup was a lone Monday cron. It is a
 * worse one now that the rollup also fires on the release tag, because the tag
 * fires at the START of the production deploy rather than well after the last
 * one: `/promote` pushes `main`, tags it, and only THEN verifies production
 * came up. So the window where the permalink does not resolve is now reliably
 * open rather than occasionally open.
 *
 * WHY POLL THE PERMALINK RATHER THAN THE DEPLOYMENT
 * ------------------------------------------------
 * Two reasons. There is no `VERCEL_TOKEN` in this repo's secrets, so the
 * platform API is not available without adding one. And more importantly, the
 * permalink is the thing the notification actually promises — asking "did some
 * deployment finish?" is a proxy for the real question, while asking for the
 * article's own URL IS the real question. A version stamp would answer it too;
 * the plan lists one as still-unbuilt (`docs/plans/staging-release-process.md`,
 * "Other practices worth adopting" #1).
 *
 * `redirect: 'manual'` is load-bearing. The `[id]` route's redirect to
 * /whats-new is exactly what a not-yet-deployed article looks like, so a
 * follow-redirects fetch would see 200 for a page that does not have the
 * article on it and declare victory immediately.
 *
 * NEVER FATAL
 * -----------
 * On timeout this warns and exits 0, leaving the notification to go out anyway.
 * That restores the pre-existing behaviour as the floor — an early tap lands on
 * the listing — rather than trading a small cosmetic race for owners silently
 * never being told. A red job here would also read as a broken rollup, which it
 * is not.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES, DEFAULT_LEAGUE_SLUG, leagueUrl } from '../src/config/leagues-data.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WHATS_NEW_PATH = resolve(ROOT, 'src/data/whats-new.json');

/**
 * Monday of the current week.
 *
 * Copied in shape from `push-weekly-changelog.mjs#currentMonday`, and for the
 * same stated reason: local getters throughout, never `toISOString()`. The two
 * must agree on which article is "this week's" or this waits for a URL the
 * notification is not going to send.
 */
function currentMonday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  const pad = (n) => String(n).padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

/**
 * The absolute production URLs for this week's articles, one per league that
 * published. Built with `leagueUrl`, never by concatenating an origin with a
 * path — see docs/claude/rules/league-urls.md.
 */
export function thisWeeksArticleUrls({ entries, monday }) {
  const urls = [];
  for (const league of Object.values(LEAGUES)) {
    const suffix = league.slug === DEFAULT_LEAGUE_SLUG ? '' : `-${league.navSlug}`;
    const id = `weekly-rollup-${monday}${suffix}`;
    if (!entries.some((e) => e.id === id)) continue;
    urls.push({ id, url: leagueUrl(league, `/whats-new/${id}`) });
  }
  return urls;
}

/**
 * One probe. 200 means the article is really there; a redirect means not yet.
 *
 * `redirect: 'manual'` is the load-bearing part: the `[id]` route redirects an
 * unknown id to /whats-new, so a follow-redirects fetch would see 200 for a
 * page that does not have the article on it and declare victory immediately.
 *
 * The abort budget is load-bearing too, for the same reason the gate has one:
 * the caller's deadline is only checked BETWEEN probes, so a stalled connect
 * with no signal would hang past it and the documented non-fatal timeout would
 * never be reached. Any failure — abort, DNS, TLS, a 5xx — reads as "not yet",
 * which is the safe direction: it costs another poll, never a false green.
 *
 * Exported for tests. It is the whole contract of this script.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {(url: string, init?: RequestInit) => Promise<{ status: number }>} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function isLive(url, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  try {
    const res = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'whats-new-live-check' },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith('wait-for-whats-new-live.mjs');

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };

  const timeoutSeconds = Number(arg('--timeout-seconds', '600'));
  const intervalSeconds = Number(arg('--interval-seconds', '20'));

  let entries = [];
  try {
    entries = JSON.parse(readFileSync(WHATS_NEW_PATH, 'utf-8'));
  } catch (err) {
    console.log(`[whats-new-live] could not read whats-new.json (${err.message}); not waiting.`);
    process.exit(0);
  }

  const targets = thisWeeksArticleUrls({ entries, monday: currentMonday() });
  if (targets.length === 0) {
    console.log('[whats-new-live] no article for this week in whats-new.json; nothing to wait for.');
    process.exit(0);
  }

  console.log(`[whats-new-live] waiting for ${targets.length} permalink(s), up to ${timeoutSeconds}s:`);
  for (const t of targets) console.log(`  · ${t.url}`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  const pending = new Map(targets.map((t) => [t.url, t]));

  while (pending.size > 0 && Date.now() < deadline) {
    for (const [url] of [...pending]) {
      if (await isLive(url)) {
        console.log(`[whats-new-live] live: ${url}`);
        pending.delete(url);
      }
    }
    if (pending.size === 0) break;
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  }

  if (pending.size === 0) {
    console.log('[whats-new-live] every permalink resolves — safe to notify.');
    process.exit(0);
  }

  for (const [url] of pending) {
    console.log(
      `::warning::${url} did not resolve within ${timeoutSeconds}s. Notifying anyway — an early ` +
        `tap lands on /whats-new, which is the behaviour this check exists to improve on, not a break.`,
    );
  }
  process.exit(0);
}
