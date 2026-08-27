#!/usr/bin/env node
/**
 * Roster page parity harness.
 *
 * The rosters page is the largest, least-tested surface in the repo. Any
 * refactor of it has to answer one question — "does it still render exactly
 * what it rendered before?" — and no unit test can answer that, because the
 * page's output is produced by ~7k lines of imperative client script mutating
 * the DOM after hydration.
 *
 * So this drives a real browser against a real dev server, walks a matrix of
 * (season, team) selections, and fingerprints what the user actually sees:
 * the roster rows, the summary strip, the cap/dead-money footers, and the
 * per-bucket subtotals. Run it before a refactor, run it after, diff the two.
 *
 * It deliberately fingerprints RENDERED OUTPUT rather than the config payload,
 * so it stays valid across changes to how data is delivered to the client
 * (dedup, on-demand season loading, module extraction). Those are exactly the
 * changes it needs to police.
 *
 *   node scripts/roster-parity-check.mjs --out before.json
 *   ...refactor...
 *   node scripts/roster-parity-check.mjs --out after.json
 *   node scripts/roster-parity-check.mjs --compare before.json after.json
 *
 * Flags:
 *   --url <origin>     dev server origin (default http://localhost:4399)
 *   --secret <string>  JWT secret the dev server was launched with
 *   --seasons a,b,c    seasons to walk (default: current + two historical)
 *   --teams  a,b,c     franchise ids to walk (default: first 4 + owner team)
 *   --all-teams        walk every team in the current season
 *   --out <path>       write the fingerprint here
 *   --compare <a> <b>  diff two fingerprints and exit non-zero on drift
 */

import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LEAGUES, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';

const CHROMIUM = '/opt/pw-browsers/chromium';

/** League ids come from the registry, never inline (CLAUDE.md League registry). */
function leagueBySlug(slug) {
  const entry = LEAGUES[slug];
  if (!entry) throw new Error(`Unknown league slug "${slug}" — check src/config/leagues-data.mjs`);
  return entry;
}

// ---------------------------------------------------------------- args ----

function parseArgs(argv) {
  const args = {
    url: 'http://localhost:4399',
    secret: process.env.JWT_SECRET ?? 'roster-split-verify',
    seasons: null,
    teams: null,
    allTeams: false,
    out: null,
    compare: null,
    league: DEFAULT_LEAGUE_SLUG,
    franchiseId: '0001',
    leagueId: null, // resolved from the registry once --league is known
    timeout: 180000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--league') args.league = argv[++i];
    else if (a === '--secret') args.secret = argv[++i];
    else if (a === '--seasons') args.seasons = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--teams') args.teams = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--all-teams') args.allTeams = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--compare') args.compare = [argv[++i], argv[++i]];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
  }
  args.leagueId = args.leagueId ?? leagueBySlug(args.league).id;
  return args;
}

// ---------------------------------------------------------------- auth ----

function forgeSessionToken(secret, { franchiseId, leagueId }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId: 'MFL_PARITY',
    username: 'ParityHarness',
    franchiseId,
    leagueId,
    role: 'owner',
    issuedAt: now,
    expiresAt: now + 86400,
    iat: now,
    exp: now + 86400,
  };
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

// ------------------------------------------------------ in-page capture ----

/**
 * Runs inside the browser. Returns a stable, comparable description of what
 * the page is currently showing. Everything is normalized to text so that
 * incidental markup changes (an added wrapper span, a reordered attribute)
 * don't register as behavior drift — but every number and every player
 * identity does.
 */
/* c8 ignore start -- executed in the browser, not in node */
const CAPTURE_FN = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const text = (id) => norm(document.getElementById(id)?.textContent);
  const nList = (prefix, n) => {
    const out = [];
    for (let i = 1; i <= n; i += 1) out.push(text(`${prefix}${i}`));
    return out;
  };

  const body = document.getElementById('rosterTableBody');
  const rows = [...(body?.querySelectorAll('tr') ?? [])].map((tr) => ({
    // data-player-id is the row's identity; fall back to the first cell's text
    id: tr.getAttribute('data-player-id') ?? '',
    cls: norm(tr.className),
    cells: [...tr.querySelectorAll('td')].map((td) => norm(td.textContent)),
  }));

  return {
    season: document.getElementById('rosterSeasonSelect')?.value ?? '',
    team: document.getElementById('rosterTeamSelect')?.value ?? '',
    meta: text('rosterMetadata'),
    count: text('rosterCountLabel'),
    summary: {
      cap: text('summaryCap'),
      players: text('summaryPlayers'),
      open: text('summaryOpen'),
      practice: text('practiceCount'),
      injured: text('injuredCount'),
    },
    subtotals: {
      active: text('subtotalActive'),
      practice: text('subtotalPractice'),
      injured: text('subtotalInjured'),
      dead: text('subtotalDead'),
      countActive: text('countActive'),
      countPractice: text('countPractice'),
      countInjured: text('countInjured'),
    },
    yearTotals: nList('yearTotal', 7),
    capLimits: nList('capLimit', 7),
    capSpace: nList('capSpaceTotal', 7),
    deadTotals: nList('dmTotal', 7),
    identity: [...document.querySelectorAll('[data-team-name]')].map((el) => norm(el.textContent)),
    rowCount: rows.length,
    rows,
  };
};
/* c8 ignore stop */

// ---------------------------------------------------------------- walk ----

/**
 * Block until the page stops mutating itself.
 *
 * Deliberately not `networkidle`: the season prefetch keeps issuing background
 * requests long after the page is visually settled, so network quiet is both
 * too late and not guaranteed. What matters is that the rendered output has
 * stopped changing — so poll a cheap signature of it and require N consecutive
 * identical reads.
 */
async function settle(page, { quietMs = 700, pollMs = 100, timeoutMs = 30000 } = {}) {
  const signature = () =>
    page.evaluate(() => {
      const el = document.querySelector('.roster-page');
      const body = document.getElementById('rosterTableBody');
      return [
        el?.getAttribute('data-rendered-season') ?? '',
        el?.getAttribute('data-rendered-team') ?? '',
        document.getElementById('rosterTeamSelect')?.value ?? '',
        String(body?.querySelectorAll('tr').length ?? 0),
        (body?.textContent ?? '').length.toString(),
      ].join('|');
    });

  const needed = Math.ceil(quietMs / pollMs);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const sig = await signature();
    if (sig === last) {
      stable += 1;
      if (stable >= needed) return;
    } else {
      stable = 0;
      last = sig;
    }
    await page.waitForTimeout(pollMs);
  }
  process.stderr.write('  ! settle() timed out; capturing anyway\n');
}

async function capture(args) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const token = forgeSessionToken(args.secret, args);
  const origin = new URL(args.url);

  const context = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
  await context.addCookies([
    { name: 'session_token', value: token, domain: origin.hostname, path: '/' },
  ]);

  // External asset hosts are unreachable from the sandbox and each one costs a
  // multi-second timeout. Fulfill them instantly — they cannot affect the
  // numbers we fingerprint.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(args.url)) return route.continue();
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font' || type === 'media') {
      return route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.alloc(0) });
    }
    return route.abort();
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  const target = `${args.url}/${args.league}/rosters`;
  process.stderr.write(`→ loading ${target}\n`);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: args.timeout });

  // The roster table is rendered by the client script's initial updateView().
  await page.waitForFunction(
    () => (document.getElementById('rosterTableBody')?.querySelectorAll('tr').length ?? 0) > 0,
    { timeout: args.timeout },
  );

  // The page finishes loading and THEN keeps mutating: hydrateTeamFromSession()
  // awaits /api/auth/session and re-selects the logged-in owner's team, which
  // clobbers whatever team is selected in the first moments after load. Walk
  // the matrix before that lands and the first couple of shots capture a team
  // the harness didn't ask for. Wait for the page to stop changing on its own.
  await settle(page);

  const cfg = await page.evaluate(() => {
    const raw = document.getElementById('roster-config')?.textContent;
    if (!raw) return null;
    const c = JSON.parse(raw);
    return {
      defaultSeason: c.defaultSeason,
      defaultTeamId: c.defaultTeamId,
      seasonOptions: c.seasonOptions,
      teamIds: Object.keys(c.teams ?? {}),
      // size telemetry — the whole point of the payload phases
      bytes: raw.length,
    };
  });
  if (!cfg) throw new Error('roster-config not found on page');

  const seasons = args.seasons ?? [
    cfg.defaultSeason,
    ...cfg.seasonOptions.filter((s) => s !== cfg.defaultSeason).slice(0, 2),
  ];
  const teams = args.teams
    ?? (args.allTeams
      ? cfg.teamIds
      : [cfg.defaultTeamId, ...cfg.teamIds.filter((t) => t !== cfg.defaultTeamId).slice(0, 3)]);

  const shots = [];
  for (const season of seasons) {
    for (const team of teams) {
      await page.evaluate(
        ([s, t]) => {
          const setAndFire = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = val;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          // Season first, then team — the team listener re-renders, so firing
          // it last guarantees one settled render for the pair.
          setAndFire('rosterSeasonSelect', s);
          setAndFire('rosterTeamSelect', t);
        },
        [season, team],
      );
      // Wait for the RENDER to settle, not the input to be set. An uncached
      // historical season is a fetch, so the picker's value and the table's
      // contents are no longer the same instant — updateView() stamps
      // data-rendered-season/team when it finishes, and that is the signal.
      // Falls back to comparing the inputs on a build that predates the stamp,
      // so one harness can fingerprint both sides of that change.
      await page.waitForFunction(
        ([s, t]) => {
          const el = document.querySelector('.roster-page');
          const rs = el?.getAttribute('data-rendered-season');
          if (rs !== null && rs !== undefined) {
            return rs === s && el?.getAttribute('data-rendered-team') === t;
          }
          return document.getElementById('rosterSeasonSelect')?.value === s
            && document.getElementById('rosterTeamSelect')?.value === t;
        },
        [season, team],
        { timeout: args.timeout },
      );
      await page.waitForTimeout(120);
      const shot = await page.evaluate(CAPTURE_FN);
      shots.push({ key: `${season}/${team}`, ...shot });
      process.stderr.write(`  ✓ ${season}/${team} — ${shot.rowCount} rows\n`);
    }
  }

  await browser.close();
  return { capturedAt: null, config: cfg, errors, shots };
}

// ------------------------------------------------------------- compare ----

function flatten(obj, prefix, out) {
  if (obj === null || typeof obj !== 'object') {
    out.set(prefix, JSON.stringify(obj));
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function compare(aPath, bPath) {
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));

  const byKeyA = new Map(a.shots.map((s) => [s.key, s]));
  const byKeyB = new Map(b.shots.map((s) => [s.key, s]));
  const keys = [...new Set([...byKeyA.keys(), ...byKeyB.keys()])].sort();

  const diffs = [];
  for (const key of keys) {
    const sa = byKeyA.get(key);
    const sb = byKeyB.get(key);
    if (!sa) { diffs.push(`${key}: present only in ${bPath}`); continue; }
    if (!sb) { diffs.push(`${key}: present only in ${aPath}`); continue; }
    const fa = flatten(sa, '', new Map());
    const fb = flatten(sb, '', new Map());
    for (const [k, v] of fa) {
      if (!fb.has(k)) { diffs.push(`${key}: ${k} removed`); continue; }
      if (fb.get(k) !== v) diffs.push(`${key}: ${k}\n    before: ${v}\n    after:  ${fb.get(k)}`);
    }
    for (const k of fb.keys()) if (!fa.has(k)) diffs.push(`${key}: ${k} added`);
  }

  const bytesA = a.config?.bytes ?? 0;
  const bytesB = b.config?.bytes ?? 0;
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
  process.stdout.write(`roster-config payload: ${mb(bytesA)} → ${mb(bytesB)}`);
  if (bytesA) {
    const pct = (((bytesB - bytesA) / bytesA) * 100).toFixed(1);
    process.stdout.write(`  (${pct > 0 ? '+' : ''}${pct}%)`);
  }
  process.stdout.write('\n');

  const newErrors = (b.errors ?? []).filter((e) => !(a.errors ?? []).includes(e));
  if (newErrors.length) {
    process.stdout.write(`\n✗ ${newErrors.length} NEW page error(s):\n`);
    for (const e of newErrors) process.stdout.write(`    ${e}\n`);
  }

  if (!diffs.length && !newErrors.length) {
    process.stdout.write(`\n✓ PARITY: ${keys.length} (season, team) renders identical.\n`);
    return 0;
  }
  if (diffs.length) {
    process.stdout.write(`\n✗ ${diffs.length} rendering difference(s):\n`);
    for (const d of diffs.slice(0, 60)) process.stdout.write(`  ${d}\n`);
    if (diffs.length > 60) process.stdout.write(`  …and ${diffs.length - 60} more\n`);
  }
  return 1;
}

// ---------------------------------------------------------------- main ----

const args = parseArgs(process.argv);

if (args.compare) {
  process.exit(compare(args.compare[0], args.compare[1]));
} else {
  const result = await capture(args);
  const out = args.out ?? 'roster-parity.json';
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  process.stderr.write(
    `\nwrote ${out} — ${result.shots.length} renders, `
    + `${(result.config.bytes / 1024 / 1024).toFixed(2)}MB config, `
    + `${result.errors.length} page error(s)\n`,
  );
  if (result.errors.length) {
    for (const e of result.errors.slice(0, 10)) process.stderr.write(`  ! ${e}\n`);
  }
}
