/**
 * The announce queue — what a cron wants to SAY, held until the site can back
 * it up.
 *
 * The generator and the announcement are two different moments. A generator
 * writes a file in the Actions runner; the announcement is only truthful once
 * that file is committed AND deployed, which happens in later workflow steps
 * (see scripts/lib/await-published.mjs for the bug that taught us). So the
 * generator no longer sends: it enqueues, and `schefter-announce-pending.mjs`
 * drains the queue after the push.
 *
 * WHY A FILE rather than step outputs: the Gauntlet runs the generator once
 * PER LEAGUE, as separate node processes, and `$GITHUB_OUTPUT` has no append
 * semantics a second process can rely on. A JSON array in a temp file does,
 * and it keeps the drainer testable with no GitHub in the loop.
 *
 * The queue is NEVER committed. It lives in `$SCHEFTER_ANNOUNCE_QUEUE` (the
 * workflow points that at `$RUNNER_TEMP`), and the repo-root fallback is
 * gitignored for local runs — every committer in this repo takes an explicit
 * `--files` list, so a stray queue file could not ride along even by accident.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Local fallback when the workflow has not named a path. Gitignored. */
export const DEFAULT_QUEUE_FILE = '.schefter-announce-queue.json';

export function queuePath(projectRoot) {
  const fromEnv = process.env.SCHEFTER_ANNOUNCE_QUEUE;
  return fromEnv ? path.resolve(fromEnv) : path.join(projectRoot, DEFAULT_QUEUE_FILE);
}

/**
 * @typedef {object} AnnounceEntry
 * @property {string} league      Registry slug ('theleague' | 'afl-fantasy').
 * @property {string} kind        Day-cap kind — see scripts/lib/groupme-day-plan.mjs.
 * @property {string} postId      For logs and the push `tag`.
 * @property {string} verifyPath  League-PREFIXED route that must answer 200
 *   before we announce. The article PERMALINK, even when the promo links
 *   somewhere else: the permalink is the page that 404s into a redirect while
 *   a deploy is in flight, so it is the honest readiness signal.
 * @property {string|null} groupMeText  Null skips the chat post.
 * @property {string} botEnv      Name of the env var holding this league's
 *   Schefter bot id. Carried rather than re-derived so the league → bot map
 *   has exactly one home (the generator); a second copy is a second thing to
 *   get wrong, and Roger's bot must never become Schefter's fallback.
 * @property {{franchiseIds: string[], title: string, body: string, url: string, tag: string}|null} push
 * @property {string} [pushCategory] Notification category for `push` —
 *   src/config/notification-categories.ts. Defaults to 'article'; the Pecking
 *   Order sends 'column'. Owners subscribe per category, so a wrong one is
 *   silently dropped by the server rather than delivered to someone who did
 *   not ask for it.
 * @property {Array<object>|null} [voterPushes] Pre-built PER-RECIPIENT
 *   notifications (the Owners' Poll open and reveal), sent through
 *   `sendVoterPushes`. Separate from `push` because it is not a broadcast:
 *   each owner gets different copy, and only voters get it at all.
 * @property {boolean} [dryRun]
 */

async function read(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Absent or unreadable is an EMPTY queue, not an error: the common case is
    // a generator that cleanly skipped and never wrote one.
    return [];
  }
}

/** Append one announcement. Read-modify-write is safe: generators run in series. */
export async function enqueueAnnounce(projectRoot, entry) {
  const file = queuePath(projectRoot);
  const queue = await read(file);
  queue.push(entry);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  return { file, size: queue.length };
}

export async function readAnnounceQueue(projectRoot) {
  return read(queuePath(projectRoot));
}

/**
 * Drop the queue once drained.
 *
 * Unconditional, even when an entry failed to send: a retained entry would be
 * re-announced by the next article cron hours later, which is the double-ping
 * every sender in this pipeline is written to avoid.
 */
export async function clearAnnounceQueue(projectRoot) {
  try {
    await fs.unlink(queuePath(projectRoot));
    return true;
  } catch {
    return false;
  }
}
