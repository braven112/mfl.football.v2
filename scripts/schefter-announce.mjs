/**
 * Schefter announcement seeder — one-off, hand-authored feed post + GroupMe ping.
 *
 * Schefter's normal lanes (transaction scanner, rumor mill, article generator)
 * are all automated and data-driven, and none of them fit a site-feature
 * announcement ("the site now has dark mode", etc.). This script is the
 * deliberate manual path: it prepends a single hand-written post to the
 * league's schefter-feed.json (as an `article`-category post) and, unless
 * suppressed, delivers the same copy to the Schefter GroupMe bot.
 *
 * The pure compose logic (post shape, GroupMe text, validation) lives in
 * `src/utils/schefter-announce-core.mjs` so the admin endpoint's preview can't
 * drift from what this script actually ships. This file owns only the
 * side-effects: feed-file writes, GroupMe delivery, and CLI/env plumbing.
 *
 * IDEMPOTENCY: the post id is derived from a required --slug, so re-running with
 * the same slug is a no-op on the feed (appendToFeed dedups by id). GroupMe is
 * only sent when the feed post was NEWLY written this run, so an accidental
 * re-run cannot double-ping the chat.
 *
 * Roger's bot is NEVER a fallback for Schefter (same rule the scanners enforce):
 * if the Schefter bot id is unset we skip GroupMe rather than borrow Roger's.
 *
 * Usage (local dry run):
 *   node scripts/schefter-announce.mjs --slug dark-mode-2026-07 --dry-run
 *
 * Usage (live, needs GROUPME_SCHEFTER_BOT_ID in env):
 *   node scripts/schefter-announce.mjs --slug dark-mode-2026-07 --leagues theleague
 *
 * Env overrides (used by the workflow so copy lives in the dispatch inputs,
 * not hardcoded here): ANNOUNCE_HEADLINE, ANNOUNCE_BODY, ANNOUNCE_SLUG,
 * ANNOUNCE_LEAGUES ("theleague" | "afl" | "both"), ANNOUNCE_SEND_GROUPME
 * ("true"|"false"), ANNOUNCE_DRY_RUN ("true"|"false").
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendToFeed } from './article-utils/feed-writer.mjs';
import {
  ANNOUNCE_TARGETS,
  announcePostId,
  buildAnnouncePost,
  buildGroupMeText,
  validateAnnounceInput,
} from '../src/utils/schefter-announce-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const GROUPME_POST_URL = 'https://api.groupme.com/v3/bots/post';

/**
 * Side-effect config per league: the committed feed path + the GroupMe bot-id
 * env var. Mirrors the canonical mapping in scripts/schefter-scan.mjs (TheLeague
 * feed lives under src/data, AFL under data/ — do not "normalize", load-bearing).
 * Display fields (baseUrl / newsPath / navSlug) come from the shared core.
 */
const LEAGUE_FS = {
  theleague: {
    feedPath: path.join(projectRoot, 'src', 'data', 'theleague', 'schefter-feed.json'),
    botId: process.env.GROUPME_SCHEFTER_BOT_ID,
  },
  afl: {
    feedPath: path.join(projectRoot, 'data', 'afl-fantasy', 'schefter-feed.json'),
    botId: process.env.GROUPME_AFL_SCHEFTER_BOT_ID,
  },
};

const targetFor = (key) => ({ ...ANNOUNCE_TARGETS[key], ...LEAGUE_FS[key] });

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true; // boolean flag
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function truthy(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

async function sendGroupMe(target, text, { dryRun, log, warn }) {
  if (dryRun) {
    log(`  [dry-run] Would POST to GroupMe (${target.navSlug}):\n${text}\n`);
    return { posted: false, reason: 'dry-run' };
  }
  if (!target.botId) {
    // Roger is reserved for deadlines — never a Schefter fallback.
    warn(
      `  [${target.navSlug}] Schefter GroupMe bot id not set — skipping GroupMe (feed post still written)`,
    );
    return { posted: false, reason: 'no-bot-id' };
  }
  try {
    const res = await fetch(GROUPME_POST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: target.botId, text }),
    });
    const status = typeof res?.status === 'number' ? res.status : 0;
    if (status >= 200 && status < 300) {
      log(`  [${target.navSlug}] Posted announcement to GroupMe`);
      return { posted: true };
    }
    warn(`  [${target.navSlug}] GroupMe post failed: HTTP ${status}`);
    return { posted: false, reason: `http-${status}` };
  } catch (err) {
    warn(`  [${target.navSlug}] GroupMe post error: ${err?.message ?? err}`);
    return { posted: false, reason: 'fetch-error' };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (...a) => console.log(...a);
  const warn = (...a) => console.warn(...a);

  const dryRun = truthy(args['dry-run'] ?? process.env.ANNOUNCE_DRY_RUN, false);
  const sendGroupMeFlag = truthy(args.groupme ?? process.env.ANNOUNCE_SEND_GROUPME, true);

  // Validate + normalize via the shared core (same rules the endpoint enforces).
  const { errors, resolved } = validateAnnounceInput({
    slug: args.slug ?? process.env.ANNOUNCE_SLUG,
    headline: args.headline ?? process.env.ANNOUNCE_HEADLINE,
    body: args.body ?? process.env.ANNOUNCE_BODY,
    leagues: args.leagues ?? process.env.ANNOUNCE_LEAGUES,
    link: args.link ?? process.env.ANNOUNCE_LINK,
    sendGroupMe: sendGroupMeFlag,
  });
  if (errors.length) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    process.exit(1);
  }
  const { slug, headline, body, leagues, link } = resolved;
  const linkLabel = args['link-label'] ?? process.env.ANNOUNCE_LINK_LABEL;

  // Single timestamp for the whole run so both leagues share one moment.
  const timestamp = new Date().toISOString();

  // Pre-flight (non-dry-run): verify EVERY target feed file exists before
  // writing anything, so a bad second league can't leave the first one
  // half-published. GroupMe length was already validated by the core above.
  if (!dryRun) {
    for (const key of leagues) {
      const target = targetFor(key);
      try {
        await fs.access(target.feedPath);
      } catch {
        console.error(
          `ERROR: feed file not found for ${target.navSlug}: ` +
            `${path.relative(projectRoot, target.feedPath)}. ` +
            'Are you on a checkout with the league data committed?',
        );
        process.exit(1);
      }
    }
  }

  log(`Schefter announcement — slug="${slug}" leagues=[${leagues.join(', ')}] ` +
    `dryRun=${dryRun} groupMe=${sendGroupMeFlag}`);
  log(`  headline: ${headline}`);

  let wroteAny = false;
  for (const key of leagues) {
    const target = targetFor(key);
    const post = buildAnnouncePost({
      slug, headline, body, navSlug: target.navSlug, timestamp,
      link: link || undefined, linkLabel: linkLabel || undefined,
    });

    let written;
    if (dryRun) {
      // Don't touch the feed on a dry run; just report intent.
      log(`  [dry-run] Would prepend post ${post.id} to ${path.relative(projectRoot, target.feedPath)}`);
      written = true; // treat as "would write" so the GroupMe preview renders
    } else {
      // Feed existence already verified in the pre-flight above.
      written = await appendToFeed(target.feedPath, post);
      if (written) {
        wroteAny = true;
        log(`  [${target.navSlug}] Wrote ${post.id} to feed`);
      } else {
        log(`  [${target.navSlug}] Post ${post.id} already in feed — not re-posting (feed or GroupMe)`);
      }
    }

    // GroupMe only when the feed post is newly written — prevents double-pings.
    if (sendGroupMeFlag && written) {
      const text = buildGroupMeText({
        body,
        baseUrl: target.baseUrl,
        newsPath: target.newsPath,
        postId: announcePostId(slug),
        link: link || undefined,
      });
      await sendGroupMe(target, text, { dryRun, log, warn });
    } else if (!sendGroupMeFlag) {
      log(`  [${target.navSlug}] GroupMe suppressed (--groupme false)`);
    }
  }

  if (!dryRun && !wroteAny) {
    log('No new feed posts written (all targets already had this announcement).');
  }
  log('Done.');
}

main().catch((err) => {
  console.error('schefter-announce failed:', err);
  process.exit(1);
});
