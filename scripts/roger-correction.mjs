/**
 * Roger correction poster — one-off, hand-authored "I got that wrong" post to
 * the league GroupMe.
 *
 * Ask Roger is a chatbot, and chatbots are occasionally confidently wrong. When
 * a bad answer has already been read by owners, fixing the constitution isn't
 * enough — the people who acted on the wrong answer never see the diff. This
 * script is the deliberate manual path for walking one back in the group chat.
 *
 * It is intentionally NOT scheduled and never fires on its own: a correction is
 * a commissioner-reviewed act, and the copy is hand-written each time.
 * `.github/workflows/roger-correction.yml` exists only to supply
 * GROUPME_ROGER_BOT_ID, which is a repo secret and so is absent from most local
 * checkouts — it runs this script, it does not decide when a correction is due.
 *
 * SAFETY: dry-run is the DEFAULT. GroupMe has no dedup and no unsend, so the
 * live post requires an explicit --send.
 *
 * IDEMPOTENCY is stateful, not trigger-shaped. Each slug claims
 * `roger:correction:sent:<slug>` in Redis via SET NX before posting, and a
 * claimed slug refuses to post again. This deliberately does NOT rely on the
 * workflow's sentinel path filter: a `push` evaluates `paths` against the
 * commits in the push, so any history rewrite that re-delivers the sentinel
 * commit — exactly what this repo's mandated `git rebase origin/main` +
 * `--force-with-lease` does — re-fires the job with the sentinel still at HEAD
 * and would post to the whole league a second time. `--force` overrides the
 * claim for the rare deliberate re-send. Without Redis credentials the claim
 * cannot be made, and --send refuses rather than posting unguarded.
 *
 * Usage (preview the exact text, no network):
 *   node scripts/roger-correction.mjs --correction taxi-squad-20-minimum
 *
 * Usage (live, needs GROUPME_ROGER_BOT_ID + Redis creds in env):
 *   node scripts/roger-correction.mjs --correction taxi-squad-20-minimum --send
 *
 * Usage (deliberate re-send of an already-posted correction):
 *   node scripts/roger-correction.mjs --correction <slug> --send --force
 */

import { getLeagueBySlug, leagueOrigin } from '../src/config/leagues-data.mjs';
import { postToGroupMe } from './lib/groupme.mjs';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';

const TAG = '[roger-correction]';

/** Redis key claimed before a correction posts, so a re-run cannot double-post. */
const sentKey = (slug) => `roger:correction:sent:${slug}`;

const theleague = getLeagueBySlug('theleague');
const RULES_URL = `${leagueOrigin(theleague)}/theleague/rules#team-rosters`;

/**
 * Hand-authored corrections, keyed by slug. Each entry is written in Roger's
 * voice (witty, self-aware, NOT the Commissioner) and must do three things:
 * name the wrong answer, state the right one, and say the constitution has
 * been updated so nobody has to take the bot's word for it.
 *
 * Keep old entries after they've been sent — they're the public record of
 * what Roger has had to walk back.
 *
 * `sentAt` records a delivery that already happened. It is the durable half of
 * the double-post guard: the Redis claim below covers a re-run before anyone
 * commits, while `sentAt` survives a flushed cache, a rotated Redis, or a fresh
 * clone. Stamp it in the same commit that retires the sentinel.
 *
 * @type {Record<string, { league: 'theleague', sentAt?: string, text: string }>}
 */
const CORRECTIONS = {
  'taxi-squad-20-minimum': {
    league: 'theleague',
    sentAt: '2026-08-13',
    text: [
      "Correction, and it's on me.",
      '',
      'Gridiron Geeks asked whether taxi squad players count toward the 20-player-under-contract minimum. I said no. That was wrong.',
      '',
      "The rule says 20 players UNDER CONTRACT. Taxi squad guys are under contract — that's exactly why they're eating 50% of their base salary against your cap. Same goes for anyone stashed on IR. If he's signed to your franchise, he counts, wherever he happens to be sitting.",
      '',
      "Where I went off the rails: I treated the 22-man active roster as the whole universe. It isn't. That's a roster-size limit, not the definition of \"under contract.\" The Commissioner has ruled, and the constitution now spells it out in plain English so the next owner doesn't have to take a chatbot's word for it.",
      '',
      'Sorry, Geeks. Adjust your roster math accordingly.',
      '',
      RULES_URL,
    ].join('\n'),
  },
};

function parseArgs(argv) {
  const args = { correction: null, send: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--send') args.send = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--correction') args.correction = argv[++i];
    else if (arg.startsWith('--correction=')) args.correction = arg.slice('--correction='.length);
  }
  return args;
}

/**
 * Release a claim after a KNOWN non-delivery. Without this, a rotated bot id or
 * a 4xx from GroupMe would burn the slug permanently: the claim outlives the
 * failed run, and the workflow — the only caller holding the GroupMe secret —
 * cannot pass --force. A `fetch-error` is deliberately NOT released, because a
 * request that threw mid-flight may still have been delivered.
 */
async function releaseClaim(slug, reason) {
  const redis = getRedisConfig();
  if (!redis) return;
  try {
    await redisCommand(redis, ['DEL', sentKey(slug)]);
    console.warn(`${TAG} released the claim for "${slug}" after a known non-delivery (${reason}).`);
  } catch (err) {
    console.error(
      `${TAG} could not release ${sentKey(slug)} (${err.message}) — re-send will need --force.`
    );
  }
}

/**
 * Claim the slug so a re-run cannot double-post. Returns true when this run
 * owns the send. `SET key value NX` returns 'OK' on a fresh claim and null when
 * the key already exists.
 */
async function claimSend(slug, force) {
  const redis = getRedisConfig();
  if (!redis) {
    console.error(
      `${TAG} No Redis credentials in env — cannot claim ${sentKey(slug)}, refusing to post unguarded.`
    );
    return false;
  }
  if (force) {
    await redisCommand(redis, ['SET', sentKey(slug), new Date().toISOString()]);
    console.warn(`${TAG} --force: overwriting the send claim for "${slug}".`);
    return true;
  }
  const claimed = await redisCommand(redis, ['SET', sentKey(slug), new Date().toISOString(), 'NX']);
  if (claimed !== 'OK') {
    console.error(
      `${TAG} "${slug}" has already been posted (${sentKey(slug)} exists). Re-run with --force to send it again.`
    );
    return false;
  }
  return true;
}

async function main() {
  const { correction, send, force } = parseArgs(process.argv.slice(2));

  if (!correction) {
    console.error(`${TAG} --correction <slug> is required. Available: ${Object.keys(CORRECTIONS).join(', ')}`);
    process.exit(1);
  }

  const entry = CORRECTIONS[correction];
  if (!entry) {
    console.error(`${TAG} unknown correction "${correction}". Available: ${Object.keys(CORRECTIONS).join(', ')}`);
    process.exit(1);
  }

  console.log(`${TAG} correction: ${correction} (${entry.league})`);
  console.log('─'.repeat(72));
  console.log(entry.text);
  console.log('─'.repeat(72));

  if (send && entry.sentAt && !force) {
    console.error(
      `${TAG} "${correction}" was already delivered on ${entry.sentAt} (see its sentAt). Re-run with --force to send it again.`
    );
    process.exit(1);
  }

  // Check the bot id before claiming, so the most likely non-delivery (secret
  // unset or rotated) never burns the claim in the first place.
  if (send && !process.env.GROUPME_ROGER_BOT_ID) {
    console.error(`${TAG} GROUPME_ROGER_BOT_ID not set — nothing posted, claim untouched.`);
    process.exit(1);
  }

  // Claim BEFORE posting: a crash between claim and post costs one un-sent
  // correction (recoverable with --force), whereas claiming after a successful
  // post would leave a crashed run free to re-post to the whole league.
  if (send && !(await claimSend(correction, force))) process.exit(1);

  const result = await postToGroupMe({
    botId: process.env.GROUPME_ROGER_BOT_ID,
    text: entry.text,
    dryRun: !send,
    checkStatus: true,
    onDryRun: () => console.log(`${TAG} DRY RUN — not posted. Re-run with --send to deliver.`),
    onMissingBotId: () => console.error(`${TAG} GROUPME_ROGER_BOT_ID not set — nothing posted.`),
    onPosted: () => console.log(`${TAG} posted to GroupMe.`),
    onHttpError: (status) => console.error(`${TAG} GroupMe returned HTTP ${status} — not posted.`),
    onFetchError: (err) => console.error(`${TAG} GroupMe request failed: ${err.message}`),
  });

  // A --send that didn't land is a failure worth a non-zero exit; a dry run
  // is not. Release the claim first when we KNOW it didn't deliver, so the
  // correction stays sendable through CI without a --force it cannot pass.
  if (send && !result.posted) {
    if (isKnownNonDelivery(result.reason)) await releaseClaim(correction, result.reason);
    else if (result.reason === 'fetch-error') {
      console.error(
        `${TAG} claim for "${correction}" left in place — the request may have been delivered. Verify in GroupMe, then re-send with --force if it was not.`
      );
    }
    process.exit(1);
  }
}

/**
 * A GroupMe non-delivery we can be SURE about, so the send claim is safe to
 * release. `fetch-error` is excluded on purpose: a request that threw
 * mid-flight may still have reached GroupMe, and re-posting to the whole
 * league is worse than a stuck claim a human can clear with --force.
 * Exported for tests — this predicate decides whether a correction can be
 * re-sent, so a silent regression here is expensive in both directions.
 */
export function isKnownNonDelivery(reason) {
  return reason === 'no-bot-id' || (typeof reason === 'string' && reason.startsWith('http-'));
}

export { CORRECTIONS };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`${TAG} ${err.stack || err.message}`);
    process.exit(1);
  });
}
