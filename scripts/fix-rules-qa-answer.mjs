/**
 * Rules Q&A answer corrector — rewrites a stored "Ask Roger" answer in place.
 *
 * Roger's answers are generated once and then persisted forever: the POST
 * handler writes each Q&A into the Redis list at `rules-qa:all`, and the
 * rules-chat page renders that list verbatim. Nothing re-generates an old
 * answer, so fixing the constitution does NOT fix an answer already on the
 * page — a wrong ruling keeps being served to every owner who scrolls past it.
 * The only alternative the UI offers is deletion, which loses the owner's
 * question along with the bad answer.
 *
 * This script edits the answer field in place, preserving the entry's id,
 * askedBy and createdAt so the card stays where it is in the feed with the
 * asker's attribution intact.
 *
 * SAFETY: dry-run is the DEFAULT — it prints a before/after diff and writes
 * nothing. `--apply` performs the write. Matching is by regex against the
 * question text and MUST resolve to exactly one entry; the script refuses to
 * write on zero or multiple matches rather than guess.
 *
 * Usage (preview):
 *   node scripts/fix-rules-qa-answer.mjs --fix taxi-squad-20-minimum
 *
 * Usage (live, needs Upstash creds in env):
 *   node scripts/fix-rules-qa-answer.mjs --fix taxi-squad-20-minimum --apply
 */

import { getRedisConfig, redisCommand } from './lib/redis.mjs';

const TAG = '[fix-rules-qa]';

const REDIS_KEY = 'rules-qa:all';

/**
 * Hand-authored answer corrections, keyed by slug.
 *
 * `match` must identify the target question unambiguously. `answer` fully
 * replaces the stored answer and should follow Roger's house format: plain
 * text with light markdown, and a rulebook link on the final line using an
 * anchor from RULEBOOK_ANCHORS.
 *
 * @type {Record<string, { redisKey: string, match: RegExp, answer: string }>}
 */
const FIXES = {
  'taxi-squad-20-minimum': {
    redisKey: REDIS_KEY,
    match: /taxi squad count towards the 20 player minimum/i,
    answer: [
      "Correction — I got this one wrong the first time, and the Commissioner has since ruled. **Yes, taxi squad players DO count toward the 20-player minimum.**",
      '',
      "The test is right there in the wording: 20 players **under contract**. A taxi squad player is under contract — that's precisely why he carries a cap hit at 50% of his base salary. A player can't be charged against your cap as a contracted player and simultaneously not count as one.",
      '',
      "My original answer leaned on the fact that the constitution lists the 3 taxi spots as *additional* to the 22-man active roster. That part is true, and it's also beside the point: 22 is a limit on how many players you may carry, not a definition of who counts as under contract. Same reasoning applies to injured reserve — IR players are under contract too, and they count as well.",
      '',
      "The constitution now says this explicitly instead of leaving it to a chatbot's inference, which is how this went sideways in the first place. Sorry for the runaround.",
      '',
      '[Read the full rule](/theleague/rules#team-rosters)',
    ].join('\n'),
  },
};

function parseArgs(argv) {
  const args = { fix: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--fix') args.fix = argv[++i];
    else if (arg.startsWith('--fix=')) args.fix = arg.slice('--fix='.length);
  }
  return args;
}

async function main() {
  const { fix, apply } = parseArgs(process.argv.slice(2));

  if (!fix || !FIXES[fix]) {
    console.error(`${TAG} --fix <slug> required. Available: ${Object.keys(FIXES).join(', ')}`);
    process.exit(1);
  }
  const entry = FIXES[fix];

  const redis = getRedisConfig();
  if (!redis) {
    console.error(`${TAG} No Redis credentials in env (UPSTASH_REDIS_REST_URL / KV_REST_API_URL + token).`);
    process.exit(1);
  }

  // redisCommand returns the unwrapped `result` value, not the REST envelope.
  const raw = await redisCommand(redis, ['GET', entry.redisKey]);
  if (!raw) {
    console.error(`${TAG} ${entry.redisKey} is empty or missing — nothing to fix.`);
    process.exit(1);
  }

  // Upstash returns the stored JSON as a string.
  const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(items)) {
    console.error(`${TAG} ${entry.redisKey} did not contain an array.`);
    process.exit(1);
  }
  console.log(`${TAG} loaded ${items.length} stored Q&As from ${entry.redisKey}`);

  const matches = items
    .map((qa, index) => ({ qa, index }))
    .filter(({ qa }) => entry.match.test(qa?.question ?? ''));

  if (matches.length !== 1) {
    console.error(
      `${TAG} matcher resolved ${matches.length} entries (need exactly 1). Refusing to write.`
    );
    for (const { qa } of matches) console.error(`  - ${qa.id}: ${qa.question}`);
    process.exit(1);
  }

  const { qa, index } = matches[0];
  console.log(`${TAG} target: ${qa.id} (asked by ${qa.askedBy?.teamName ?? 'unknown'}, ${qa.createdAt})`);
  console.log(`${TAG} question: ${qa.question}`);
  console.log('── BEFORE ──');
  console.log(qa.answer);
  console.log('── AFTER ──');
  console.log(entry.answer);
  console.log('────────────');

  if (qa.answer === entry.answer) {
    console.log(`${TAG} answer already matches the correction — nothing to do.`);
    return;
  }

  if (!apply) {
    console.log(`${TAG} DRY RUN — no write performed. Re-run with --apply to persist.`);
    return;
  }

  // Preserve id / askedBy / createdAt so the card keeps its place and its
  // attribution; only the answer text changes.
  items[index] = { ...qa, answer: entry.answer };
  const setRes = await redisCommand(redis, ['SET', entry.redisKey, JSON.stringify(items)]);
  if (setRes !== 'OK') {
    console.error(`${TAG} SET did not return OK: ${JSON.stringify(setRes)}`);
    process.exit(1);
  }
  console.log(`${TAG} wrote corrected answer for ${qa.id}.`);
}

main().catch((err) => {
  console.error(`${TAG} ${err.stack || err.message}`);
  process.exit(1);
});
