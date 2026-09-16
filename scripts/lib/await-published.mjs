/**
 * "Is the thing we are about to advertise actually on the site yet?"
 *
 * THE BUG THIS EXISTS FOR (Sep 2026). schefter-weekly-articles.mjs posted The
 * Gauntlet's GroupMe promo the instant `appendToFeed` resolved — but that
 * write is a file in the Actions runner. The commit lands in a LATER workflow
 * step, and Vercel then has to build. Until that deploy is live the post is
 * not in the bundle, and `src/pages/<league>/news/[id].astro` answers a
 * permalink it cannot find with `Astro.redirect('/<league>/news')`. So every
 * owner who tapped the chat link inside that window was dropped on the
 * Schefter index with no article: the column read as broken, and by the time
 * anyone went to look it had fixed itself, which is the worst shape a bug can
 * have.
 *
 * The fix is not a fixed sleep. A build takes as long as it takes, and a
 * sleep long enough to be safe is mostly wasted. This polls the real URL and
 * announces the moment it answers.
 *
 * WHY A 3xx MEANS "NOT YET" rather than "broken": the article route's only
 * redirect IS the not-found path. `redirect: 'manual'` keeps it visible —
 * following it would return the index's own 200 and read as success.
 *
 * FAILING OPEN IS DELIBERATE. On timeout the caller is told `live: false` and
 * announces anyway: the post is committed by then and the deploy is minutes
 * away at worst, whereas swallowing the announcement means the league never
 * hears about an article that exists. Same direction as the day-cap's Redis
 * outage and vercel-ignore-build's network errors — the degraded mode is a
 * message that may be early, never a channel that goes quiet.
 */

import { leagueUrl, getLeagueBySlug } from '../../src/config/leagues-data.mjs';

/** Poll cadence. Constants, not env vars — CLAUDE.md keeps gates in code. */
export const POLL_INTERVAL_MS = 20_000;
/** Comfortably past a cold production build; see FAILING OPEN above. */
export const POLL_TIMEOUT_MS = 12 * 60_000;

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One probe. Returns the HTTP status, or a string describing why there wasn't
 * one — either way the caller only cares whether it is exactly 200.
 *
 * Cache-busted and `no-store`: the route is SSR, but an edge cache holding the
 * pre-deploy response for the few minutes that matter would defeat the whole
 * check. The nonce carries the ATTEMPT as well as the clock — two probes can
 * land in the same millisecond, and then a timestamp alone repeats a URL.
 * The query string is ignored by the route.
 */
async function probe(url, fetchImpl, nonce) {
  const bust = `${url}${url.includes('?') ? '&' : '?'}announce-probe=${nonce}`;
  try {
    const res = await fetchImpl(bust, {
      redirect: 'manual',
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' },
    });
    return res.status;
  } catch (err) {
    return `fetch failed: ${err.message}`;
  }
}

/**
 * Wait until `path` (a league-PREFIXED route, e.g. `/theleague/news/<id>`)
 * answers 200 on the league's canonical host.
 *
 * @returns {Promise<{live: boolean, url: string, attempts: number, lastStatus: number|string, waitedMs: number}>}
 */
export async function awaitPublished({
  league,
  path,
  timeoutMs = POLL_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
  fetchImpl = fetch,
  sleep = sleepFor,
  now = () => Date.now(),
  log = console,
}) {
  // Accept a registry ENTRY or a slug. `leagueUrl` needs the entry: handed a
  // bare string it finds no origin and silently falls back to the shared host,
  // so the probe would poll a URL no owner will ever open and the wait would
  // mean nothing.
  const entry = typeof league === 'string' ? getLeagueBySlug(league) : league;
  if (!entry) throw new Error(`awaitPublished: unknown league ${JSON.stringify(league)}`);

  const url = leagueUrl(entry, path);
  const started = now();
  const deadline = started + timeoutMs;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    const lastStatus = await probe(url, fetchImpl, `${now()}-${attempts}`);
    if (lastStatus === 200) {
      log.log?.(`  [announce] ${url} is live (${attempts} probe${attempts === 1 ? '' : 's'}).`);
      return { live: true, url, attempts, lastStatus, waitedMs: now() - started };
    }

    // Never sleep past the deadline — a poll we would not act on is just a
    // slower timeout.
    if (now() + intervalMs >= deadline) {
      log.warn?.(
        `  [announce] ${url} still not live after ${attempts} probes (last: ${lastStatus}) — ` +
          `announcing anyway; the deploy is committed and this link will resolve.`,
      );
      return { live: false, url, attempts, lastStatus, waitedMs: now() - started };
    }

    log.log?.(`  [announce] ${url} not live yet (${lastStatus}) — re-probing in ${Math.round(intervalMs / 1000)}s.`);
    await sleep(intervalMs);
  }
}
