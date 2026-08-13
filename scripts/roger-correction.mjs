/**
 * Roger correction poster — one-off, hand-authored "I got that wrong" post to
 * the league GroupMe.
 *
 * Ask Roger is a chatbot, and chatbots are occasionally confidently wrong. When
 * a bad answer has already been read by owners, fixing the constitution isn't
 * enough — the people who acted on the wrong answer never see the diff. This
 * script is the deliberate manual path for walking one back in the group chat.
 *
 * It is intentionally NOT automated and NOT wired to a workflow: a correction
 * is a commissioner-reviewed act, and the copy is hand-written each time.
 *
 * SAFETY: dry-run is the DEFAULT. GroupMe has no dedup and no unsend, so the
 * live post requires an explicit --send. Re-running with --send posts again.
 *
 * Usage (preview the exact text, no network):
 *   node scripts/roger-correction.mjs --correction taxi-squad-20-minimum
 *
 * Usage (live, needs GROUPME_ROGER_BOT_ID in env):
 *   node scripts/roger-correction.mjs --correction taxi-squad-20-minimum --send
 */

import { getLeagueBySlug, leagueOrigin } from '../src/config/leagues-data.mjs';
import { postToGroupMe } from './lib/groupme.mjs';

const TAG = '[roger-correction]';

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
 * @type {Record<string, { league: 'theleague', text: string }>}
 */
const CORRECTIONS = {
  'taxi-squad-20-minimum': {
    league: 'theleague',
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
  const args = { correction: null, send: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--send') args.send = true;
    else if (arg === '--correction') args.correction = argv[++i];
    else if (arg.startsWith('--correction=')) args.correction = arg.slice('--correction='.length);
  }
  return args;
}

async function main() {
  const { correction, send } = parseArgs(process.argv.slice(2));

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
  // is not.
  if (send && !result.posted) process.exit(1);
}

main().catch((err) => {
  console.error(`${TAG} ${err.stack || err.message}`);
  process.exit(1);
});
