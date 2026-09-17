#!/usr/bin/env node
/**
 * Drain the announce queue — the second half of publishing an article.
 *
 * Runs AFTER the workflow's commit-and-push step. For each queued
 * announcement it waits for the article's permalink to answer 200 on the live
 * site, then delivers the GroupMe promo (subject to the one-post-a-day cap)
 * and the push fan-out.
 *
 * Why this is a separate script rather than a flag on the generator: the wait
 * has to sit on the far side of `git push`, and a generator that could be
 * asked to block for twelve minutes mid-run is a generator that will
 * eventually be run that way by mistake. The split also means an announcement
 * cannot be sent by a run whose commit step failed — the workflow simply
 * never reaches this step.
 *
 * Nothing here fails the job. The article is written and committed by the time
 * this runs; a GroupMe outage or a slow deploy must not turn a successful
 * publish into a red workflow.
 *
 * Usage:
 *   node scripts/schefter-announce-pending.mjs [--dry-run]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { postToGroupMeCapped } from './lib/groupme-capped.mjs';
import { sendPushFanout, broadcast } from './lib/push-fanout.mjs';
import { sendVoterPushes } from './lib/owners-poll-posts.mjs';
import { awaitPublished } from './lib/await-published.mjs';
import { readAnnounceQueue, clearAnnounceQueue, queuePath } from './lib/announce-queue.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * The seams this script takes for testing, declared rather than inferred from
 * their defaults. A default of `console` types the parameter as the whole
 * Console interface and a default of `awaitPublished` demands its full return
 * shape, so both reject any honest stub — the same trap push-fanout.mjs's
 * DEFAULT_LOG documents. `announceOne` only ever reads `live`.
 *
 * @typedef {{ log?: (...args: any[]) => void, warn?: (...args: any[]) => void }} AnnounceLog
 * @typedef {(args: { league: any, path: string, log?: AnnounceLog }) => Promise<{ live: boolean }>} WaitForPublished
 */

/** @type {AnnounceLog} */
const DEFAULT_LOG = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
};

/**
 * Send one queued announcement. Never throws.
 *
 * Exported for tests: every branch here is a lane that has broken in
 * production at least once (a missing bot id, a held day, a push with no
 * recipients), and they are cheaper to pin than to re-debug.
 */
export async function announceOne(entry, {
  dryRun = false,
  /** @type {AnnounceLog} */
  log = DEFAULT_LOG,
  /** @type {WaitForPublished} */
  wait = /** @type {any} */ (awaitPublished),
} = {}) {
  const league = LEAGUES[entry.league];
  if (!league) {
    log.warn?.(`  [announce] Unknown league "${entry.league}" — skipping ${entry.postId}.`);
    return { announced: false, reason: 'unknown league' };
  }

  log.log?.(`\n📣 ${entry.postId} (${entry.league})`);

  const isDry = dryRun || entry.dryRun === true;

  // The permalink is the readiness signal even when the promo points
  // elsewhere — see AnnounceEntry.verifyPath. Skipped on a dry run: nothing
  // was committed, so the wait could only ever burn its full timeout probing
  // production for a page that is never going to appear.
  const published = entry.verifyPath && !isDry
    ? await wait({ league, path: entry.verifyPath, log })
    : { live: true, attempts: 0 };
  let posted = false;

  if (entry.groupMeText && isDry) {
    // A rehearsal must NOT go through the cap. `postToGroupMeCapped` claims
    // the league's one slot for the day (Redis SET NX) BEFORE it reaches the
    // dry-run bail, and it only gives the slot back when a LIVE send failed —
    // so a dry run routed through it burns the day and silences the real post.
    const botId = process.env[entry.botEnv];
    log.log?.(
      `  [dry-run] Would post to GroupMe as ${entry.kind}` +
        `${botId ? '' : ` (${entry.botEnv} is UNSET — a live run would skip it)`}:\n${entry.groupMeText}`,
    );
  } else if (entry.groupMeText) {
    const botId = process.env[entry.botEnv];
    const result = await postToGroupMeCapped({
      league,
      kind: entry.kind,
      botId,
      text: entry.groupMeText,
      checkStatus: true,
      onMissingBotId: () => log.log?.(`  [groupme] ${entry.botEnv} not set — skipping promo.`),
      onPosted: () => log.log?.('  [groupme] promo posted.'),
      onHttpError: (status) => log.warn?.(`  [groupme] promo failed: HTTP ${status}`),
      onFetchError: (err) => log.warn?.(`  [groupme] promo failed: ${err.message}`),
    });
    posted = result.posted === true;
    if (!result.posted && !result.refused) log.log?.('  [groupme] promo not delivered (see above).');
  }

  // Sent whether or not the chat post went out: most article types are held
  // by the daily cap, so push is how they reach anyone at all, and the two are
  // separate channels an owner chooses separately.
  let pushed = 0;
  if (entry.push?.franchiseIds?.length) {
    const result = await sendPushFanout({
      league,
      dryRun: isDry,
      // Owners subscribe per category, so this must be the category the copy
      // actually belongs to — a wrong one is dropped server-side.
      category: entry.pushCategory ?? 'article',
      notifications: broadcast(entry.push),
      log,
    });
    pushed = result.sent ?? 0;
  }

  // Per-recipient pushes (the Owners' Poll open and reveal). Not a broadcast:
  // each owner gets different copy and only voters get the reveal at all, so
  // these arrive pre-built and go out through the poll's own sender.
  let voterPushed = 0;
  if (entry.voterPushes?.length) {
    if (isDry) {
      log.log?.(`  [dry-run] Would send ${entry.voterPushes.length} per-voter push(es).`);
    } else {
      const result = await sendVoterPushes({ league, notifications: entry.voterPushes, log });
      voterPushed = result.sent ?? 0;
    }
  }

  return { announced: true, live: published.live, posted, pushed, voterPushed };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const queue = await readAnnounceQueue(projectRoot);

  if (queue.length === 0) {
    console.log(`No pending announcements (${queuePath(projectRoot)}).`);
    return;
  }

  console.log(`\n📣 Draining ${queue.length} pending announcement${queue.length === 1 ? '' : 's'}\n`);

  for (const entry of queue) {
    try {
      await announceOne(entry, { dryRun });
    } catch (err) {
      // One league's failure must not cost the other its announcement.
      console.warn(`  [announce] ${entry.postId} failed: ${err.message}`);
    }
  }

  // Cleared even on failure — see clearAnnounceQueue.
  await clearAnnounceQueue(projectRoot);
}

// Importable for tests without draining anything.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // Still never fatal: the article is already published.
    console.warn(`Announce pass failed: ${err.message}`);
  });
}
