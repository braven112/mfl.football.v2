/**
 * Yahoo Fantasy API probe — the cheapest possible validation that `/live`
 * could carry a Yahoo league, BEFORE any of it is built.
 *
 * Deliberately outside the app: no route, no OAuth infrastructure, no deploy,
 * no DNS. One file, node built-ins only, tokens in a gitignored file. Nothing
 * here is production code — `docs/plans/live-outside-platforms.md` describes
 * what production looks like, and this exists to find out whether that plan is
 * worth writing code against.
 *
 * WHY IT NEEDS A REAL GRANT: Yahoo has no anonymous read. Unlike ESPN, whose
 * public leagues answer unauthenticated, every Yahoo Fantasy endpoint requires
 * a user token — so "probe it without an account" is not an option that exists.
 *
 * ── Setup (a human, and NOT necessarily quick) ─────────────────────────────
 *   1. Apply for API access at https://sports.yahoo.com/developer
 *
 *      This is no longer the old self-serve "create an app, get a key in two
 *      minutes" flow. Yahoo's own page (checked 2026-09-14) describes three
 *      steps: submit an application, AWAIT REVIEW, receive access if approved.
 *      Neither the timeline nor the approval bar is published. Treat getting
 *      access as the long pole of this integration, not as setup.
 *
 *   2. Once approved, register the app with:
 *        Redirect URI     : https://localhost:8080
 *        API Permissions  : Fantasy Sports — Read
 *   3. Copy the Client ID and Client Secret into .env.local:
 *        YAHOO_CLIENT_ID=...
 *        YAHOO_CLIENT_SECRET=...
 *
 * Nothing listens on localhost:8080 and nothing needs to. Yahoo bounces the
 * browser there with `?code=…` in the URL, the page fails to load, and the
 * code is read out of the address bar. That is the whole reason this probe
 * needs no HTTPS host — which is otherwise the constraint that forces the real
 * connect flow onto staging (Vercel preview URLs are per-deployment and can
 * never be a registered redirect URI).
 *
 * ── Run ────────────────────────────────────────────────────────────────────
 *   node scripts/probe-yahoo.mjs auth           # prints the URL to open
 *   node scripts/probe-yahoo.mjs token <code>   # exchanges it, saves tokens
 *   node scripts/probe-yahoo.mjs probe          # hits the endpoints, verdicts
 *   node scripts/probe-yahoo.mjs probe --week 3
 *
 * Run `probe` a second time DURING a Sunday afternoon window: the static shape
 * is answerable any day, but "do the points actually move" is not.
 *
 * ── One thing this probe is deliberately testing about ITSELF ──────────────
 * It asks for `format=json`, which every third-party Yahoo client uses and
 * which works — but which Yahoo does NOT document. The official docs are
 * XML-only. So the awkward JSON shape this file's walker handles is an
 * UNDOCUMENTED surface, and the documented one is the XML it is translated
 * from. If the walker struggles here, that is not a reason to fight it: it is
 * the argument for the real integration parsing XML instead, against a
 * contract Yahoo actually publishes.
 */
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_FILE = '.yahoo-probe.json';
const DUMP_DIR = path.join('tmp', 'yahoo-probe');
const REDIRECT_URI = process.env.YAHOO_REDIRECT_URI || 'https://localhost:8080';
const AUTH_HOST = 'https://api.login.yahoo.com';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2';

// ── env ─────────────────────────────────────────────────────────────────────
// Mirrors astro.config.ts: hydrate process.env from .env.local so the probe
// reads the same file the app does. Real env always wins.
for (const file of ['.env', '.env.local']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};
const basicAuth = () =>
  'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

function requireClient() {
  if (!CLIENT_ID || !CLIENT_SECRET)
    die('YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET missing — see the header of this file.');
}

// ── oauth ───────────────────────────────────────────────────────────────────
function cmdAuth() {
  requireClient();
  const url =
    `${AUTH_HOST}/oauth2/request_auth?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&language=en-us`;
  console.log(`
1. Open this URL and approve:

${url}

2. The browser lands on ${REDIRECT_URI}/?code=XXXX and fails to load. That is
   expected — nothing is listening. Copy the value of ?code= from the address bar.

3. node scripts/probe-yahoo.mjs token <code>
`);
}

async function exchange(body) {
  const res = await fetch(`${AUTH_HOST}/oauth2/get_token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) die(`token exchange ${res.status}\n${text}`);
  return JSON.parse(text);
}

async function cmdToken(code) {
  requireClient();
  if (!code) die('usage: node scripts/probe-yahoo.mjs token <code>');
  const tok = await exchange({
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code,
  });
  tok.obtained_at = Date.now();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tok, null, 2));
  console.log(`✓ tokens saved to ${TOKEN_FILE} (gitignored)`);
  console.log(`  access token expires in ${tok.expires_in}s; refresh token stored.`);
  console.log(`\nNext: node scripts/probe-yahoo.mjs probe`);
}

async function accessToken() {
  if (!fs.existsSync(TOKEN_FILE)) die(`no ${TOKEN_FILE} — run \`auth\` then \`token <code>\` first.`);
  const tok = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const age = (Date.now() - (tok.obtained_at ?? 0)) / 1000;
  if (age < (tok.expires_in ?? 3600) - 60) return tok.access_token;

  requireClient();
  console.log('· access token expired, refreshing…');
  const next = await exchange({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
  next.obtained_at = Date.now();
  // Yahoo may ROTATE the refresh token; keep the new one or the next run 400s.
  next.refresh_token ||= tok.refresh_token;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(next, null, 2));
  return next.access_token;
}

// ── api ─────────────────────────────────────────────────────────────────────
async function get(token, pathname, label) {
  const url = `${API}/${pathname}${pathname.includes('?') ? '&' : '?'}format=json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  fs.mkdirSync(DUMP_DIR, { recursive: true });
  const file = path.join(DUMP_DIR, `${label}.json`);
  fs.writeFileSync(file, text);
  if (!res.ok) {
    console.log(`  ✗ ${label}: HTTP ${res.status} — raw body at ${file}`);
    return null;
  }
  console.log(`  ✓ ${label}: ${text.length.toLocaleString()} bytes → ${file}`);
  try {
    return JSON.parse(text);
  } catch {
    console.log(`  ! ${label}: response was not JSON`);
    return null;
  }
}

/**
 * Yahoo's JSON is a mechanical translation of its XML: a collection is an
 * OBJECT keyed "0","1",… beside a `count`, and an entity's attributes arrive
 * as an ARRAY of single-key objects. This walker is the throwaway ancestor of
 * the normalizer the real integration needs — if it handles the live payload,
 * the plan's estimate for that module holds.
 */
function collection(node) {
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node)
    .filter(([k]) => /^\d+$/.test(k))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => v);
}
function flatten(node) {
  // [{a:1},{b:2}] or {0:{a:1},1:{b:2},count:2} → {a:1,b:2}
  const parts = Array.isArray(node) ? node : collection(node);
  const out = {};
  for (const part of parts) {
    if (part && typeof part === 'object' && !Array.isArray(part)) Object.assign(out, part);
  }
  return out;
}

async function cmdProbe(argv) {
  const weekArg = argv.indexOf('--week');
  const week = weekArg > -1 ? argv[weekArg + 1] : null;
  const token = await accessToken();

  console.log('\n── 1. Which leagues is this account in? ──');
  const leaguesRaw = await get(
    token,
    'users;use_login=1/games;game_keys=nfl/leagues',
    'leagues',
  );
  const leagues = [];
  if (leaguesRaw) {
    const users = collection(leaguesRaw.fantasy_content?.users);
    for (const u of users) {
      for (const game of collection(u.user?.[1]?.games)) {
        for (const lg of collection(game.game?.[1]?.leagues)) {
          const meta = flatten(lg.league);
          if (meta.league_key) leagues.push(meta);
        }
      }
    }
    if (!leagues.length)
      console.log('  ! parsed 0 leagues — inspect the raw dump; the walker may need adjusting');
    for (const l of leagues)
      console.log(`    · ${l.league_key}  ${l.name}  (${l.num_teams} teams, season ${l.season}, week ${l.current_week})`);
  }

  if (!leagues.length) {
    console.log('\nNo leagues to probe further. Stopping.');
    return;
  }

  const league = leagues[0];
  const w = week || league.current_week;

  console.log(`\n── 2. Matchups + live points — ${league.name}, week ${w} ──`);
  const sb = await get(token, `league/${league.league_key}/scoreboard;week=${w}`, 'scoreboard');
  if (sb) {
    const lg = collection(sb.fantasy_content?.league?.[1]?.scoreboard?.['0']?.matchups);
    console.log(`    matchups parsed: ${lg.length}`);
    for (const m of lg.slice(0, 3)) {
      const teams = collection(m.matchup?.['0']?.teams);
      const line = teams.map((t) => {
        const meta = flatten(t.team?.[0]);
        const stats = t.team?.[1] ?? {};
        const pts = stats.team_points?.total;
        const proj = stats.team_projected_points?.total;
        return `${meta.name} ${pts ?? '—'} (proj ${proj ?? '—'})`;
      });
      console.log(`    · ${line.join('  vs  ')}`);
    }
    console.log(`
    VERDICT — the two things this call had to prove:
      team_points present?           ${/"team_points"/.test(JSON.stringify(sb)) ? 'YES' : 'NO'}
      team_projected_points present? ${/"team_projected_points"/.test(JSON.stringify(sb)) ? 'YES' : 'NO'}
    (Whether they MOVE is only answerable mid-Sunday — re-run then and diff.)`);
  }

  console.log(`\n── 3. Starter-level detail (the tap-to-expand payload) ──`);
  const teamKey = `${league.league_key}.t.1`;
  const roster = await get(
    token,
    `team/${teamKey}/roster;week=${w}/players/stats;type=week;week=${w}`,
    'roster',
  );
  if (roster) {
    const players = collection(
      roster.fantasy_content?.team?.[1]?.roster?.['0']?.players,
    );
    console.log(`    players parsed: ${players.length}`);
    for (const p of players.slice(0, 3)) {
      const meta = flatten(p.player?.[0]);
      const pts = p.player?.[1]?.player_points?.total ?? p.player?.[2]?.player_points?.total;
      console.log(
        `    · ${meta.name?.full ?? '?'} ${meta.display_position ?? ''} ${pts ?? '—'} pts` +
          `  image:${meta.image_url ? 'yes' : 'no'}`,
      );
    }
    console.log(`
    VERDICT — does a row need an MFL player id?
      per-player points?  ${/"player_points"/.test(JSON.stringify(roster)) ? 'YES' : 'NO'}
      per-player image?   ${/"image_url"/.test(JSON.stringify(roster)) ? 'YES' : 'NO'}
    Both YES means the board renders Yahoo rows with no cross-platform id join,
    which is the join the plan says not to build.`);
  }

  console.log(`\nRaw responses in ${DUMP_DIR}/ — these are the fixture candidates.\n`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'auth') cmdAuth();
else if (cmd === 'token') await cmdToken(rest[0]);
else if (cmd === 'probe') await cmdProbe(rest);
else {
  console.log(`usage:
  node scripts/probe-yahoo.mjs auth
  node scripts/probe-yahoo.mjs token <code>
  node scripts/probe-yahoo.mjs probe [--week N]`);
}
