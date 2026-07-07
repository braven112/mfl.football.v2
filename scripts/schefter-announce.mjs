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
 * It reuses the two primitives the scanners use:
 *   - appendToFeed()  (scripts/article-utils/feed-writer.mjs) — feed write + dedup
 *   - POST /v3/bots/post with the per-league Schefter bot id — GroupMe delivery
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const GROUPME_POST_URL = 'https://api.groupme.com/v3/bots/post';

// GroupMe rejects bot messages over 1000 chars. Headline is a feed card field
// (~60 chars by design); we cap generously so a runaway paste fails fast on the
// operator's screen instead of half-landing (feed written, GroupMe truncated).
const GROUPME_MAX_CHARS = 1000;
const HEADLINE_MAX_CHARS = 120;

/**
 * Per-league seeding config. Feed paths + bot-id env vars mirror the canonical
 * mapping in scripts/schefter-scan.mjs (TheLeague feed lives under src/data,
 * AFL under data/ — do not "normalize" these, they are load-bearing).
 * `newsPath` is where the feed renders, used to build the GroupMe deep link.
 */
const LEAGUE_TARGETS = {
  theleague: {
    navSlug: 'theleague',
    feedPath: path.join(projectRoot, 'src', 'data', 'theleague', 'schefter-feed.json'),
    botId: process.env.GROUPME_SCHEFTER_BOT_ID,
    baseUrl: 'https://theleague.us',
    newsPath: '/news',
  },
  afl: {
    navSlug: 'afl',
    feedPath: path.join(projectRoot, 'data', 'afl-fantasy', 'schefter-feed.json'),
    botId: process.env.GROUPME_AFL_SCHEFTER_BOT_ID,
    baseUrl: 'https://afl-fantasy.com',
    newsPath: '/afl-fantasy/news',
  },
};

// Default copy for THIS announcement. Overridable via ANNOUNCE_* env so the
// workflow can carry custom text without a code change.
const DEFAULT_HEADLINE =
  process.env.ANNOUNCE_HEADLINE ||
  'The site just got a facelift: dark mode + fresh player images';
const DEFAULT_BODY =
  process.env.ANNOUNCE_BODY ||
  "📱 SCHEFTER: The site just leveled up. Dark mode is officially LIVE — your retinas at 11pm finally get a break. And fresh player imagery is rolling out in select spots across the site. Same league, sharper look. Flip the theme toggle and see for yourself.";
const CTA_PREFIX = 'See what’s new →';

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

/**
 * Resolve the list of league target keys from a "theleague|afl|both" value.
 * Fails fast on an unrecognized value — this tool broadcasts to a whole league,
 * so a silent fallback on a typo (e.g. "theleage") could post to the wrong
 * audience. An empty/absent value defaults to theleague; anything else that
 * isn't recognized throws.
 */
function resolveLeagues(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '') return ['theleague'];
  if (v === 'both') return ['theleague', 'afl'];
  if (v === 'theleague') return ['theleague'];
  if (v === 'afl' || v === 'afl-fantasy') return ['afl'];
  throw new Error(
    `Unknown --leagues value "${raw}". Expected one of: theleague, afl, both.`,
  );
}

function buildDeepLink(target, postId) {
  const base = target.baseUrl.replace(/\/+$/, '');
  const enc = encodeURIComponent(postId);
  return `${base}${target.newsPath}?post=${enc}#post-${postId}`;
}

function buildPost({ slug, headline, body, navSlug, timestamp }) {
  return {
    id: `sf_announce_${slug}`,
    timestamp,
    type: 'article',
    category: 'articles',
    tier: 'standard',
    headline,
    body,
    franchiseIds: [],
    league: navSlug,
    authorId: 'claude',
  };
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

  const slug = String(args.slug || process.env.ANNOUNCE_SLUG || '').trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error(
      'ERROR: --slug is required and must be kebab-case (e.g. --slug dark-mode-2026-07).\n' +
        'It makes the post id deterministic so re-runs do not double-post.',
    );
    process.exit(1);
  }

  const headline = String(args.headline || DEFAULT_HEADLINE).trim();
  const body = String(args.body || DEFAULT_BODY).trim();
  if (!headline || !body) {
    console.error('ERROR: headline and body must be non-empty.');
    process.exit(1);
  }
  if (headline.length > HEADLINE_MAX_CHARS) {
    console.error(
      `ERROR: headline is ${headline.length} chars (max ${HEADLINE_MAX_CHARS}). ` +
        'Headlines render on a feed card — tighten it.',
    );
    process.exit(1);
  }

  let leagues;
  try {
    leagues = resolveLeagues(args.leagues || process.env.ANNOUNCE_LEAGUES);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  const dryRun = truthy(args['dry-run'] ?? process.env.ANNOUNCE_DRY_RUN, false);
  const sendGroupMeFlag = truthy(
    args.groupme ?? process.env.ANNOUNCE_SEND_GROUPME,
    true,
  );

  // Single timestamp for the whole run so both leagues share one moment.
  const timestamp = new Date().toISOString();

  // Pre-flight: validate EVERY target before writing anything, so a bad second
  // league can't leave the first one half-published (feed written + GroupMe
  // pinged) before the run aborts. Checks (non-dry-run): the feed file exists,
  // and — when sending GroupMe — the composed text fits GroupMe's 1000-char cap.
  // The post id (hence deep link) is deterministic, so this mirrors the real run.
  if (!dryRun) {
    for (const key of leagues) {
      const target = LEAGUE_TARGETS[key];
      if (!target) continue;
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
      if (sendGroupMeFlag) {
        const text = `${body}\n\n${CTA_PREFIX} ${buildDeepLink(target, `sf_announce_${slug}`)}`;
        if (text.length > GROUPME_MAX_CHARS) {
          console.error(
            `ERROR: GroupMe message for ${target.navSlug} is ${text.length} chars ` +
              `(max ${GROUPME_MAX_CHARS}). Shorten the body or run with --groupme false.`,
          );
          process.exit(1);
        }
      }
    }
  }

  log(`Schefter announcement — slug="${slug}" leagues=[${leagues.join(', ')}] ` +
    `dryRun=${dryRun} groupMe=${sendGroupMeFlag}`);
  log(`  headline: ${headline}`);

  let wroteAny = false;
  for (const key of leagues) {
    const target = LEAGUE_TARGETS[key];
    if (!target) {
      warn(`  [skip] unknown league target: ${key}`);
      continue;
    }
    const post = buildPost({ slug, headline, body, navSlug: target.navSlug, timestamp });

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
      const link = buildDeepLink(target, post.id);
      const text = `${body}\n\n${CTA_PREFIX} ${link}`;
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
