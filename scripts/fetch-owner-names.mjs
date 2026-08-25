#!/usr/bin/env node
/**
 * Populate `displayName` in src/data/owners-registry.json from MFL.
 *
 * MFL's `league` export returns owner names — but ONLY to a request carrying
 * the cookie of a user with commissioner access. Every league.json committed
 * in this repo was fetched unauthenticated, which is why all 44 of them carry
 * no owner field at all and why the feature shipped anonymous. This script is
 * the authenticated path.
 *
 * ── PRIVACY: NAMES ONLY ───────────────────────────────────────────────────
 * The same authenticated response also contains EMAIL ADDRESSES. This script
 * extracts names and nothing else: emails are never stored, never printed,
 * never written to disk, and the raw response is never cached. If you add a
 * field here, check it is not PII first. `assertNoContactInfo` fails the run
 * if anything email-shaped reaches the output.
 *
 * ── Why this can name FORMER owners too ───────────────────────────────────
 * Each MFL league-year is its own league. Fetching 2009's league with a
 * commissioner cookie returns the people who owned those franchises IN 2009 —
 * not today's owners. So a year-by-year sweep can name the previous owners
 * whose seasons this whole feature exists to surface, not just the 40 current
 * ones.
 *
 * ── Credentials ───────────────────────────────────────────────────────────
 * Any one of these, in the order resolveCookies() tries them:
 *   MFL_USER_ID=... MFL_IS_COMMISH=... node scripts/fetch-owner-names.mjs
 *   MFL_COOKIE='MFL_USER_ID=...; MFL_IS_COMMISH=...' node scripts/...
 *   MFL_USERNAME=... MFL_PASSWORD=... node scripts/fetch-owner-names.mjs
 *
 * MFL_IS_COMMISH is the one that matters — names come back only to a
 * commissioner session, so the other cookie alone authenticates and returns
 * nothing.
 *
 * Usage:
 *   node scripts/fetch-owner-names.mjs                 # dry run — prints what it would set
 *   node scripts/fetch-owner-names.mjs --write         # apply to owners-registry.json
 *   node scripts/fetch-owner-names.mjs --league=afl    # one league
 *   node scripts/fetch-owner-names.mjs --year=2009     # one year
 *
 * A name a human already set is NEVER overwritten. A tenure where MFL reports
 * two different owners is reported and left alone — that is a tenure the
 * registry should probably SPLIT, and guessing would bury the signal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { mflFetch, loginToMFL } from './lib/mfl-api.mjs';
import { LEAGUE_SLUGS, resolveLeagueArg } from './lib/owner-tenure-inputs.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGISTRY_PATH = path.join(ROOT, 'src/data/owners-registry.json');

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const opts = { league: null, year: null, write: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--write') opts.write = true;
    else if (arg === '--dry-run') opts.write = false;
    else if (arg.startsWith('--league=')) opts.league = resolveLeagueArg(arg.slice('--league='.length));
    else if (arg.startsWith('--year=')) opts.year = Number(arg.slice('--year='.length));
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/fetch-owner-names.mjs [--league=<slug|afl>] [--year=YYYY] [--write]\n' +
          '  Needs MFL_USER_ID + MFL_IS_COMMISH, or MFL_COOKIE, or\n' +
          '  MFL_USERNAME + MFL_PASSWORD.\n' +
          '  Dry run by default. Names only — emails are never stored.'
      );
      process.exit(0);
    }
  }
  return opts;
}

/**
 * The only fields we are willing to read off a franchise. Deliberately a
 * whitelist: MFL adds fields over time and a blacklist would silently start
 * capturing whatever it adds next.
 */
const NAME_FIELDS = ['owner_name', 'ownerName'];

export const cleanName = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  // MFL sometimes stores a co-owned team as "A and B" / "A & B" / "A, B".
  // Keep it whole — the registry expresses co-ownership with two PEOPLE and
  // `shared: true`, and silently splitting here would invent claims.
  return trimmed;
};

/** Fail loudly rather than let anything email-shaped reach the registry. */
export const assertNoContactInfo = (value, where) => {
  if (typeof value !== 'string') return;
  if (/@/.test(value) || /https?:\/\//i.test(value)) {
    throw new Error(
      `Refusing to write "${where}": value looks like contact info, not a name. ` +
        `This script must never store email addresses.`
    );
  }
};

/**
 * Commissioner cookies for `mflFetch`, as an OBJECT of cookie name -> value.
 *
 * `mflFetch` builds its header with `Object.entries(cookies)`, so handing it a
 * STRING yields `0=h; 1=t; 2=t...` — a garbage header that MFL ignores, which
 * comes back as a perfectly valid response carrying no owner names. That is the
 * worst possible failure for this script: silent, and indistinguishable from a
 * league that simply has none.
 *
 * THREE sources, tried in this order, and a source is taken only when it
 * yields BOTH cookies (see the loop below for why a half-set one must not win):
 *
 *   1. MFL_USER_ID + MFL_IS_COMMISH — the stored session cookies. PREFERRED,
 *      and what the rest of this repo drives MFL with
 *      (`apply-pending-contracts.mjs`, `sync-draft-pick-contracts.mjs`,
 *      `export-best-ball-draft.mjs`, `mfl-calendar-event.mjs` all do this).
 *   2. MFL_COOKIE — a whole Cookie header pasted from a browser, split back
 *      into the pair. Convenient for a local run.
 *   3. MFL_USERNAME + MFL_PASSWORD — a fresh login, which RETURNS those same
 *      two cookies as `{ mflUserId, mflIsCommish }`.
 *
 * `MFL_IS_COMMISH` is the one that matters here. Owner names are returned only
 * to a commissioner session, so a request carrying MFL_USER_ID alone
 * authenticates fine and still comes back anonymous.
 */
export async function resolveCookies() {
  const envUserId = process.env.MFL_USER_ID;
  const envCommish = process.env.MFL_IS_COMMISH;
  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;

  /**
   * A whole Cookie header pasted from a browser, e.g.
   * MFL_COOKIE='MFL_USER_ID=abc; MFL_IS_COMMISH=def'. Split back into the two
   * cookies rather than passing the string on: mflFetch runs Object.entries()
   * over what it is given, so a raw string becomes "0=M; 1=F; 2=L…" — a header
   * MFL ignores while answering with a valid, entirely anonymous payload.
   */
  const parseCookieHeader = (header) => {
    const parsed = Object.fromEntries(
      header
        .split(';')
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
          const eq = pair.indexOf('=');
          return eq === -1 ? [pair, ''] : [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()];
        })
    );
    return { mflUserId: parsed.MFL_USER_ID, mflIsCommish: parsed.MFL_IS_COMMISH };
  };

  /**
   * Sources in preference order, each evaluated lazily.
   *
   * A source is only taken when it is COMPLETE — both cookies. A half-set
   * source must not win: MFL_USER_ID alone authenticates and returns an
   * anonymous payload, so short-circuiting on it would skip a login that could
   * have produced a real commissioner session and hand back a run that finds
   * no names while looking like it worked.
   */
  const cookieHeaderEnv = process.env.MFL_COOKIE;
  const sources = [
    { name: 'MFL_USER_ID + MFL_IS_COMMISH', get: () => ({ mflUserId: envUserId, mflIsCommish: envCommish }) },
    { name: 'MFL_COOKIE', get: () => (cookieHeaderEnv ? parseCookieHeader(cookieHeaderEnv) : {}) },
    {
      name: 'MFL_USERNAME + MFL_PASSWORD',
      // loginToMFL resolves to { mflUserId, mflIsCommish } — NOT { cookies }.
      get: () => (username && password ? loginToMFL(username, password) : {}),
    },
  ];

  let partial = null;
  let mflUserId;
  let mflIsCommish;
  for (const source of sources) {
    const result = (await source.get()) ?? {};
    if (result.mflUserId && result.mflIsCommish) {
      ({ mflUserId, mflIsCommish } = result);
      break;
    }
    // Remember the first usable-but-incomplete source, in case nothing better
    // turns up — running with it and a loud warning beats refusing to run.
    if (!partial && result.mflUserId) partial = { ...result, name: source.name };
  }

  if (!mflUserId && partial) {
    ({ mflUserId, mflIsCommish } = partial);
    console.error(
      `WARNING: ${partial.name} supplied MFL_USER_ID but no MFL_IS_COMMISH, and\n` +
        'no other source produced a complete pair. MFL returns owner names ONLY\n' +
        'to a commissioner session, so this run will almost certainly find none.'
    );
  }

  if (!mflUserId) {
    console.error(
      'No credentials. Set MFL_USER_ID + MFL_IS_COMMISH, or MFL_COOKIE,\n' +
        'or MFL_USERNAME + MFL_PASSWORD.\n' +
        'Owner names are only returned to a user with commissioner access.'
    );
    process.exit(1);
  }

  return { MFL_USER_ID: mflUserId, MFL_IS_COMMISH: mflIsCommish };
}

/** Years this league actually has feeds for — the years with owners to name. */
function yearsFor(league, only) {
  const feedsDir = path.join(ROOT, league.dataPath, 'mfl-feeds');
  if (!fs.existsSync(feedsDir)) return [];
  const years = fs
    .readdirSync(feedsDir)
    .map(Number)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);
  return only ? years.filter((y) => y === only) : years;
}

/**
 * The MFL league id for a given league-YEAR.
 *
 * This is the whole reason historical years came back nameless. Every MFL
 * league-year is its own league with its own id, and the registry only carries
 * the CURRENT one — so asking `/2009/export?L=13522` does not request
 * TheLeague's 2009 season, it requests whatever league happened to be 13522 in
 * 2009. That is somebody else's league, we are not its commissioner, and the
 * reply is a public payload with no owner names. Measured: TheLeague was 76273
 * in 2007, 42989 in 2009, 48815 in 2012, 28077 in 2015, 13522 from 2018; the
 * AFL 47555 / 21465 / 26792 / 14236 / 19621. The years that DID resolve are
 * exactly the ones where the current id is already correct.
 *
 * The committed feed for each year carries its own id inside the payload
 * (`league.id`), which is authoritative because MFL wrote it. `fetch.meta.json`
 * also has a `leagueId`, but it is NOT usable — several AFL years record
 * TheLeague's id, so it is cross-contaminated.
 *
 * Falls back to the registry id when a year has no committed feed, which is
 * right for the current year and harmless otherwise.
 */
const leagueIdCache = new Map();
export function leagueIdForYear(league, year, root = ROOT) {
  // Key on everything the answer depends on. Keying on slug+year alone was
  // wrong: the result is read from `root`/`dataPath`, so two callers passing
  // different roots — or a league object without a dataPath — would be served
  // each other's answer. A cache narrower than its inputs is a correctness bug,
  // and this one was caught by a test in the same file poisoning a later one.
  const key = `${league.slug}|${league.dataPath ?? ''}|${root}|${year}`;
  if (leagueIdCache.has(key)) return leagueIdCache.get(key);
  let id = league.id;
  // A league with no dataPath has no committed feeds to consult — the registry
  // id is all there is. Returning it beats throwing from a lookup.
  if (!league.dataPath) {
    leagueIdCache.set(key, id);
    return id;
  }
  const feed = path.join(root, league.dataPath, 'mfl-feeds', String(year), 'league.json');
  try {
    const fromFeed = JSON.parse(fs.readFileSync(feed, 'utf8'))?.league?.id;
    if (fromFeed) id = String(fromFeed);
  } catch {
    // No committed feed for this year — the registry id is the best guess.
  }
  leagueIdCache.set(key, id);
  return id;
}

/**
 * Owner names for one league-year.
 *
 * @returns `{ byFranchise: Map<franchiseId, name>, franchiseCount, fieldsSeen }`.
 *   `byFranchise` is EMPTY when the response parsed but carried no name field —
 *   `fieldsSeen` (field NAMES only) is what tells you whether that was an
 *   unauthenticated payload or a schema change.
 * @throws on a non-OK response, or a body that is not JSON. Both are read
 *   failures rather than authorisation ones, and the caller reports them as
 *   errors — the first version returned null for all three cases and spent 44
 *   league-years blaming the credentials for a parser bug.
 *
 * `mflFetch` resolves to a `Response`. Its `.body` is a ReadableStream, so the
 * original `JSON.parse(res.body)` stringified it to "[object ReadableStream]",
 * threw, and was swallowed by a bare catch. Every other caller in this repo
 * does `await res.text()`; so does this one now.
 */
export async function fetchOwnersForYear(league, year, cookies) {
  // Per-YEAR id, not the registry's current one — see leagueIdForYear.
  const leagueId = leagueIdForYear(league, year);
  const url = `https://${league.mflHost}/${year}/export?TYPE=league&L=${leagueId}&JSON=1`;
  const res = await mflFetch({ url, cookies, timeoutMs: 15_000 });
  if (!res?.ok) {
    throw new Error(`HTTP ${res?.status ?? '?'} from ${league.mflHost}/${year}`);
  }
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // MFL answers a rejected request with HTML or an <error> body, not JSON —
    // that snippet is worth showing, because it names the reason.
    //
    // Anything else is NOT echoed. This response can carry owner names and
    // email addresses, and malformed JSON is exactly the case where the PII
    // guard downstream never gets to run. Reporting the shape instead of the
    // content keeps a diagnostic from becoming the leak this script exists to
    // prevent.
    const head = text.trimStart();
    const markupLike = head.startsWith('<');
    const detail = markupLike
      ? head.slice(0, 120).replace(/\s+/g, ' ')
      : `${text.length} bytes, not markup — body withheld (may contain owner PII)`;
    throw new Error(`${year}: response was not JSON (${detail})`);
  }
  const franchises = payload?.league?.franchises?.franchise ?? [];
  const list = Array.isArray(franchises) ? franchises : [franchises];
  const byFranchise = new Map();
  for (const franchise of list) {
    if (!franchise?.id) continue;
    for (const field of NAME_FIELDS) {
      const name = cleanName(franchise[field]);
      if (name) {
        assertNoContactInfo(name, `${league.slug} ${year} franchise ${franchise.id}`);
        byFranchise.set(franchise.id, name);
        break;
      }
    }
  }
  // Field NAMES only — never values. A response that parsed but carries no
  // name field is either an unauthenticated one (the public field set) or a
  // schema change, and only the key list tells you which.
  const fieldsSeen = list.length ? Object.keys(list[0]).sort() : [];
  return { byFranchise, franchiseCount: list.length, fieldsSeen, leagueId };
}

/**
 * Fold per-season observations onto tenures: every season a person claims
 * votes for a name, and a tenure needs ONE answer.
 *
 * Exported so tests can cover it without a network or credentials — the
 * conflict rule in particular, which is the difference between recording a
 * boundary and burying it.
 */
export function foldNamesOntoTenures(registry, observed) {
  const proposals = [];
  const conflicts = [];
  for (const person of registry.people) {
    if (person.displayName) continue; // never overwrite a human's edit
    const votes = new Map();
    for (const claim of person.claims ?? []) {
      const end = Math.min(claim.yearEnd, 3000);
      for (let year = claim.yearStart; year <= end; year++) {
        const name = observed.get(`${claim.league}|${claim.franchiseId}|${year}`);
        if (!name) continue;
        votes.set(name, (votes.get(name) ?? 0) + 1);
      }
    }
    if (votes.size === 0) continue;
    if (votes.size > 1) {
      // Two names across one tenure usually means the tenure should be SPLIT.
      // Naming it after whichever appeared more would hide exactly the
      // boundary the registry exists to record.
      conflicts.push({
        id: person.id,
        slug: person.slug,
        names: [...votes.entries()].map(([n, c]) => `${n} (${c}y)`),
      });
      continue;
    }
    const [name] = [...votes.keys()];
    assertNoContactInfo(name, person.id);
    proposals.push({ person, name });
  }
  return { proposals, conflicts };
}

async function main() {
  const opts = parseArgs();
  const slugs = opts.league ? [opts.league] : LEAGUE_SLUGS;
  const registry = readJson(REGISTRY_PATH);
  if (!registry) {
    console.error(`${path.relative(ROOT, REGISTRY_PATH)} not found — run seed-owners-registry.mjs first.`);
    process.exit(1);
  }

  const cookies = await resolveCookies();
  console.log(`\n👤 Owner names from MFL — ${slugs.join(', ')}\n`);

  // (league|franchiseId|year) -> name, straight from MFL.
  const observed = new Map();
  for (const slug of slugs) {
    const league = LEAGUES[slug];
    const years = yearsFor(league, opts.year);
    if (years.length === 0) {
      console.log(`  [${slug}] no feed years — skipping`);
      continue;
    }
    let named = 0;
    let anonymousYears = 0;
    let failedYears = 0;
    let lastFieldsSeen = null;
    for (const year of years) {
      let result = null;
      try {
        result = await fetchOwnersForYear(league, year, cookies);
      } catch (err) {
        console.warn(`  [${slug}] ${year}: ${err.message}`);
      }
      if (!result) {
        // Already reported by the catch above — a read failure, not an
        // authorisation one. Do not print a second, misleading line.
        failedYears += 1;
      } else if (result.byFranchise.size === 0) {
        anonymousYears += 1;
        lastFieldsSeen = result.fieldsSeen;
        console.log(
          `  [${slug}] ${year}: L=${result.leagueId} parsed ${result.franchiseCount} franchises, ` +
            `none carrying a name field`
        );
      } else {
        for (const [franchiseId, name] of result.byFranchise) {
          observed.set(`${slug}|${franchiseId}|${year}`, name);
        }
        named += result.byFranchise.size;
      }
      await sleep(600); // be polite to MFL
    }
    console.log(`  [${slug}] collected ${named} franchise-year owner names across ${years.length} years`);
    // The diagnosis, printed once per league rather than 20 times. Field NAMES
    // only. If this list is the public set, the cookie was not honoured —
    // almost always an expired MFL session, since MFL answers an unauthorised
    // read with the PUBLIC payload rather than an error.
    if (named === 0 && anonymousYears > 0 && lastFieldsSeen) {
      console.log('');
      // Say what actually happened. Claiming "every year parsed" while some
      // years threw would point the reader at authorisation when the real
      // problem is that those years never came back at all.
      console.log(
        failedYears === 0
          ? `  [${slug}] every year parsed, no year carried an owner name.`
          : `  [${slug}] ${anonymousYears} of ${years.length} years parsed with no owner name; ` +
            `${failedYears} failed to read (see the errors above).`
      );
      console.log(`  [${slug}] fields MFL returned per franchise: ${lastFieldsSeen.join(', ')}`);
      console.log(
        `  [${slug}] expected one of: ${NAME_FIELDS.join(', ')}. If the list above is`
      );
      console.log(
        `  [${slug}] the ordinary public field set, the cookies were ignored — refresh`
      );
      console.log(`  [${slug}] MFL_USER_ID / MFL_IS_COMMISH from a logged-in browser.`);
    }
  }

  if (observed.size === 0) {
    console.log('\n  Nothing collected. Without commissioner access MFL returns no owner names.\n');
    return;
  }

  const { proposals, conflicts } = foldNamesOntoTenures(registry, observed);

  console.log(`\n  would name:        ${proposals.length}`);
  console.log(`  already named:     ${registry.people.filter((p) => p.displayName).length}`);
  console.log(`  conflicting:       ${conflicts.length}`);
  console.log(`  still unnamed:     ${registry.people.filter((p) => !p.displayName).length - proposals.length - conflicts.length}`);

  for (const { person, name } of proposals.slice(0, 20)) {
    console.log(`    + ${person.slug.padEnd(38)} ${name}`);
  }
  if (proposals.length > 20) console.log(`    … and ${proposals.length - 20} more`);

  if (conflicts.length > 0) {
    console.log('\n  ⚠ tenures MFL reports more than one owner for — these probably need SPLITTING:');
    for (const c of conflicts) console.log(`    ! ${c.slug.padEnd(38)} ${c.names.join(' / ')}`);
  }

  if (!opts.write) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --write.\n`);
    return;
  }

  for (const { person, name } of proposals) {
    person.displayName = name;
    person.seededFrom = `mfl:league-export@${new Date().toISOString().slice(0, 10)}`;
  }
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  console.log(`\n  wrote ${path.relative(ROOT, REGISTRY_PATH)} — ${proposals.length} names set`);
  console.log('  Now re-run: pnpm compute:owner-tenures\n');
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
