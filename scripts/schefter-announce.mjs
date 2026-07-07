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

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendToFeed } from './article-utils/feed-writer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const GROUPME_POST_URL = 'https://api.groupme.com/v3/bots/post';

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

/** Resolve the list of league target keys from a "theleague|afl|both" value. */
function resolveLeagues(raw) {
  const v = String(raw || 'theleague').trim().toLowerCase();
  if (v === 'both') return ['theleague', 'afl'];
  if (v === 'afl' || v === 'afl-fantasy') return ['afl'];
  return ['theleague'];
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
  const leagues = resolveLeagues(args.leagues || process.env.ANNOUNCE_LEAGUES);
  const dryRun = truthy(args['dry-run'] ?? process.env.ANNOUNCE_DRY_RUN, false);
  const sendGroupMeFlag = truthy(
    args.groupme ?? process.env.ANNOUNCE_SEND_GROUPME,
    true,
  );

  // Single timestamp for the whole run so both leagues share one moment.
  const timestamp = new Date().toISOString();

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
