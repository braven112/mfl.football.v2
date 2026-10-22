/**
 * Counts requests on mfl.football for files the site does not have.
 *
 * mfl.football used to be served by InMotion, and other sites (old AFL
 * seasons on MFL, the template's homepage.js) linked straight at files there.
 * The files we knew about were copied to Vercel before the cutover
 * (scripts/inmotion-migration/report.json). This is how we find the ones we
 * did not know about: every miss on the old host is counted by path and by
 * the page that asked for it, so the referrer names the MFL league to contact.
 * `scripts/report-missed-files.mjs` prints the tally.
 *
 * Only the old InMotion hostnames are counted. A 404 on a league's own domain
 * or on v2/staging was never an InMotion file and would only bury the signal.
 *
 * While the old host is measured, a counted miss is not a 404: it is sent on
 * to the same path on old.mfl.football (still InMotion), so a page linking an
 * old file keeps working while we learn who it is. Turn
 * `FALL_BACK_TO_INMOTION` off once the report says nobody depends on it.
 *
 * Never throws and never waits long: a miss must not get slower or fail
 * because Redis is.
 */

import { getRedis } from './redis-client';

export const MISSED_PATHS_KEY = 'mfl-football-misses:paths';
export const MISSED_REFERRERS_KEY = 'mfl-football-misses:referrers';

/** Hostnames InMotion used to answer for. */
const TRACKED_HOSTS = new Set(['mfl.football', 'www.mfl.football']);

/** Internal rewrite target for deliberate 404s (docs/claude/rules/error-pages.md). */
const NOT_FOUND_SENTINEL = '/_not-found';

/** Send counted misses on to InMotion instead of 404ing them. */
export const FALL_BACK_TO_INMOTION = true;
const INMOTION_FALLBACK_ORIGIN = 'https://old.mfl.football';

const MAX_LENGTH = 200;
/** Keep the top N members of each set; bots probing random paths stay bounded. */
const MAX_MEMBERS = 2000;
const WRITE_TIMEOUT_MS = 500;

export const NO_REFERRER = '(none)';

export type MissedFile = { path: string; referrer: string };

/** Origin + path of the referring page, without its query string. */
function normalizeReferrer(referer: string | null): string {
  if (!referer) return NO_REFERRER;
  try {
    const ref = new URL(referer);
    return `${ref.origin}${ref.pathname}`.slice(0, MAX_LENGTH);
  } catch {
    return NO_REFERRER;
  }
}

/** What to count for this request, or null when it is not a tracked miss. */
export function missedFileEntry(url: URL, referer: string | null): MissedFile | null {
  if (!TRACKED_HOSTS.has(url.hostname)) return null;
  if (url.pathname === NOT_FOUND_SENTINEL) return null;
  return { path: url.pathname.slice(0, MAX_LENGTH), referrer: normalizeReferrer(referer) };
}

export async function recordMissedFile(url: URL, referer: string | null): Promise<void> {
  const entry = missedFileEntry(url, referer);
  if (!entry) return;
  const write = (async () => {
    const redis = await getRedis();
    if (!redis) return;
    await Promise.all([
      redis.zincrby(MISSED_PATHS_KEY, 1, entry.path),
      redis.zincrby(MISSED_REFERRERS_KEY, 1, `${entry.path} <- ${entry.referrer}`),
    ]);
    if (Math.random() < 0.02) {
      await Promise.all([
        redis.zremrangebyrank(MISSED_PATHS_KEY, 0, -(MAX_MEMBERS + 1)),
        redis.zremrangebyrank(MISSED_REFERRERS_KEY, 0, -(MAX_MEMBERS + 1)),
      ]);
    }
  })().catch((error) => {
    console.warn('[missed-file] could not record', entry.path, error);
  });
  await Promise.race([write, new Promise((resolve) => setTimeout(resolve, WRITE_TIMEOUT_MS))]);
}

/**
 * The same file on the InMotion backup host, or null when this miss should be
 * an ordinary 404 (an untracked host, or the fallback switched off).
 */
export function inMotionFallbackUrl(url: URL): string | null {
  if (!FALL_BACK_TO_INMOTION) return null;
  if (!missedFileEntry(url, null)) return null;
  return `${INMOTION_FALLBACK_ORIGIN}${url.pathname}${url.search}`;
}

/**
 * A temporary redirect to the InMotion copy. Never cached, so every request
 * is counted and switching the fallback off takes effect at once.
 */
export function inMotionFallbackResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}
