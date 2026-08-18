#!/usr/bin/env node
/**
 * Post ONE hand-written message to a league's Schefter GroupMe bot.
 *
 * Why this exists separately from schefter-announce.mjs: that lane seeds a
 * FEED post and mirrors it to the chat, which is right for "here's a new
 * feature" and wrong for a reply to something an owner said. A chat reply
 * addressed to one team should not become a permanent Schefter Report
 * article. This writes nothing — chat only.
 *
 * Usage:
 *   node scripts/post-groupme-message.mjs --league afl-fantasy --text "..."   # rehearsal
 *   node scripts/post-groupme-message.mjs --league afl-fantasy --text "..." --send
 *
 * The bot id comes from the per-league Schefter table (never a hardcoded env
 * name), and the text goes out through the shared postToGroupMe primitive so
 * it picks up the trailing-punctuation sanitizer — a message that ends on a
 * URL otherwise ships a link with the period glued into the href.
 */
import { SCHEFTER_LEAGUES } from './lib/schefter-leagues.mjs';
import { postToGroupMe } from './lib/groupme.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

const truthy = (v, fallback = false) => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = args.league ?? process.env.GROUPME_LEAGUE;
  const text = args.text ?? process.env.GROUPME_TEXT;
  /**
   * Rehearsal is the DEFAULT, and sending is the thing you have to ask for:
   * this posts to a chat twelve people read, so the accident should be a
   * no-op, not a broadcast. `--send` is the opt-out; the workflow passes
   * GROUPME_DRY_RUN=false explicitly when its own dry_run box is unchecked.
   */
  const dryRun = args.send === true
    ? false
    : truthy(args['dry-run'] ?? process.env.GROUPME_DRY_RUN, true);

  // The Schefter table keys on navSlug as `slug` ('afl') and keeps the
  // registry slug ('afl-fantasy') alongside it; accept either spelling so a
  // dispatch doesn't fail on which one the caller happened to type.
  const league = SCHEFTER_LEAGUES.find(l => l.slug === slug || l.registrySlug === slug);
  if (!league) {
    console.error(
      `ERROR: unknown league "${slug}". Known: ` +
        SCHEFTER_LEAGUES.map(l => `${l.slug} / ${l.registrySlug}`).join(', '),
    );
    process.exit(1);
  }
  // `--text` with no value parses as the BOOLEAN true, which would otherwise
  // survive the blank check and post the literal string "true" to the league.
  if (typeof text !== 'string' || !text.trim()) {
    console.error('ERROR: --text is required and must carry a value, e.g. --text "your message".');
    process.exit(1);
  }
  // GroupMe truncates hard past ~1000 chars; fail loudly rather than post a
  // message that ends mid-sentence.
  if (text.length > 1000) {
    console.error(`ERROR: text is ${text.length} chars; GroupMe's limit is 1000.`);
    process.exit(1);
  }

  console.log(`GroupMe post — league=${league.slug} dryRun=${dryRun} chars=${text.length}`);

  const { posted, reason } = await postToGroupMe({
    botId: league.groupMeSchefterBotId,
    text,
    dryRun,
    checkStatus: true,
    onDryRun: (sent) => console.log(`[dry-run] Would POST to ${league.slug}:\n---\n${sent}\n---`),
    onMissingBotId: () => console.error(`ERROR: no Schefter bot id configured for ${league.slug}.`),
    onPosted: () => console.log(`Posted to ${league.slug}.`),
    onHttpError: (status) => console.error(`ERROR: GroupMe returned HTTP ${status}`),
    onFetchError: (err) => console.error(`ERROR: ${err?.message ?? err}`),
  });

  // A missing bot id or a failed POST must fail the job — a silent no-op here
  // reads as "message sent" in the Actions summary.
  if (!posted && reason !== 'dry-run') process.exit(1);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
