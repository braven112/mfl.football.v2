#!/usr/bin/env node

/**
 * Weekly Changelog Rollup Script
 *
 * Reads src/data/weekly-changelog-staging.json and generates ONE What's New
 * article PER LEAGUE — the only thing that publishes in an ordinary week.
 *
 * WHY ONE ARTICLE A WEEK. Between Aug 26 and Sep 6 2026, forty entries landed
 * in whats-new.json: three and a half articles a day, each written at full
 * length, none of them read. Everything user-facing now stages here and
 * compiles on Monday into one scannable list — features first, fixes under
 * them, one line each, with the depth behind a link to a /guides page or to
 * the marquee article that already ran. Fewer things to read; more in each.
 *
 * WHAT THE FEATURED CHANGE DOES. Exactly one staged change per league carries
 * `featured: true`, and it supplies the article's `headline`, its `lede` and
 * its screenshot. The script assembles; it does not write. Voice comes from
 * whoever staged the change, which is the only place a human is in the loop.
 *
 * Every staged change must declare a `league` ("theleague" | "afl" | "both").
 * Changes route to the matching league's article so AFL fixes never appear on
 * The League's What's New page and vice versa. Each generated entry carries an
 * explicit `leagues` tag — display code fails closed on untagged entries, and
 * tests/whats-new-data.test.ts blocks untagged data.
 *
 * The marquee exception still exists: a launch big enough to announce the day
 * it ships gets its own whats-new.json entry, and stages a one-line change
 * carrying `entryId` so the Monday article still names it and links to it.
 *
 * Run manually or via GitHub Actions every Monday at 8pm PT.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { WHATS_NEW_ACTIVE_MAX, WHATS_NEW_ARCHIVE_DIR } from './lib/retention-policy.mjs';
import {
  BOTH_TAG,
  FEATURE_TYPES,
  FIX_TYPES,
  leaguesForStagedChange,
  buildDateRange,
  buildDescription,
  buildSummary,
} from './lib/weekly-changelog-format.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const STAGING_PATH = resolve(ROOT, 'src/data/weekly-changelog-staging.json');
const WHATS_NEW_PATH = resolve(ROOT, 'src/data/whats-new.json');
const ARCHIVE_DIR = resolve(ROOT, WHATS_NEW_ARCHIVE_DIR);

/** Mirrors FEATURE_HERO_DAYS in src/utils/hero-resolver.ts — the default
 *  rotation window an entry gets when it declares no `heroRotationDays`. */
const FEATURE_HERO_DAYS = 7;

/**
 * Get the Monday of the current week.
 */
function getCurrentMonday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday;
}

/**
 * Get next Monday from a given date.
 */
function getNextMonday(from) {
  const d = new Date(from);
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(d) {
  // Local parts, NOT toISOString(): getCurrentMonday() picks the day with
  // local getters, so pairing it with a UTC serialiser makes the two disagree
  // west of Greenwich — a Monday-evening run in PT would stamp Tuesday's date
  // and mint an id no other run can collide with, publishing the week twice.
  // That is the failure the `--week` Monday check refuses by hand; the default
  // path should not be able to reach it either.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Per-league rollup config derived from the league registry (single source of
 * truth — never hardcode league slugs or paths). Keyed by navSlug (the tag
 * vocabulary used in staging + whats-new.json). The default league keeps the
 * historical unsuffixed `weekly-rollup-<date>` id.
 */
const LEAGUE_ROLLUPS = Object.fromEntries(
  ALL_LEAGUES.map((league) => [
    league.navSlug,
    {
      idSuffix: league.slug === DEFAULT_LEAGUE_SLUG ? '' : `-${league.navSlug}`,
      leagues: [league.navSlug],
    },
  ]),
);

const VALID_CHANGE_LEAGUES = [...Object.keys(LEAGUE_ROLLUPS), BOTH_TAG];

// ── Main ──

/**
 * Keep the active file at WHATS_NEW_ACTIVE_MAX entries; everything older
 * moves to src/data/whats-new-archive/<year>.json (append-union by id,
 * newest-first). Only the archive index + permalink pages load the archive
 * files, so the homepage/hero bundle stays bounded while old permalinks
 * keep resolving. Screenshots stay in public/assets/whats-new — archived
 * entries still render them.
 */
const enforceWhatsNewCap = (entries) => {
  if (entries.length <= WHATS_NEW_ACTIVE_MAX) return { active: entries, archived: 0 };
  // An entry still inside its hero rotation window must stay in the ACTIVE
  // file whatever its position: the hero resolver and the homepage row read
  // whats-new-entries.ts, which imports the active file only, so archiving one
  // pulls a live promo off the homepage early. Publishing two entries into a
  // full 40/40 file did exactly that to the AFL's Throwback Week promo —
  // `heroRotationDays: 14`, six days still to run, evicted the moment the
  // cap was enforced. The cap is there to bound the bundle, not to end a
  // campaign, so a handful of retained entries is the correct trade.
  const stillPromoting = (entry) => {
    if (entry?.excludeFromHero === true) return false;
    const at = Date.parse(`${entry?.date}T12:00:00Z`);
    if (Number.isNaN(at)) return false;
    const days = (Date.now() - at) / 86_400_000;
    return days >= 0 && days <= (entry.heroRotationDays ?? FEATURE_HERO_DAYS);
  };

  const active = entries.slice(0, WHATS_NEW_ACTIVE_MAX);
  const overflow = [];
  for (const entry of entries.slice(WHATS_NEW_ACTIVE_MAX)) {
    if (stillPromoting(entry)) {
      console.log(`Retained past the cap (hero window still open): ${entry.id}`);
      active.push(entry);
    } else {
      overflow.push(entry);
    }
  }
  const byYear = new Map();
  for (const entry of overflow) {
    const year = String(entry.date ?? '').slice(0, 4) || 'undated';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(entry);
  }
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const [year, yearEntries] of byYear) {
    const file = resolve(ARCHIVE_DIR, `${year}.json`);
    let existing = [];
    try {
      existing = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      // new archive year
    }
    const seen = new Set(existing.map((e) => e.id));
    const merged = [...existing, ...yearEntries.filter((e) => !seen.has(e.id))];
    merged.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
    console.log(`Archived ${yearEntries.length} entries -> ${file}`);
  }
  return { active, archived: overflow.length };
};

// This script PUBLISHES and then EMPTIES the staging queue, so an unrecognised
// flag must never be shrugged off. `--dry-run` looks like it should exist,
// doesn't, and used to fall straight through to the real rollup — consuming
// every staged change (including other people's) on what the caller believed
// was a preview.
const KNOWN_FLAGS = new Set(['--cap-only', '--week']);
const argv = process.argv.slice(2);

/**
 * `--week YYYY-MM-DD` — publish under a named week instead of the current one.
 *
 * The article's id and date come from `getCurrentMonday()`, which makes the
 * script unable to build any week but the one the clock is standing in: a
 * Monday job that died cannot be re-run on Tuesday, and next week's article
 * cannot be produced early to look at. Both are real needs and neither is
 * served by editing the published JSON afterwards.
 *
 * It must name a MONDAY. Every id in the file is `weekly-rollup-<monday>`, and
 * a Wednesday here would mint an id no other run can ever collide with — which
 * sounds harmless and is the opposite: the real Monday run would then publish a
 * SECOND article for the same week's changes.
 */
const weekIndex = argv.indexOf('--week');
const weekOverride = weekIndex === -1 ? null : argv[weekIndex + 1];
if (weekIndex !== -1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOverride ?? '')) {
    console.error(`ERROR: --week wants a YYYY-MM-DD date, got ${JSON.stringify(weekOverride)}.`);
    process.exit(1);
  }
  if (new Date(`${weekOverride}T12:00:00`).getDay() !== 1) {
    console.error(
      `ERROR: --week ${weekOverride} is not a Monday. Article ids are keyed to the week's ` +
        `Monday; any other day mints an id the real Monday run cannot collide with, so the ` +
        `week would publish twice.`,
    );
    process.exit(1);
  }
}

const unknownFlags = argv.filter(
  (a, i) => !KNOWN_FLAGS.has(a) && !(weekIndex !== -1 && i === weekIndex + 1),
);
if (unknownFlags.length > 0) {
  console.error(`ERROR: unknown argument(s): ${unknownFlags.join(' ')}`);
  console.error(`Supported flags: ${[...KNOWN_FLAGS].join(', ')} (no arguments = publish the staging queue).`);
  console.error('There is no dry-run mode: this script always writes.');
  process.exit(1);
}

// --cap-only: enforce the active-file cap without publishing staging (used
// for the initial migration and safe to re-run any time).
if (argv.includes('--cap-only')) {
  const entries = JSON.parse(readFileSync(WHATS_NEW_PATH, 'utf-8'));
  const { active, archived } = enforceWhatsNewCap(entries);
  if (archived > 0) writeFileSync(WHATS_NEW_PATH, JSON.stringify(active, null, 2) + '\n');
  console.log(`Cap enforced: ${active.length} active, ${archived} moved to archive.`);
  process.exit(0);
}

const staging = JSON.parse(readFileSync(STAGING_PATH, 'utf-8'));

if (!staging.changes || staging.changes.length === 0) {
  console.log('No changes in staging file. Skipping rollup.');
  process.exit(0);
}

const changes = staging.changes;

// Refuse to run with untagged changes — a guessed league is how cross-league
// leaks happen. tests/whats-new-data.test.ts catches this at PR time; this
// check makes the Monday cron fail loudly instead of publishing a mistag.
// A change whose `type` is in neither bucket renders in NO section, and the
// staging reset then destroys it — a silent loss of somebody's work, which is
// exactly what the `league` check below already refuses to allow. Same
// treatment: fail before publishing, preserve the queue.
const VALID_CHANGE_TYPES = [...FEATURE_TYPES, ...FIX_TYPES];
const mistyped = changes.filter((c) => !VALID_CHANGE_TYPES.includes(c.type));
if (mistyped.length > 0) {
  console.error(
    `ERROR: staged changes with a type the article cannot render ` +
      `(want ${VALID_CHANGE_TYPES.join(' | ')}):`,
  );
  for (const c of mistyped) {
    console.error(`  - [${c.date}] type=${JSON.stringify(c.type)} ${(c.summary ?? '').slice(0, 60)}`);
  }
  console.error('Nothing was published; staging is preserved.');
  process.exit(1);
}

const untagged = changes.filter((c) => !VALID_CHANGE_LEAGUES.includes(c.league));
if (untagged.length > 0) {
  console.error(`ERROR: staged changes missing a valid "league" (${VALID_CHANGE_LEAGUES.join(' | ')}):`);
  for (const c of untagged) console.error(`  - [${c.date}] ${(c.summary ?? '(no summary)').slice(0, 80)}`);
  process.exit(1);
}

const today = weekOverride ?? formatDate(getCurrentMonday());
const whatsNew = JSON.parse(readFileSync(WHATS_NEW_PATH, 'utf-8'));
const existingIds = new Set(whatsNew.map((e) => e.id));

const newEntries = [];
/** Leagues whose article for this week was already out — see the guard below. */
const alreadyPublished = [];

for (const [leagueSlug, config] of Object.entries(LEAGUE_ROLLUPS)) {
  // Routed through the shared helper, never an inline `=== 'both'`: the
  // expansion is a rule (see BOTH_LEAGUES) and the PR-time data test has to
  // apply the identical one.
  const leagueChanges = changes.filter((c) =>
    leaguesForStagedChange(c).includes(leagueSlug),
  );
  if (leagueChanges.length === 0) continue;

  const id = `weekly-rollup-${today}${config.idSuffix}`;
  // Same-week re-run guard: this week's rollup was already published (e.g. a
  // mid-week workflow_dispatch after the Monday cron). Abort WITHOUT touching
  // whats-new.json or resetting staging — a duplicate id breaks the uniqueness
  // test and getStaticPaths; the staged changes roll into next Monday instead.
  if (existingIds.has(id)) {
    // NOT an error, and specifically not `exit 1`. `--week` exists so a week
    // can be published early (to look at) or re-run after a failure, which
    // makes "this week is already out" a state the scheduled job will
    // genuinely meet — and a red Monday job with no article is a worse
    // outcome than a skipped one. Staging is PRESERVED, so nothing staged
    // since is lost: it rolls into the next run and appears a week later
    // under that week's heading.
    console.log(
      `"${id}" already exists — this week was already published (see --week). ` +
        `Skipping ${leagueSlug}; its staged changes are preserved for the next run.`,
    );
    alreadyPublished.push(leagueSlug);
    continue;
  }

  const features = leagueChanges.filter((c) => FEATURE_TYPES.has(c.type));
  const fixes = leagueChanges.filter((c) => FIX_TYPES.has(c.type));
  const dateRange = buildDateRange(leagueChanges);

  // The featured change supplies this article's face: its headline, its lede
  // and its screenshot. Scoped per league rather than per FILE (the old
  // top-level `featuredImage` + `featuredImageLeague` pair) because a change
  // tagged `both` is legitimately both leagues' headline, while one tagged
  // `afl` must never put the AFL's UI on TheLeague's What's New page. Routing
  // it through the change's own league tag makes that structural instead of a
  // second field somebody has to remember to set.
  const featuredForLeague = leagueChanges.filter((c) => c.featured === true);
  if (featuredForLeague.length > 1) {
    console.error(
      `ERROR: ${leagueSlug} has ${featuredForLeague.length} staged changes flagged "featured" ` +
        `— exactly one supplies the week's headline and screenshot. ` +
        `Nothing was published; staging is preserved.\n` +
        featuredForLeague.map((c) => `  - [${c.date}] ${String(c.summary ?? '').slice(0, 70)}`).join('\n'),
    );
    process.exit(1);
  }
  const featured = featuredForLeague[0] ?? null;

  // A week that shipped a page or a feature and flagged nothing has no
  // screenshot and no headline — the exact "wall of text nobody reads" this
  // format replaced. Fail before publishing rather than after.
  if (!featured && features.length > 0) {
    console.error(
      `ERROR: ${leagueSlug} staged ${features.length} feature-level change(s) but none is flagged ` +
        `"featured": true. The weekly article needs one to supply its headline, lede and screenshot. ` +
        `Nothing was published; staging is preserved.`,
    );
    process.exit(1);
  }

  const entry = {
    id,
    date: today,
    title: featured?.headline || `The Week in Review (${dateRange})`,
    summary: featured?.lede || buildSummary({ features, fixes }),
    description: buildDescription({ features, fixes, dateRange }),
    category: 'weekly',
    // No `link`: the homepage card and the hero CTA both fall back to this
    // entry's own article, which is where the week's detail actually is.
    // Pointing at /whats-new sent the reader to a list of the thing they were
    // already reading.
    icon: 'news',
    // Hero eligibility is a per-change human call made at staging time, not a
    // property of the week. One flagged change is enough to put the week's
    // article in the rotation — where P0/P1 league events still outrank it
    // (see resolveHeroState), which is the point: in season, the auction
    // beats the changelog.
    // Hero eligibility needs BOTH the human call and the art: the composite
    // hero renders the entry's screenshot, and only a `featured` change
    // supplies one. A fixes-only week is not required to have a featured
    // change, so `heroWorthy` alone could put an imageless, generically-titled
    // "The Week in Review" card in the hero.
    excludeFromHero: !(featured?.image && leagueChanges.some((c) => c.heroWorthy === true)),
    leagues: config.leagues,
  };

  // AFL-only copy, passed through from the featured change: the AFL homepage
  // hero renders a two-part display line (a plain phrase plus a colour-accented
  // closing word) and derives it from `title` when unset. A rollup title runs
  // long for that condensed type, so a featured change may author the pair
  // itself. Half a pair is worse copy than the derived one, hence both or
  // neither — `whats-new-data` enforces that on the published entry, and the
  // staging test catches it a week earlier.
  if (featured?.heroHeadline) {
    entry.heroHeadline = featured.heroHeadline;
    if (featured.heroAccentWord) entry.heroAccentWord = featured.heroAccentWord;
  }

  if (featured?.image) {
    // `entry.image` is a BARE FILENAME — every consumer builds the URL as
    // `/assets/whats-new/${entry.image}` (WhatsNewDetailPage, WhatsNewRow,
    // FeatureCompositeHero). A staged full path copied verbatim published
    // `/assets/whats-new//assets/whats-new/foo.webp` — a broken image on the
    // live entry and a red `whats-new-data` test blocking every PR until
    // someone repaired the published JSON by hand. Accept either form, store
    // the basename.
    entry.image = featured.image.split('/').pop();
    entry.imageAlt = featured.imageAlt || 'This week on the site';
  }

  newEntries.push({ leagueSlug, entry });
}

// Prepend to whats-new.json (newest first), then enforce the active cap —
// overflow moves to the per-year archive files.
whatsNew.unshift(...newEntries.map((n) => n.entry));
const { active } = enforceWhatsNewCap(whatsNew);
writeFileSync(WHATS_NEW_PATH, JSON.stringify(active, null, 2) + '\n');

// Reset staging file for next week — but ONLY if everything was published.
// A league skipped above still needs its changes, and emptying the queue here
// would destroy exactly the work the skip was protecting.
if (alreadyPublished.length > 0) {
  console.log(
    `Staging PRESERVED: ${alreadyPublished.join(', ')} already had this week's article. ` +
      `Those changes roll into the next run.`,
  );
  for (const { entry } of newEntries) {
    console.log(`Rollup complete: "${entry.title}" [${entry.leagues.join(', ')}] (${entry.id})`);
  }
  process.exit(0);
}

// Reset staging file for next week
const nextMonday = getNextMonday(new Date());
const resetStaging = {
  weekOf: formatDate(nextMonday),
  changes: [],
};
writeFileSync(STAGING_PATH, JSON.stringify(resetStaging, null, 2) + '\n');

for (const { entry } of newEntries) {
  console.log(`Rollup complete: "${entry.title}" [${entry.leagues.join(', ')}] (${entry.id})`);
}
console.log(`Staging reset for week of ${resetStaging.weekOf}`);
